#!/usr/bin/env node
/**
 * dsh-harness-patch — apply (or verify) the local resilience patch on the
 * installed DeepSeek Harness: session listing must survive corrupt logs.
 * Idempotent; original preserved at index.js.pre-resilience.bak; every apply
 * is behavior-verified in a fresh process (and rolled back on failure).
 * Re-run after harness upgrades.
 *
 * Usage:
 *   dsh-harness-patch [--dsh-install <path>]
 */
import { findDshInstall } from '../../core/src/harness.mjs'

function parseArgs(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
      if (eq !== -1) flags[key] = arg.slice(eq + 1)
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[key] = argv[i + 1]; i++ }
      else flags[key] = true
    }
  }
  return flags
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.help === true || flags['-h'] === true) {
    console.log(`dsh-harness-patch — 给已安装的 Harness 打"坏日志不拖垮整个界面"的韧性补丁

用法:
  dsh-harness-patch [--dsh-install <path>]

说明:
  • 幂等：已打过则直接跳过。
  • 修改前备份原文件为 index.js.pre-resilience.bak。
  • 每次应用都在全新进程里做行为验证（健康会话 + 损坏会话混合目录），失败自动回滚。
  • Harness 升级（npm i -g / 重装）后需重跑本命令。`)
    return
  }
  const dshInstall = findDshInstall(flags['dsh-install'])
  const { applyResiliencePatch } = await import('../src/patch.mjs')
  const result = await applyResiliencePatch(dshInstall)
  if (result.alreadyPatched === true) {
    console.log('补丁已应用过，无需重复。', result.target)
  } else {
    console.log('补丁已应用:', result.target)
    console.log('备份:', result.backup)
    console.log(result.verified)
    console.log('注意: 正在运行的 Harness 内存中仍是旧模块，重启后生效。')
  }
}

main().catch((error) => {
  console.error(`dsh-harness-patch: ${error.message}`)
  process.exit(1)
})
