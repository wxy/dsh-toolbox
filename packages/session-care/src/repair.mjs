/**
 * Repair strategies for corrupt session logs, encoding the playbook validated
 * against real incidents:
 *   repackage-frames      — single-frame logs (the whole log in one zstd frame)
 *                           are rebuilt as [header frame][event frame(s)].
 *   drop-duplicate-segment— a row range re-appearing with earlier sequence
 *                           numbers (e.g. a premature step/end + turn/end
 *                           followed by the real continuation) drops the
 *                           earlier duplicate run and keeps the remainder.
 *   truncate              — unparsable rows or forward seq gaps truncate at
 *                           the first anomaly, preserving the contiguous prefix.
 * Every written repair keeps the original at a `.corrupt-<ts>` sibling and is
 * re-verified with the reader's own checks before publishing.
 */
import { randomBytes } from 'node:crypto'
import { compressFrame } from '../../core/src/frames.mjs'
import { scanRoot, validateLog, walkSeqs } from './validate.mjs'

/** Decide the minimal safe content fix for a corrupt plaintext. */
export async function planContentFix(dshInstall, plaintext) {
  const walked = await walkSeqs(dshInstall, plaintext)
  const lines = walked.lines
  if (walked.issue === undefined) return { lines, strategy: 'none', detail: 'event region is contiguous' }
  const match = /at line (\d+)/.exec(walked.issue)
  const lineIndex = match === null ? 1 : Number(match[1])
  const issueLine = Math.min(lineIndex, lines.length)

  // Re-run a per-line scan to distinguish duplicate segments from forward gaps.
  let seq = 0
  const firstLineBySeq = new Map()
  for (let i = 1; i < lines.length; i++) {
    let decoded
    try {
      decoded = await decodeRows(dshInstall, lines[i])
    } catch {
      return {
        lines: lines.slice(0, i),
        strategy: 'truncate',
        detail: `unparsable event row at line ${i}; truncating at the contiguous prefix`,
      }
    }
    for (const event of decoded) {
      if (event.seq !== seq) {
        if (event.seq < seq) {
          const dropFrom = firstLineBySeq.get(event.seq) ?? i
          const kept = [...lines.slice(0, dropFrom), ...lines.slice(i)]
          if (await contiguousAfterHeader(dshInstall, kept)) {
            return {
              lines: kept,
              strategy: 'drop-duplicate-segment',
              detail: `duplicate segment at line ${i} (seq ${event.seq} reappeared); dropped earlier duplicate run lines ${dropFrom}..${i - 1}`,
            }
          }
          return {
            lines: lines.slice(0, i),
            strategy: 'truncate',
            detail: `duplicate segment at line ${i} (seq ${event.seq} reappeared); kept remainder was not contiguous, truncated at the contiguous prefix`,
          }
        }
        return {
          lines: lines.slice(0, i),
          strategy: 'truncate',
          detail: `seq gap at line ${i}: expected ${seq}, got ${event.seq}; truncating at the contiguous prefix`,
        }
      }
      if (!firstLineBySeq.has(event.seq)) firstLineBySeq.set(event.seq, i)
      seq++
    }
  }
  return {
    lines: lines.slice(0, issueLine),
    strategy: 'truncate',
    detail: `${walked.issue}; truncated at the contiguous prefix`,
  }
}

async function decodeRows(dshInstall, line) {
  const { decodeStorageRecord } = await import('./harness.mjs')
  return decodeStorageRecord(dshInstall, JSON.parse(line))
}

async function contiguousAfterHeader(dshInstall, lines) {
  const walked = await walkSeqs(dshInstall, Buffer.from(`${lines.join('\n')}\n`))
  return walked.issue === undefined
}

/** Repackage repaired lines into the reader's canonical layout. */
export async function repackage(lines, compression) {
  const header = `${lines[0]}\n`
  const body = lines.length > 1 ? `${lines.slice(1).join('\n')}\n` : ''
  if (compression !== 'zstd') return Buffer.from(header + body)
  return Buffer.concat([compressFrame(header), compressFrame(body)])
}

/** Publish atomically (temp write + rename). */
async function publish(path, content) {
  const { rename, writeFile } = await import('node:fs/promises')
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, path)
}

/**
 * Diagnose and optionally repair a session root. apply=false (default) only
 * plans; apply=true writes each verified repair with the original preserved.
 */
export async function repairRoot(dshInstall, root, options = {}) {
  const { apply = false, sessionId, compression = 'zstd' } = options
  const diagnostics = await scanRoot(dshInstall, root, compression)
  const reports = []
  for (const diagnostic of diagnostics) {
    if (diagnostic.status !== 'corrupt') continue
    if (sessionId !== undefined && diagnostic.id !== sessionId) continue
    const { readFile } = await import('node:fs/promises')
    const { copyFile } = await import('node:fs/promises')
    const buffer = await readFile(diagnostic.path)
    const view = await validateLog(dshInstall, buffer, compression)

    let strategy
    let detail
    let rebuilt
    if (view.headerId !== undefined && view.headerId !== diagnostic.id) {
      strategy = 'none'
      detail = 'stored header id does not match its directory; restore from backup or rename the directory'
    } else if (view.plaintext.length === 0 || (view.events === 0 && view.issue !== undefined
      && /header|first line|empty/i.test(view.issue))) {
      strategy = 'none'
      detail = `no recoverable committed prefix: ${view.issue}`
    } else {
      const fix = await planContentFix(dshInstall, view.plaintext)
      strategy = fix.strategy
      detail = fix.detail
      rebuilt = await repackage(fix.lines, compression)
    }

    const plan = { id: diagnostic.id, path: diagnostic.path, strategy, detail }
    if (strategy === 'none' || rebuilt === undefined) {
      reports.push({ plan })
      continue
    }
    if (apply !== true) {
      reports.push({ plan })
      continue
    }

    const verified = await validateLog(dshInstall, rebuilt, compression)
    if (!verified.ok) {
      throw new Error(
        `refusing to publish a repair for ${JSON.stringify(diagnostic.path)} — rebuilt artifact failed validation: ${verified.issue}`,
      )
    }
    const backupPath = `${diagnostic.path}.corrupt-${Date.now()}`
    await copyFile(diagnostic.path, backupPath)
    try {
      await publish(diagnostic.path, rebuilt)
    } catch (error) {
      await copyFile(backupPath, diagnostic.path).catch(() => {})
      throw error
    }
    reports.push({ plan: { ...plan, backupPath }, applied: true })
  }
  return reports
}
