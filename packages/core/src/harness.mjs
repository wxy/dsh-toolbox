/**
 * Locate the installed DeepSeek Harness and pull the pieces the toolbox needs
 * from it (decodeStorageRecord for packed session rows). Resolution order:
 * DSH_INSTALL env → `npm root -g`/@deepseek-ai/dsh → the known default path.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_INSTALL = '/Users/xingyuwang/.nvm/versions/node/v26.7.0/lib/node_modules/@deepseek-ai/dsh'

export function findDshInstall(explicit) {
  if (explicit !== undefined && explicit !== '') return explicit
  if (process.env.DSH_INSTALL !== undefined && process.env.DSH_INSTALL !== '') return process.env.DSH_INSTALL
  try {
    const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    const candidate = join(npmRoot, '@deepseek-ai', 'dsh')
    if (existsSync(candidate)) return candidate
  } catch { /* fall through */ }
  if (existsSync(DEFAULT_INSTALL)) return DEFAULT_INSTALL
  throw new Error('dsh install not found; pass --dsh-install <path> or set DSH_INSTALL')
}

const dshSessionUrl = (dshInstall) => pathToFileURL(
  join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'),
).href

const decoderCache = new WeakMap()
/** Lazily import decodeStorageRecord from the installed dsh-session package. */
export async function decodeStorageRecord(dshInstall, line) {
  let mod = decoderCache.get(dshInstall)
  if (mod === undefined) {
    mod = await import(dshSessionUrl(dshInstall))
    decoderCache.set(dshInstall, mod)
  }
  return mod.decodeStorageRecord(line)
}
