#!/usr/bin/env node
/**
 * wxy-session-care — session-log health check and repair (the "no more bricked
 * harness because of one bad log" plugin).
 *
 * Usage:
 *   wxy-session-care health [--root <dir>] [--session <id>] [--json]
 *   wxy-session-care repair [--root <dir>] [--session <id>] [--apply] [--json]
 *
 * Default root: $DSH_HOME/sessions (~/.dsh/sessions). repair is a dry run
 * unless --apply is given; every written repair preserves the original at
 * `<path>.corrupt-<ts>` and is re-verified with the reader's own checks first.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findDshInstall } from '@dsh-toolbox/core/src/harness.mjs'

const HELP = `wxy-session-care — DeepSeek Harness 工具集（dsh-toolbox）· 会话日志健康检查与修复

用法:
  wxy-session-care health [--root <dir>] [--session <id>] [--json]
  wxy-session-care repair [--root <dir>] [--session <id>] [--apply] [--json]

选项:
  --root <dir>      会话根目录（默认 $DSH_HOME/sessions）
  --session <id>    只处理指定会话
  --apply           repair 时真正写盘（默认仅出修复计划，dry run）
  --json            机器可读输出
  --dsh-install <path>  已安装 dsh 包根目录（默认自动探测）
  --compression <zstd|none>
`

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
      if (eq !== -1) {
        flags[key] = arg.slice(eq + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1]
        i++
      } else {
        flags[key] = true
      }
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
  const dshInstall = findDshInstall(flags['dsh-install'])
  const root = flags.root ?? join(dshHome(), 'sessions')
  const compression = flags.compression ?? 'zstd'

  if (command === 'health') {
    const { scanRoot } = await import('../src/validate.mjs')
    const diagnostics = await scanRoot(dshInstall, root, compression)
    const filtered = flags.session === undefined
      ? diagnostics
      : diagnostics.filter(diag => diag.id === flags.session)
    if (flags.json === true) {
      console.log(JSON.stringify({ root, compression, diagnostics: filtered }, null, 2))
    } else {
      let bad = 0
      for (const diag of filtered) {
        const icon = diag.status === 'ok' ? '✅' : diag.status === 'corrupt' ? '⚠️' : '❌'
        if (diag.status !== 'ok') bad++
        console.log(`${icon} ${diag.id}  ${diag.status}  events=${diag.events} frames=${diag.frames}${diag.issue === undefined ? '' : `  — ${diag.issue}`}`)
      }
      console.log(bad === 0
        ? `\n全部 ${filtered.length} 个会话日志健康。`
        : `\n发现 ${bad} 个问题日志；运行 "wxy-session-care repair --apply" 尝试修复。`)
    }
    return
  }

  if (command === 'repair') {
    const { repairRoot } = await import('../src/repair.mjs')
    const apply = flags.apply === true
    const reports = await repairRoot(dshInstall, root, {
      apply,
      sessionId: flags.session,
      compression,
    })
    if (flags.json === true) {
      console.log(JSON.stringify(reports, null, 2))
    } else {
      for (const { plan, applied } of reports) {
        const tag = applied === true ? '已修复' : plan.strategy === 'none' ? '无法自动修复' : '计划'
        console.log(`${plan.strategy === 'none' ? '❌' : applied === true ? '✅' : '🔧'} ${plan.id}  [${tag}]  ${plan.strategy}  — ${plan.detail}${plan.backupPath === undefined ? '' : `\n    备份: ${plan.backupPath}`}`)
      }
      if (reports.length === 0) console.log('没有发现可修复的损坏日志。')
      else if (!apply) console.log('\n以上为修复计划（dry run），加 --apply 才会写盘。')
    }
    return
  }

  throw new Error(`未知命令: ${command}\n${HELP}`)
}

main().catch((error) => {
  console.error(`wxy-session-care: ${error.message}`)
  process.exit(1)
})
