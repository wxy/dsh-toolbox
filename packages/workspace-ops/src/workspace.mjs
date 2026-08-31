/**
 * Workspace accounting for sessions (workspace.json under $DSH_HOME/storages):
 *   move <sessionId> --workspace <id|path>  attach an ungrouped session to a workspace
 *   unarchive <sessionId>                   remove a session from the archived set
 *   list                                    print workspaces, archived, ungrouped
 *
 * NOTE: the running harness keeps workspace.json in memory and only re-reads it
 * at startup, so these edits take effect at the next harness restart. Avoid
 * archiving/moving sessions in the GUI between an edit and the restart (any
 * such mutation rewrites the file from memory and drops the edit).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function workspaceFile() {
  return join(dshHome(), 'storages', 'workspace.json')
}

async function loadState() {
  const { readFile } = await import('node:fs/promises')
  let text
  try {
    text = await readFile(workspaceFile(), 'utf8')
  } catch {
    throw new Error(`workspace.json not found at ${workspaceFile()}`)
  }
  return JSON.parse(text)
}

/** Mutate the durable workspace.json (with a timestamped backup). */
async function saveState(state) {
  const { copyFile, writeFile } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  const file = workspaceFile()
  const backup = `${file}.pre-toolbox-${Date.now()}`
  if (existsSync(file)) await copyFile(file, backup)
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`)
  return backup
}

/** Attach a session to a workspace (by workspace id, or by path match). */
export async function moveSession(sessionId, workspaceRef) {
  const state = await loadState()
  const wsTable = state.tables?.workspaces ?? {}
  let wsId
  if (workspaceRef !== undefined) {
    const byId = Object.keys(wsTable).find(id => id === workspaceRef)
    const byPath = Object.keys(wsTable).find(id => wsTable[id]?.path === workspaceRef)
    wsId = byId ?? byPath
    if (wsId === undefined) {
      throw new Error(`workspace not found: ${workspaceRef} (have: ${Object.values(wsTable).map(w => w?.path).join(', ')})`)
    }
  } else {
    const ids = Object.keys(wsTable)
    if (ids.length !== 1) throw new Error('no --workspace given and more than one workspace exists')
    wsId = ids[0]
  }
  const ws = wsTable[wsId]
  if (!ws.sessionIds.includes(sessionId)) ws.sessionIds.push(sessionId)
  const archived = state.global?.archivedSessionIds ?? []
  if (archived.includes(sessionId)) {
    state.global.archivedSessionIds = archived.filter(id => id !== sessionId)
  }
  ws.updatedAt = new Date().toISOString()
  const backup = await saveState(state)
  return {
    workspaceId: wsId,
    path: ws.path,
    sessionIds: ws.sessionIds,
    backup,
    note: 'takes effect at the next harness restart',
  }
}

/** Remove a session from the archived set. */
export async function unarchiveSession(sessionId) {
  const state = await loadState()
  const archived = state.global?.archivedSessionIds ?? []
  if (!archived.includes(sessionId)) return { alreadyUnarchived: true, archivedSessionIds: archived }
  state.global.archivedSessionIds = archived.filter(id => id !== sessionId)
  const backup = await saveState(state)
  return { archivedSessionIds: state.global.archivedSessionIds, backup, note: 'takes effect at the next harness restart' }
}

/** Summarize workspaces, archived ids, and the sessions that would be ungrouped. */
export async function summarize() {
  const state = await loadState()
  const wsTable = state.tables?.workspaces ?? {}
  const workspaces = Object.entries(wsTable).map(([id, ws]) => ({
    workspaceId: id,
    path: ws.path,
    title: ws.title,
    sessionIds: ws.sessionIds,
  }))
  return {
    workspaces,
    archivedSessionIds: state.global?.archivedSessionIds ?? [],
    ungroupedNote: 'sessions not in any workspace.sessionIds (and not archived) appear under "未分组" in the GUI',
  }
}
