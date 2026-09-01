/**
 * Full-screen TUI flow for dtb-harness-patch.
 *
 * Renders a live status table (one line per file, with progress bars), a
 * footer operation bar, and drives apply/unapply from single-key input:
 *   [Enter] apply · [U] unapply · [S] refresh · [Q] quit
 * After an apply that left unmatched blocks, a failure menu offers:
 *   [1] unapply all · [2] upgrade Harness · [3] upgrade this module · [4] keep
 *
 * `io` is injectable for tests ({ stdin, stdout }); defaults to process.*.
 */
import { createTui, progressBar, pad, paint, SGR, RESET, displayWidth } from './tui.mjs'

export async function runTuiFlow({ patch, dshInstall, FILE_LABEL, flags, io } = {}) {
  const stdin = io?.stdin ?? process.stdin
  const stdout = io?.stdout ?? process.stdout
  const screen = createTui({ stdout })
  const state = { done: false, applying: false, failed: false, failedNotes: [] }

  // ---- column layout (visible-width aligned) ----
  const LABEL_W = 20 // file label column
  const BAR_W = 22  // progress bar cells
  const PCT_W = 4   // "100%"

  const markFor = (s) => s.patched
    ? paint(SGR.green, '✓ 已打')
    : (s.any ? paint(SGR.yellow, '◐ 部分') : paint(SGR.dim, '· 未打'))

  const fileLine = (f) => {
    const label = FILE_LABEL[f.fileKey] ?? f.fileKey
    if (f.missing) return `  ${pad(label, LABEL_W)} ${paint(SGR.red, '文件缺失')}`
    const total = f.applied + f.already + f.skipped
    const done = f.already + f.skipped // satisfied blocks (applied/already) count toward the bar
    const pct = total ? Math.round((done / total) * 100) : 100
    const bar = progressBar(done, total, BAR_W)
    const pending = paint(f.applied > 0 ? SGR.white : SGR.dim, String(f.applied))
    const have = paint(f.already > 0 ? SGR.green : SGR.dim, String(f.already))
    const bad = f.skipped > 0 ? paint(SGR.red, `· 无法匹配 ${f.skipped}`) : ''
    return `  ${pad(label, LABEL_W)} ${bar} ${pad(pct + '%', PCT_W)} 待应用 ${pending} · 已具备 ${have}${bad}`
  }

  const refresh = () => {
    const status = patch.groupStatus(dshInstall)
    const rows = []
    for (const s of status) {
      const backup = s.backupExists ? paint(SGR.dim, '，有备份') : ''
      rows.push(`\n${s.name}（${s.label}）[${markFor(s)}${backup}]`)
      for (const f of s.perFile) rows.push(fileLine(f))
    }
    screen.setContent(rows)
  }
  const footer = (statusLine, opsLine) => screen.setFooter([`  ${statusLine}`, `  ${paint(SGR.cyan, opsLine)}`])

  const applyAll = async () => {
    state.applying = true
    footer(paint(SGR.cyan, '状态: 正在应用 ...'), '[Q] 退出')
    for (const name of Object.keys(patch.FEATURE_GROUPS)) {
      await patch.applyGroup(dshInstall, name, (tick) => {
        footer(paint(SGR.cyan, `状态: 应用 ${name} · ${tick.marker}${tick.applied ? ` · ${tick.applied} 块` : ''}`), '[Q] 退出')
        refresh()
      })
    }
    const status = patch.groupStatus(dshInstall)
    const unmatched = []
    for (const s of status) {
      for (const f of s.perFile) {
        if (f.skipped > 0) unmatched.push(`${FILE_LABEL[f.fileKey] ?? f.fileKey}: ${f.skipped} 块无法匹配`)
      }
    }
    state.done = true
    state.applying = false
    state.failed = unmatched.length > 0
    state.failedNotes = unmatched
    refresh()
    if (state.failed) {
      footer(paint(SGR.yellow, '⚠ 有补丁块无法匹配（官方可能已改动）。选择下一步:'), '[1] 撤销 · [2] 升级 Harness · [3] 升级补丁模块 · [4] 保持现状')
    } else {
      footer(paint(SGR.green, '✓ 全部补丁已应用。刷新浏览器；host 补丁需重启一次 Harness。'), '[U] 撤销 · [Q] 退出')
    }
  }

  const unapplyAll = async () => {
    footer(paint(SGR.cyan, '正在撤销 ...'), '[Q] 退出')
    for (const name of Object.keys(patch.FEATURE_GROUPS)) {
      await patch.unapplyGroup(dshInstall, name)
    }
    state.done = false
    state.failed = false
    refresh()
    footer(paint(SGR.green, '✓ 已撤销，恢复应用前状态。'), '[Enter] 重新应用 · [S] 刷新 · [Q] 退出')
  }

  screen.enter()
  refresh()
  footer(paint(SGR.white, '状态: 待确认 · 尚未修改任何文件'), '[Enter] 应用 · [U] 撤销 · [S] 刷新 · [Q] 退出')

  try {
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true)
    if (typeof stdin.resume === 'function') stdin.resume()
    await new Promise((resolve) => {
      const onData = async (buf) => {
        const key = buf.toString()
        if (state.applying) return
        if (key === '\u0003' || key === 'q' || key === 'Q') { cleanup(); resolve(); return }
        if (key === 's' || key === 'S') { refresh(); return }
        if (key === 'u' || key === 'U') { await unapplyAll(); return }
        if (state.failed && ['1', '2', '3', '4'].includes(key)) {
          if (key === '1') { await unapplyAll(); return }
          if (key === '2') {
            footer('  升级 Harness:', '  npm i -g @deepseek-ai/dsh@latest ，然后重跑本工具 · [Q] 退出')
            return
          }
          if (key === '3') {
            footer('  升级补丁模块:', '  npm i -g @dsh-toolbox/harness-patch@latest ，然后重跑本工具 · [Q] 退出')
            return
          }
          if (key === '4') {
            footer(paint(SGR.yellow, '已保持现状。未匹配的块未打；已应用的生效（刷新浏览器 / 重启 Harness）。'), '[U] 撤销 · [Q] 退出')
            return
          }
        }
        if (key === '\r' || key === '\n' || key === 'y' || key === 'Y') {
          if (!state.done) { await applyAll(); return }
        }
      }
      const cleanup = () => {
        if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false)
        if (typeof stdin.pause === 'function') stdin.pause()
      }
      stdin.on('data', onData)
      const onSigint = () => { cleanup(); resolve() }
      process.once('SIGINT', onSigint)
      stdin.once('close', () => { cleanup(); resolve() })
    })
  } finally {
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false)
    screen.exit()
  }
}
