/**
 * Minimal zero-dependency full-screen TUI for dtb-harness-patch.
 *
 * Renders a fixed set of content rows plus a footer operation bar. Every
 * repaint rewrites the screen in place (home + overwrite + clear-tail), so
 * numbers/progress bars change live without scrolling or flicker. Uses the
 * alternate screen buffer and restores the terminal on exit/Ctrl+C.
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

/** Render a progress bar: filled/total over `width` cells. */
export function progressBar(filled, total, width = 22) {
  const n = total <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((filled / total) * width)))
  // show at least one filled cell once there is any progress
  const shown = filled > 0 && n === 0 ? 1 : n
  return '[' + '█'.repeat(shown) + '░'.repeat(width - shown) + ']'
}

/** Pad a string to a fixed width for aligned columns. */
export function pad(str, width) {
  str = String(str)
  return str.length >= width ? str : str + ' '.repeat(width - str.length)
}
