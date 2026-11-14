import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLongPress, type LongPressPointerEvent } from "./useLongPress"

function touch(over: Partial<LongPressPointerEvent> = {}): LongPressPointerEvent {
  return {
    pointerType: "touch",
    button: 0,
    isPrimary: true,
    clientX: 100,
    clientY: 100,
    target: null,
    ...over,
  }
}

describe("createLongPress", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("fires after the hold delay", () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { delay: 450 })
    lp.onPointerdown(touch())
    vi.advanceTimersByTime(449)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledOnce()
  })

  it("is cancelled by an early release", () => {
    const fire = vi.fn()
    const lp = createLongPress(fire)
    lp.onPointerdown(touch())
    vi.advanceTimersByTime(200)
    lp.onPointerup()
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
  })

  it("is cancelled by moving past the tolerance, not by jitter", () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { moveTolerance: 10 })
    lp.onPointerdown(touch())
    lp.onPointermove(touch({ clientX: 104, clientY: 105 }))
    vi.advanceTimersByTime(1000)
    expect(fire).toHaveBeenCalledOnce()

    fire.mockClear()
    lp.onPointerdown(touch())
    lp.onPointermove(touch({ clientY: 130 }))
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
  })

  it("is cancelled by pointercancel (scroll takeover)", () => {
    const fire = vi.fn()
    const lp = createLongPress(fire)
    lp.onPointerdown(touch())
    lp.onPointercancel()
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
  })

  it("ignores mouse and pen pointers", () => {
    const fire = vi.fn()
    const lp = createLongPress(fire)
    lp.onPointerdown(touch({ pointerType: "mouse" }))
    lp.onPointerdown(touch({ pointerType: "pen" }))
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
  })

  it("ignores presses when disabled", () => {
    const fire = vi.fn()
    const lp = createLongPress(fire, { enabled: () => false })
    lp.onPointerdown(touch())
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
  })

  it("ignores targets inside [data-no-long-press]", () => {
    const fire = vi.fn()
    const lp = createLongPress(fire)
    const inside = { closest: (sel: string) => (sel === "[data-no-long-press]" ? {} : null) }
    const outside = { closest: () => null }
    lp.onPointerdown(touch({ target: inside as unknown as EventTarget }))
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
    lp.onPointerdown(touch({ target: outside as unknown as EventTarget }))
    vi.advanceTimersByTime(1000)
    expect(fire).toHaveBeenCalledOnce()
  })

  it("swallows only the click that follows a fired press", () => {
    const lp = createLongPress(() => {})
    const click = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() })

    lp.onPointerdown(touch())
    lp.onPointerup()
    const tap = click()
    lp.onClickCapture(tap as unknown as Event)
    expect(tap.preventDefault).not.toHaveBeenCalled()

    lp.onPointerdown(touch())
    vi.advanceTimersByTime(1000)
    lp.onPointerup()
    const afterPress = click()
    lp.onClickCapture(afterPress as unknown as Event)
    expect(afterPress.preventDefault).toHaveBeenCalled()
    expect(afterPress.stopPropagation).toHaveBeenCalled()

    const next = click()
    lp.onClickCapture(next as unknown as Event)
    expect(next.preventDefault).not.toHaveBeenCalled()
  })
})
