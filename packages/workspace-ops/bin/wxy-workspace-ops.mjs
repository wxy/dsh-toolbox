#!/usr/bin/env node
/**
 * wxy-workspace-ops — session workspace management: attach an ungrouped
 * session to a workspace, unarchive archived sessions, summarize accounting.
 *
 * Usage:
 *   wxy-workspace-ops list [--json]
 *   wxy-workspace-ops move <sessionId> [--workspace <workspaceId|path>]
 *   wxy-workspace-ops unarchive <sessionId>
 *
 * Edits $DSH_HOME/storages/workspace.json (with a timestamped backup). The
 * running harness holds this file in memory and re-reads it only at startup,
 * so changes take effect at the next harness restart; avoid GUI archive/move
 * operations between an edit and the restart (they rewrite the file from
 * memory and would drop the edit).
 */

const HELP = `wxy-workspace-ops — DeepSeek Harness 工具集（dsh-toolbox）· 会话工作区管理

用法:
  wxy-workspace-ops list [--json]
  wxy-workspace-ops move <sessionId> [--workspace <workspaceId|路径>]
  wxy-workspace-ops unarchive <sessionId>

说明:
  move 把"未分组"的会话挂到指定工作区（缺省 --workspace 时，若只有一个工作区则用那个）。
  unarchive 把会话移出归档列表。
  两者直接编辑 $DSH_HOME/storages/workspace.json（带时间戳备份），重启 Harness 后生效。
  重启前请勿在 GUI 中做归档/移动操作，否则会被内存状态覆盖。`

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
      if (eq !== -1) flags[key] = arg.slice(eq + 1)
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[key] = argv[i + 1]; i++ }
      else flags[key] = true
    } else {
      positional.push(arg)
    }
  }
  return { flags, positional }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const command = positional[0]
  if (command === undefined || command === 'help' || command === '-h' || command === '--help') {
    console.log(HELP)
    return
  }
  const mod = await import('../src/workspace.mjs')

  if (command === 'list') {
    const summary = await mod.summarize()
    if (flags.json === true) {
      console.log(JSON.stringify(summary, null, 2))
    } else {
      for (const ws of summary.workspaces) {
        console.log(`工作区 ${ws.title ?? ''} (${ws.path})`)
        for (const id of ws.sessionIds) console.log(`   • ${id}`)
      }
      console.log(`\n已归档 (${summary.archivedSessionIds.length}):`)
      for (const id of summary.archivedSessionIds) console.log(`   • ${id}`)
      console.log(`\n${summary.ungroupedNote}`)
    }
    return
  }

  if (command === 'move') {
    const sessionId = positional[1]
    if (sessionId === undefined) throw new Error('move 需要 <sessionId> 参数')
    const result = await mod.moveSession(sessionId, flags.workspace)
    console.log(`已将 ${sessionId} 移入工作区 ${result.path} (${result.workspaceId})`)
    console.log(`备份: ${result.backup}`)
    console.log(`注意: ${result.note}；重启前请勿在 GUI 中做归档/移动操作。`)
    return
  }

  if (command === 'unarchive') {
    const sessionId = positional[1]
    if (sessionId === undefined) throw new Error('unarchive 需要 <sessionId> 参数')
    const result = await mod.unarchiveSession(sessionId)
    if (result.alreadyUnarchived === true) {
      console.log(`${sessionId} 本来就不在归档列表中。`)
    } else {
      console.log(`已将 ${sessionId} 移出归档列表。备份: ${result.backup}`)
      console.log(`注意: ${result.note}；重启前请勿在 GUI 中做归档/移动操作。`)
    }
    return
  }

  throw new Error(`未知命令: ${command}\n${HELP}`)
}

main().catch((error) => {
  console.error(`wxy-workspace-ops: ${error.message}`)
  process.exit(1)
})
