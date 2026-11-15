/**
 * Overlays (lightbox, …) that the Android back button should close before it
 * navigates. The most recently pushed handler runs first; see useNativeShell.
 */
const handlers: Array<() => void> = []

/** Registers a back handler; call the returned function to remove it. */
export function pushBackHandler(fn: () => void): () => void {
  handlers.push(fn)
  return () => {
    const i = handlers.lastIndexOf(fn)
    if (i >= 0) handlers.splice(i, 1)
  }
}

/** Runs the topmost handler. False when none is registered. */
export function runBackHandler(): boolean {
  const fn = handlers[handlers.length - 1]
  if (!fn) return false
  fn()
  return true
}
