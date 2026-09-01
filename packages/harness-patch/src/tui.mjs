/**
 * Minimal zero-dependency full-screen TUI for dtb-harness-patch.
 *
 * Renders a fixed set of content rows plus a footer operation bar. Every
 * repaint rewrites the screen in place (home + overwrite + clear-tail), so
 * numbers/progress bars change live without scrolling or flicker. Uses the
 * alternate screen buffer and restores the terminal on exit/Ctrl+C.
 *
 * Colors are plain ANSI SGR codes; progress bars paint the DONE segment with
 * a light background and the TODO segment with a dark background, so a bar
 * reads as "dark before, turning white as work completes".
 */
import { EOL } from 'node:os'

const ESC = '\x1b['
const hideCursor = `${ESC}?25l`
const showCursor = `${ESC}?25h`
const enterAlt = `${ESC}?1049h`
const leaveAlt = `${ESC}?1049l`
const home = `${ESC}H`
const clearLine = `${ESC}K`
const clearTail = `${ESC}J`

export const RESET = `${ESC}0m`
export const SGR = {
  dim: `${ESC}2m`,
  bright: `${ESC}1m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  brightBlack: `${ESC}90m`,
  bgDone: `${ESC}48;5;15m`,     // near-white block (done)
  bgTodo: `${ESC}48;5;236m`,    // dark grey block (todo)
}

/** Wrap text in a color (caller appends RESET or we do). */
export const paint = (code, text) => `${code}${text}${RESET}`

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** Visible width of a string: CJK & wide chars count as 2 cells. */
export function displayWidth(str) {
  let w = 0
  for (const ch of stripAnsi(str)) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1
  return w
}

/** Pad a string (which may contain ANSI codes) to `width` visible cells. */
export function pad(str, width) {
  const s = String(str)
  const w = displayWidth(s)
  return w >= width ? s : s + ' '.repeat(width - w)
}

/**
 * A simple ANSI renderer. Usage:
 *   const tui = createTui()
 *   tui.enter()
 *   tui.setContent([...rows])   // repaints immediately
 *   tui.setFooter([...lines])   // repaints immediately
 *   tui.exit()                  // restore terminal
 */
export function createTui({ stdout } = {}) {
  const out = stdout ?? process.stdout
  let content = []
  let footer = []
  let entered = false
  let paintScheduled = false

  const paint = () => {
    paintScheduled = false
    if (!entered) return
    const lines = [...content, ...(footer.length ? ['', ...footer] : [])]
    let frame = hideCursor + home
    for (const line of lines) frame += line + clearLine + EOL
    frame += clearTail
    out.write(frame)
  }
  // Coalesce multiple set* calls in the same tick into a single repaint so
  // content+footer updates don't flash two frames.
  const schedulePaint = () => {
    if (paintScheduled || !entered) return
    paintScheduled = true
    queueMicrotask(paint)
  }

  return {
    enter() {
      if (entered) return
      out.write(enterAlt + hideCursor)
      entered = true
      schedulePaint()
      const restore = () => this.exit()
      process.once('exit', restore)
    },
    exit() {
      if (!entered) return
      out.write(showCursor + leaveAlt)
      entered = false
    },
    setContent(rows) {
      content = rows
      schedulePaint()
    },
    setFooter(lines) {
      footer = lines
      schedulePaint()
    },
    get entered() { return entered },
  }
}

/**
 * Progress bar: DONE cells get a light (white) background, TODO cells a dark
 * one — dark before any work, gradually turning white as it completes.
 * Returns an ANSI-colored string of width `width` visible cells.
 */
export function progressBar(filled, total, width = 22) {
  const n = total <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((filled / total) * width)))
  const shown = filled > 0 && n === 0 ? 1 : n // at least one done cell once started
  let out = '['
  for (let i = 0; i < width; i++) {
    out += i < shown ? `${SGR.bgDone} ${RESET}` : `${SGR.bgTodo} ${RESET}`
  }
  return out + ']'
}
