/**
 * Locate the installed DeepSeek Harness and pull the pieces the toolbox needs
 * from it (decodeStorageRecord for packed session rows). Resolution order:
 * DSH_INSTALL env → `npm root -g`/@deepseek-ai/dsh → the known default path.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Generic fallback for machines where `npm root -g` is unavailable. */
const DEFAULT_INSTALL = process.env.DSH_INSTALL ?? ''

export function findDshInstall(explicit) {
  if (explicit !== undefined && explicit !== '') return explicit
  if (process.env.DSH_INSTALL !== undefined && process.env.DSH_INSTALL !== '') return process.env.DSH_INSTALL
  try {
    const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    const candidate = join(npmRoot, '@deepseek-ai', 'dsh')
    if (existsSync(candidate)) return candidate
  } catch { /* fall through */ }
  if (DEFAULT_INSTALL !== '' && existsSync(DEFAULT_INSTALL)) return DEFAULT_INSTALL
  throw new Error('dsh install not found; run from a machine with dsh installed, or set DSH_INSTALL')
}

const dshSessionUrl = (dshInstall) => pathToFileURL(
  join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'),
).href

const decoderCache = new Map()
/** Lazily import decodeStorageRecord from the installed dsh-session package. */
export async function decodeStorageRecord(dshInstall, line) {
  let mod = decoderCache.get(String(dshInstall))
  if (mod === undefined) {
    mod = await import(dshSessionUrl(dshInstall))
    decoderCache.set(String(dshInstall), mod)
  }
  return mod.decodeStorageRecord(line)
}
