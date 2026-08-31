#!/usr/bin/env node
/**
 * wxy-harness-patch — apply (or verify) the local resilience patch on the
 * installed DeepSeek Harness: session listing must survive corrupt logs.
 * Idempotent; original preserved at index.js.pre-resilience.bak; every apply
 * is behavior-verified in a fresh process (and rolled back on failure).
 * Re-run after harness upgrades.
 *
 * Usage:
 *   wxy-harness-patch [--dsh-install <path>]          resilience patch
 *   wxy-harness-patch --workspace-live [--dsh-install <path>]   live cross-workspace move
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
    console.log(`wxy-harness-patch — DeepSeek Harness 工具集（dsh-toolbox）· 给已安装的 Harness 打本地补丁

用法（推荐）:
  wxy-harness-patch                   一条命令应用全部补丁（幂等，升级 Harness 后重跑）
  wxy-harness-patch --all             同上（显式）

高级（单独重打某一项，一般不需要）:
  --workspace-live / --workspace-live-v2 / --ungrouped-detach / --blue-bar
  --new-session-anchor / --ungrouped-anchor / --blank-visible
  --detach-payload-fix / --move-error-clarity / --workspace-bundle

说明:
  • 幂等：已打过则直接跳过；修改前备份原文件。
  • 韧性补丁每次应用都在全新进程里做行为验证，失败自动回滚。
  • workspace-live：host 侧 insertSessionBefore 自动挂账（header cwd 匹配时），
    客户端支持把会话（含"未分组"）拖到工作区行实现实时移动。
  • Harness 升级（npm i -g / 重装）后需重跑对应命令。`)
    return
  }
  const dshInstall = findDshInstall(flags['dsh-install'])
  const patch = await import('../src/patch.mjs')
  const applyAll = async () => {
    const steps = [
      ['韧性补丁', () => patch.applyResiliencePatch(dshInstall)],
      ['workspace-live(v1)', () => patch.applyWorkspaceLivePatch(dshInstall)],
      ['workspace-live-v2', () => patch.applyWorkspaceLivePatchV2(dshInstall)],
      ['ungrouped-detach(v3)', () => patch.applyUngroupedDetachPatch(dshInstall)],
      ['blue-bar(v4)', () => patch.applyBlueBarDragPatch(dshInstall)],
      ['new-session-anchor(v5)', () => patch.applyUngroupedNewSessionPatch(dshInstall)],
      ['ungrouped-anchor(v6)', () => patch.applyUngroupedAnchorPatch(dshInstall)],
      ['blank-visible(v7)', () => patch.applyUngroupedBlankVisiblePatch(dshInstall)],
      ['detach-payload-fix(v8)', () => patch.applyDetachPayloadFix(dshInstall)],
      ['move-error-clarity(v9)', () => patch.applyMoveErrorClarityPatch(dshInstall)],
      ['workspace-bundle host(v10)', () => patch.applyWorkspaceBundleHostPatch(dshInstall)],
      ['workspace-bundle client(v11)', () => patch.applyWorkspaceBundleClientPatch(dshInstall)],
      ['archived-label(v12)', () => patch.applyArchivedLabelPatch(dshInstall)],
      ['move-persistence-fix(v13)', () => patch.applyMovePersistenceFix(dshInstall)],
      ['empty-drop-row(v14)', () => patch.applyEmptyDropRowPatch(dshInstall)],
      ['hover-placeholder(v15)', () => patch.applyHoverPlaceholderPatch(dshInstall)],
    ]
    for (const [label, fn] of steps) {
      try {
        const results = await fn()
        const list = Array.isArray(results) ? results : [results]
        for (const result of list) {
          if (result.alreadyPatched === true) console.log('✓ 已应用过:', label)
          else console.log('✓ 已应用:', label, result.file)
        }
      } catch (error) {
        console.error('✗ 失败:', label, '-', error.message)
        process.exitCode = 1
        return
      }
    }
    console.log('\n全部补丁已应用。client 补丁刷新浏览器即生效；host 补丁（韧性、attach/detach、unarchive、跨目录移动）需重启一次 Harness。')
  }
  if (flags.all === true || Object.keys(flags).filter((k) => k !== 'dsh-install' && k !== 'all' && k !== 'help').length === 0) {
    await applyAll()
    return
  }
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
  if (flags['blue-bar'] === true) {
    const results = await applyBlueBarDragPatch(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 需要先应用 workspace-live(v1)/ungrouped-detach(v3)。刷新浏览器即可——拖拽会话跨组时显示蓝色插入条，落点即插入位置。')
    return
  }
  if (flags['new-session-anchor'] === true) {
    const results = await applyUngroupedNewSessionPatch(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 刷新浏览器即可——未分组桶下出现"＋ 新会话"锚点（点击创建未分组会话，也是拖拽落点）。')
    return
  }
  if (flags['ungrouped-anchor'] === true) {
    const results = await applyUngroupedAnchorPatch(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 需要先应用 new-session-anchor(v5)。刷新浏览器即可——未分组桶空时会自动常驻一个空会话（可点开使用，也是拖拽落点）。')
    return
  }
  if (flags['blank-visible'] === true) {
    const results = await applyUngroupedBlankVisiblePatch(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 刷新浏览器即可——未分组桶现在会显示空会话（默认是被隐藏的），既有锚点也可见。')
    return
  }
  if (flags['detach-payload-fix'] === true) {
    const results = await applyDetachPayloadFix(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 修复 rpc.call 载荷封装（去掉 {args:...} 包装）。刷新浏览器即可。')
    return
  }
  if (flags['move-error-clarity'] === true) {
    const results = await patch.applyMoveErrorClarityPatch(dshInstall)
    for (const result of results) {
      if (result.alreadyPatched === true) console.log('已应用过:', result.file)
      else console.log('已应用:', result.file, '\n  备份:', result.backup)
    }
    console.log('注意: 刷新浏览器即可——跨目录移动失败时会说明会话工作目录与目标工作区路径的差异。')
    return
  }
  if (flags['workspace-bundle'] === true) {
    for (const fn of [() => patch.applyWorkspaceBundleHostPatch(dshInstall), () => patch.applyWorkspaceBundleClientPatch(dshInstall)]) {
      const results = await fn()
      for (const result of results) {
        if (result.alreadyPatched === true) console.log('已应用过:', result.file)
        else console.log('已应用:', result.file, '\n  备份:', result.backup)
      }
    }
    console.log('注意: 归档文件夹/拖拽解除归档需刷新浏览器；unarchive/跨目录移动 RPC 需重启一次 Harness。')
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
  console.error(`wxy-harness-patch: ${error.message}`)
  process.exit(1)
})
