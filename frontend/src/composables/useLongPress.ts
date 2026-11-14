import { onBeforeUnmount } from "vue"

/** Minimal pointer event shape, so the handlers are testable without a DOM. */
export interface LongPressPointerEvent {
  pointerType: string
  button: number
  isPrimary?: boolean
  clientX: number
  clientY: number
  target: EventTarget | null
}

export interface LongPressOptions {
  /** Hold time before the press fires (ms). */
  delay?: number
  /** Finger movement (px) that turns the press into a scroll/drag. */
  moveTolerance?: number
  /** Return false to ignore a press (e.g. while editing). */
  enabled?: () => boolean
}

/** Elements inside `[data-no-long-press]` keep their own touch behaviour. */
const OPT_OUT_SELECTOR = "[data-no-long-press]"

function optedOut(target: EventTarget | null): boolean {
  const el = target as Element | null
  return typeof el?.closest === "function" && el.closest(OPT_OUT_SELECTOR) !== null
}

/**
 * Touch long-press detection. Bind the returned handlers on the element:
 * `@pointerdown`, `@pointermove`, `@pointerup`, `@pointercancel` and
 * `@click.capture` (swallows the click that follows a fired press).
 * Scrolling ends the press too: the browser sends pointercancel when it
 * takes the touch over for panning.
 */
export function createLongPress(onFire: () => void, options: LongPressOptions = {}) {
  const delay = options.delay ?? 450
  const tolerance = options.moveTolerance ?? 10

  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let suppressClick = false

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function onPointerdown(e: LongPressPointerEvent) {
    cancel()
    suppressClick = false
    if (e.pointerType !== "touch" || e.button !== 0 || e.isPrimary === false) return
    if (options.enabled && !options.enabled()) return
    if (optedOut(e.target)) return
    startX = e.clientX
    startY = e.clientY
    timer = setTimeout(() => {
      timer = null
      suppressClick = true
      if (typeof navigator !== "undefined") navigator.vibrate?.(10)
      onFire()
    }, delay)
  }

  function onPointermove(e: LongPressPointerEvent) {
    if (timer === null) return
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > tolerance) cancel()
  }

  function onClickCapture(e: Event) {
    if (!suppressClick) return
    suppressClick = false
    e.preventDefault()
    e.stopPropagation()
  }

  return {
    onPointerdown,
    onPointermove,
    onPointerup: cancel,
    onPointercancel: cancel,
    onClickCapture,
    cancel,
  }
}

/** createLongPress bound to a component: the timer is cleared on unmount. */
export function useLongPress(onFire: () => void, options: LongPressOptions = {}) {
  const handlers = createLongPress(onFire, options)
  onBeforeUnmount(handlers.cancel)
  return handlers
}
