#!/usr/bin/env node
/**
 * dtb-harness-patch — interactive apply / verify / unapply of feature patches
 * on the installed DeepSeek Harness.
 *
 * Two user-visible feature groups:
 *   session-area — move sessions anywhere in the left sidebar
 *                  (workspace <-> ungrouped <-> archived), all directions.
 *   resilience   — a corrupt session log must not take the session surface down.
 *
 * Default (no flags) runs an interactive flow:
 *   1. show the current state (one line per file, per group)
 *   2. ask for confirmation before touching anything
 *   3. apply group by group, ticking each patch as it completes
 *   4. on any unmatched block, offer: unapply / upgrade Harness / upgrade
 *      this patch module — the user decides.
 *
 * Non-interactive flags:
 *   --apply <group> / --unapply <group> / --unapply-all / --status
 *   --dsh-install <path> / --allow-unverified / --yes (skip confirmation)
 */
import { readFileSync } from 'node:fs'
import readline from 'node:readline'
import { findDshInstall } from '@dsh-toolbox/core/src/harness.mjs'

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

const prompt = (question, rl) => new Promise((resolve) => rl.question(question, resolve))
const createRl = () => readline.createInterface({ input: process.stdin, output: process.stdout })

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.help === true || flags['-h'] === true) {
    console.log(`dtb-harness-patch — DeepSeek Harness 工具集（dsh-toolbox）· 给已安装的 Harness 打特性补丁

用法（推荐，交互式）:
  dtb-harness-patch               查看状态 → 确认 → 逐补丁应用；失败后可撤销/升级
  dtb-harness-patch --yes         交互流程但跳过"确认"询问（仍打印状态与结果）

非交互命令:
  dtb-harness-patch --apply <组>      只应用一个组（session-area / resilience）
  dtb-harness-patch --unapply <组>    撤销一个组（从组级备份恢复）
  dtb-harness-patch --unapply-all     撤销全部组
  dtb-harness-patch --status          查看各组状态（不改动文件）
  dtb-harness-patch --allow-unverified  跳过版本检测

特性组:
  session-area  会话区管理：左侧边栏任意移动会话（工作区 ↔ 未分组 ↔ 归档，全向）
  resilience    会话历史韧性：一个坏日志不再拖垮会话列表

说明:
  • 逐块声明式：官方版本已包含的修改自动识别并跳过，只补真正缺失的块；
    某块与当前版本不匹配时仅跳过该块并警告，不会中止、不会破坏文件。
  • 修改前备份为 <文件>.dtb-pre-<组>.bak，撤销 = 恢复该备份。
  • 版本检测：已安装 dsh 版本不在已验证列表时警告（可用 --allow-unverified 跳过）。
  • Harness 升级（npm i -g / 重装）后需重跑：先 --unapply-all 或直接重打。`)
    return
  }
  const dshInstall = findDshInstall(flags['dsh-install'])
  const patch = await import('../src/patch.mjs')

  const FILE_LABEL = { client: 'client.js', host: 'host index.js', workspace: 'workspace index.js', persistence: 'persistence index.js' }

  const renderStatus = () => {
    const status = patch.groupStatus(dshInstall)
    const lines = []
    for (const s of status) {
      const state = s.patched ? '✓ 已打' : (s.any ? '◐ 已打(部分)' : '· 未打')
      lines.push(`\n${s.name}（${s.label}）[${state}${s.backupExists ? '，有备份' : ''}]`)
      for (const f of s.perFile) {
        if (f.missing) { lines.push(`    ${FILE_LABEL[f.fileKey] ?? f.fileKey}: 文件缺失`); continue }
        const mark = f.applied === 0 && f.skipped === 0 ? '✓' : '·'
        lines.push(`    ${mark} ${FILE_LABEL[f.fileKey] ?? f.fileKey}: 待应用 ${f.applied} | 已具备 ${f.already} | 无法匹配 ${f.skipped}`)
      }
    }
    return lines
  }

  const printStatus = () => {
    console.log('== 特性组状态（只读，按序模拟应用后的结果） ==')
    for (const line of renderStatus()) console.log(line)
    console.log()
  }

  if (flags.status === true) { printStatus(); return }

  if (flags['unapply-all'] === true) {
    for (const name of Object.keys(patch.FEATURE_GROUPS)) {
      const results = await patch.unapplyGroup(dshInstall, name)
      for (const r of results) {
        if (r.restored) console.log(`✓ 已撤销: ${name} ${r.file}（从备份恢复）`)
        else if (r.missingBackup) console.log(`  - ${name} ${r.file}: 无备份（未打过或 Harness 已重装）`)
      }
    }
    console.log('\n已恢复。client 补丁刷新浏览器即生效；host 补丁需重启一次 Harness。')
    return
  }

  if (flags.unapply !== undefined && flags.unapply !== true) {
    const results = await patch.unapplyGroup(dshInstall, flags.unapply)
    let any = false
    for (const r of results) {
      if (r.restored) { console.log(`✓ 已撤销: ${flags.unapply} ${r.file}（从备份恢复）`); any = true }
      else if (r.missingBackup) console.log(`  - ${flags.unapply} ${r.file}: 无备份（未打过或 Harness 已重装）`)
    }
    if (!any) console.log(`\n${flags.unapply} 无备份可恢复。`)
    else console.log(`\n${flags.unapply} 已撤销。刷新浏览器 / 重启 Harness 生效。`)
    return
  }

  if (flags.apply !== undefined && flags.apply !== true) {
    const { version, supported } = patch.checkHarnessVersion(dshInstall)
    if (!supported && flags['allow-unverified'] !== true && version !== null) {
      console.error(`✗ 版本检测: @deepseek-ai/dsh ${version} 不在已验证列表；加 --allow-unverified 强制继续。`)
      return
    }
    const results = await patch.applyGroup(dshInstall, flags.apply)
    for (const result of results) {
      if (result.changed) {
        console.log(`✓ 已应用: ${flags.apply} ${result.file}  （${result.applied} 块应用，${result.already} 块已具备，${result.skipped} 块跳过）`)
      } else if (result.alreadyPatched) {
        console.log(`✓ 已应用过: ${flags.apply} ${result.file}（${result.already} 块已具备，${result.skipped} 块跳过）`)
      }
    }
    return
  }

  // ---------------- interactive flow (default) ----------------
  const { version, supported, supportedVersions } = patch.checkHarnessVersion(dshInstall)
  if (version === null) {
    console.warn('⚠ 版本检测: 无法读取 dsh 的 package.json（补丁按逐块字符串匹配，不匹配的块会跳过且不动文件）')
  } else if (supported) {
    console.log(`✓ 版本检测: @deepseek-ai/dsh ${version}（已在此版本验证过）`)
  } else if (flags['allow-unverified'] === true) {
    console.warn(`⚠ 版本检测: @deepseek-ai/dsh ${version} 不在已验证列表 [${supportedVersions.join(', ')}] 中；--allow-unverified 已跳过（不匹配的块仍会安全跳过）`)
  } else {
    console.warn(`⚠ 版本检测: @deepseek-ai/dsh ${version} 不在已验证列表 [${supportedVersions.join(', ')}] 中。`)
    console.warn('  补丁是逐块字符串替换：未验证版本中官方已改动的块会被跳过（警告），不会误改。')
  }

  printStatus()

  let proceed = flags.yes === true
  if (!proceed) {
    const rl = createRl()
    try {
      const ans = await prompt('是否应用全部特性补丁？(y/N) ', rl)
      proceed = /^y(es)?$/i.test(ans.trim())
    } finally {
      rl.close()
    }
  }
  if (!proceed) {
    console.log('已取消，未做任何修改。')
    return
  }

  // apply group by group with live per-patch ticks
  let anyUnmatched = false
  const unmatchedNotes = []
  for (const name of Object.keys(patch.FEATURE_GROUPS)) {
    console.log(`\n▸ 应用 ${name} ...`)
    const results = await patch.applyGroup(dshInstall, name, (tick) => {
      const fileLabel = FILE_LABEL[tick.file] ?? tick.file
      if (tick.skipped > 0) {
        console.log(`  ⚠ ${fileLabel} / ${tick.marker}: ${tick.applied} 块应用，${tick.skipped} 块无法匹配`)
      } else if (tick.applied > 0) {
        console.log(`  ✓ ${fileLabel} / ${tick.marker}: 已应用 ${tick.applied} 块`)
      } else if (tick.already > 0) {
        console.log(`  ✓ ${fileLabel} / ${tick.marker}: 已具备`)
      }
    })
    for (const result of results) {
      if (result.skipped > 0) {
        anyUnmatched = true
        unmatchedNotes.push(`${result.file}: ${result.skipped} 块无法匹配 (${result.skippedNotes.join(', ')})`)
      }
    }
  }

  console.log('\n== 应用后状态 ==')
  printStatus()
  console.log('client 补丁刷新浏览器即生效；host 补丁（韧性、attach/detach、unarchive、跨目录移动）需重启一次 Harness。')

  if (!anyUnmatched) return

  // failure menu
  console.log('\n⚠ 有补丁块在当前 Harness 版本中无法匹配（官方可能已改动这些代码）。')
  for (const note of unmatchedNotes) console.log('   - ' + note)
  console.log('\n请选择下一步:')
  console.log('  [1] 撤销本次应用，恢复原样')
  console.log('  [2] 升级 Harness（npm 安装最新 @deepseek-ai/dsh），再重跑本工具')
  console.log('  [3] 升级本补丁模块（等待 dsh-toolbox 发布适配新版本的补丁），再重跑')
  console.log('  [4] 保持现状退出（未匹配的块保持未打，已打的生效）')
  const rl = createRl()
  let choice = '4'
  try {
    const ans = await prompt('选择 [1-4]，默认 4: ', rl)
    if (ans.trim() !== '') choice = ans.trim()
  } finally {
    rl.close()
  }
  switch (choice) {
    case '1': {
      console.log('\n撤销全部补丁...')
      for (const name of Object.keys(patch.FEATURE_GROUPS)) {
        const results = await patch.unapplyGroup(dshInstall, name)
        for (const r of results) {
          if (r.restored) console.log(`✓ 已撤销: ${name} ${r.file}（从备份恢复）`)
          else if (r.missingBackup) console.log(`  - ${name} ${r.file}: 无备份（未打过或 Harness 已重装）`)
        }
      }
      console.log('\n已恢复到应用前的原始状态。')
      break
    }
    case '2':
      console.log('\n升级 Harness:')
      console.log('  npm i -g @deepseek-ai/dsh@latest')
      console.log('升级后重新运行 dtb-harness-patch；若新版本仍未验证，工具会提示并可加 --allow-unverified。')
      break
    case '3':
      console.log('\n升级补丁模块:')
      console.log('  npm i -g @dsh-toolbox/harness-patch@latest   （npm 渠道）')
      console.log('  或拉取仓库最新代码: git -C ~/develop/dsh-toolbox pull && node packages/harness-patch/bin/dtb-harness-patch.mjs')
      console.log('升级后重新运行 dtb-harness-patch。')
      break
    default:
      console.log('\n保持现状。未匹配的块保持未打；已应用的块已生效（刷新浏览器 / 重启 Harness）。')
  }
}

main().catch((error) => {
  console.error(`dtb-harness-patch: ${error.message}`)
  process.exit(1)
})
