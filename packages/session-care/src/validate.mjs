/**
 * Session-log validation: apply the same two contracts the harness reader
 * enforces (physical frame layout + contiguous event sequence numbers) and
 * report the exact failure, without throwing the caller's world down.
 */
import { assertHeaderFrame, decompressFrame, framesToPlaintext, scanFrames } from '@dsh-toolbox/core/src/frames.mjs'
import { decodeStorageRecord } from '@dsh-toolbox/core/src/harness.mjs'

/** Walk event lines after the header, tracking seq contiguity. */
export async function walkSeqs(dshInstall, plaintext) {
  const text = plaintext.toString('utf8')
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const events = []
  let issue
  const firstLineBySeq = new Map()
  let seq = 0
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    let decoded
    try {
      decoded = await decodeStorageRecord(dshInstall, JSON.parse(lines[lineIndex]))
    } catch {
      issue = issue ?? `unparsable event row at line ${lineIndex}`
      break
    }
    for (const event of decoded) {
      if (event.seq !== seq) {
        issue = issue ?? `seq gap at line ${lineIndex}: expected ${seq}, got ${event.seq} (${event.type})`
        events.length = 0
        break
      }
      events.push(event)
      if (!firstLineBySeq.has(event.seq)) firstLineBySeq.set(event.seq, lineIndex)
      seq++
    }
    if (issue !== undefined) break
  }
  return { lines, events, issue, firstLineBySeq }
}

/** Validate one artifact buffer under the reader's contracts. */
export async function validateLog(dshInstall, buffer, compression) {
  if (compression !== 'zstd') {
    const walked = await walkSeqs(dshInstall, buffer)
    const headerLine = walked.lines[0]
    return {
      ok: walked.issue === undefined && headerLine !== undefined,
      issue: walked.issue ?? (headerLine === undefined ? 'empty or header-less session log' : undefined),
      events: walked.events.length,
      frames: 1,
      headerId: headerLine === undefined ? undefined : safeHeaderId(headerLine),
      plaintext: buffer,
      walked,
    }
  }

  const { frames, tornStart } = scanFrames(buffer)
  if (frames.length === 0) {
    return {
      ok: false,
      issue: 'no complete Zstandard frame in the artifact',
      events: 0,
      frames: 0,
      plaintext: Buffer.alloc(0),
    }
  }
  const firstPlain = decompressFrame(buffer.subarray(frames[0].start, frames[0].end))
  let layoutIssue
  try {
    assertHeaderFrame(firstPlain)
  } catch (error) {
    layoutIssue = error.message
  }
  const plaintext = framesToPlaintext(buffer)
  const walked = await walkSeqs(dshInstall, plaintext)
  const issues = []
  if (layoutIssue !== undefined) issues.push(layoutIssue)
  if (walked.issue !== undefined) issues.push(walked.issue)
  return {
    ok: issues.length === 0 && tornStart === undefined,
    issue: issues.join('; ') || undefined,
    events: walked.events.length,
    frames: frames.length,
    headerId: safeHeaderId(walked.lines[0]),
    plaintext,
    walked,
  }
}

function safeHeaderId(headerLine) {
  try {
    const parsed = JSON.parse(headerLine)
    return typeof parsed?.id === 'string' ? parsed.id : undefined
  } catch {
    return undefined
  }
}

/** Walk a session root and produce one diagnostic per stored artifact. */
export async function scanRoot(dshInstall, root, compression = 'zstd') {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const suffix = compression === 'zstd' ? '.jsonl.zstd' : '.jsonl'
  const diagnostics = []
  let projects = []
  try {
    projects = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => join(root, entry.name))
  } catch {
    return diagnostics // absent root = no sessions
  }
  for (const project of projects) {
    let sessionDirs = []
    try {
      sessionDirs = (await readdir(project, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => join(project, entry.name))
    } catch {
      continue
    }
    for (const dir of sessionDirs) {
      const path = join(dir, `session${suffix}`)
      let buffer
      try {
        buffer = await readFile(path)
      } catch {
        continue
      }
      const id = dir.split('/').pop()
      const view = await validateLog(dshInstall, buffer, compression)
      let status = 'ok'
      let issue = view.issue
      if (view.headerId !== undefined && view.headerId !== id) {
        status = 'corrupt'
        issue = `stored header id ${JSON.stringify(view.headerId)} does not match its directory name ${JSON.stringify(id)}`
      } else if (!view.ok) {
        const headerProblem = issue !== undefined && /header|first line|empty|frame/i.test(issue)
        status = headerProblem && view.events === 0 ? 'unrepairable' : 'corrupt'
      }
      diagnostics.push({ id, path, status, issue, events: view.events, frames: view.frames })
    }
  }
  return diagnostics
}
