#!/usr/bin/env node
/**
 * dtb-harness-patch — apply, verify, and unapply feature patches on the
 * installed DeepSeek Harness.
 *
 * Two user-visible feature groups:
 *   session-area — move sessions anywhere in the left sidebar
 *                  (workspace <-> ungrouped <-> archived), all directions.
 *   resilience   — a corrupt session log must not take the session surface down.
 *
 * Applying is declarative per block: official builds that already include a
 * change are detected and skipped; only genuinely missing changes are applied.
 * Group-level backups allow clean unapply.
 *
 * Usage:
 *   dtb-harness-patch                    apply all feature groups (default)
 *   dtb-harness-patch --apply <group>    apply one group
 *   dtb-harness-patch --unapply <group>  restore one group from backup
 *   dtb-harness-patch --unapply-all      restore every group from backup
 *   dtb-harness-patch --status           show per-group state (no changes)
 *   dtb-harness-patch --dsh-install <path>   explicit install root
 *   dtb-harness-patch --allow-unverified     skip the version check
 */
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

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.help === true || flags['-h'] === true) {
    console.log(`dtb-harness-patch — DeepSeek Harness 工具集（dsh-toolbox）· 给已安装的 Harness 打特性补丁

用法（推荐）:
  dtb-harness-patch                   应用全部特性组（幂等，升级 Harness 后重跑）
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

  const checkVersion = () => {
    const { version, supported, supportedVersions } = patch.checkHarnessVersion(dshInstall)
    if (version === null) {
      console.warn('⚠ 版本检测: 无法读取 dsh 的 package.json（继续执行，补丁按逐块字符串匹配，不匹配的块会跳过且不动文件）')
      return true
    }
    if (supported) {
      console.log(`✓ 版本检测: @deepseek-ai/dsh ${version}（已在此版本验证过）`)
      return true
    }
    if (flags['allow-unverified'] === true) {
      console.warn(`⚠ 版本检测: @deepseek-ai/dsh ${version} 不在已验证列表 [${supportedVersions.join(', ')}] 中；--allow-unverified 已跳过（不匹配的块仍会安全跳过）`)
      return true
    }
    console.error(`✗ 版本检测: @deepseek-ai/dsh ${version} 不在已验证列表 [${supportedVersions.join(', ')}] 中。`)
    console.error(`  补丁是逐块字符串替换：未验证版本中官方已改动的块会被跳过（警告），但已改动的目标代码无法识别时不会误改。`)
    console.error(`  如确认继续，加 --allow-unverified；或先跑 dtb-harness-patch --status 查看各块匹配情况。`)
    return false
  }

  const applyGroup = async (name) => {
    const results = await patch.applyGroup(dshInstall, name)
    for (const result of results) {
      if (result.changed) {
        console.log(`✓ 已应用: ${name} ${result.file}`)
        console.log(`    备份: ${result.backup}  （${result.applied} 块应用，${result.already} 块已具备，${result.skipped} 块跳过）`)
      } else if (result.alreadyPatched) {
        console.log(`✓ 已应用过: ${name} ${result.file}（${result.already} 块已具备，${result.skipped} 块跳过）`)
      }
    }
  }

  if (flags.status === true) {
    console.log('== 特性组状态（只读，按序模拟应用后的结果） ==')
    for (const s of patch.groupStatus(dshInstall)) {
      const parts = s.perFile.map((f) => f.missing
        ? `${f.fileKey}: 文件缺失`
        : `${f.fileKey}: 待应用 ${f.applied} | 已具备 ${f.already} | 无法匹配 ${f.skipped}`).join(' | ')
      const state = s.patched ? '已打' : (s.any ? '已打(部分)' : '未打')
      console.log(`  ${s.name}（${s.label}）[${state}${s.backupExists ? '，有备份' : ''}]\n    ${parts}`)
    }
    return
  }

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
    if (!checkVersion()) return
    await applyGroup(flags.apply)
    console.log(`\n${flags.apply} 已处理。client 补丁刷新浏览器即生效；host 补丁需重启一次 Harness。`)
    return
  }

  // default: apply all groups
  if (!checkVersion()) return
  for (const name of Object.keys(patch.FEATURE_GROUPS)) {
    await applyGroup(name)
  }
  console.log('\n全部特性组已处理。client 补丁刷新浏览器即生效；host 补丁（韧性、attach/detach、unarchive、跨目录移动）需重启一次 Harness。')
}

main().catch((error) => {
  console.error(`dtb-harness-patch: ${error.message}`)
  process.exit(1)
})
