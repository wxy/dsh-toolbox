#!/usr/bin/env node
/**
 * dsh-harness-patch — apply (or verify) the local resilience patch on the
 * installed DeepSeek Harness: session listing must survive corrupt logs.
 * Idempotent; original preserved at index.js.pre-resilience.bak; every apply
 * is behavior-verified in a fresh process (and rolled back on failure).
 * Re-run after harness upgrades.
 *
 * Usage:
 *   dsh-harness-patch [--dsh-install <path>]          resilience patch
 *   dsh-harness-patch --workspace-live [--dsh-install <path>]   live cross-workspace move
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
    console.log(`dsh-harness-patch — 给已安装的 Harness 打本地补丁

用法:
  dsh-harness-patch [--dsh-install <path>]              韧性补丁（坏日志不拖垮界面）
  dsh-harness-patch --workspace-live [--dsh-install <path>]   实时跨工作区移动会话

说明:
  • 幂等：已打过则直接跳过；修改前备份原文件。
  • 韧性补丁每次应用都在全新进程里做行为验证，失败自动回滚。
  • workspace-live：host 侧 insertSessionBefore 自动挂账（header cwd 匹配时），
    客户端支持把会话（含"未分组"）拖到工作区行实现实时移动。
  • Harness 升级（npm i -g / 重装）后需重跑对应命令。`)
    return
  }
  const dshInstall = findDshInstall(flags['dsh-install'])
  const { applyResiliencePatch, applyWorkspaceLivePatch, applyWorkspaceLivePatchV2, applyUngroupedDetachPatch } = await import('../src/patch.mjs')
  if (flags['workspace-live'] === true) {
    const results = await applyWorkspaceLivePatch(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 正在运行的 Harness 内存中仍是旧模块/旧界面，重启后生效；此后跨工作区拖拽即可实时移动会话。')
    return
  }
  if (flags['workspace-live-v2'] === true) {
    const results = await applyWorkspaceLivePatchV2(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用 v2:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: v2 需要先应用 v1；刷新浏览器即可看到高亮与实时更新（无需重启）。')
    return
  }
  if (flags['ungrouped-detach'] === true) {
    const results = await applyUngroupedDetachPatch(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 需要先应用 workspace-live（v1）。host 侧需重启 Harness；刷新浏览器后未分组桶会常驻显示，可把工作区里的会话拖进未分组。')
    return
  }
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
