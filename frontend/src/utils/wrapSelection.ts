export interface WrapResult {
  value: string
  start: number
  end: number
}

/**
 * Toggles a markup marker (`**`, `*`, `~~`, `||`) around [start, end):
 * unwraps when the selection is already wrapped (inside or just outside it),
 * wraps otherwise. The returned range keeps the same text selected.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
): WrapResult {
  const selected = value.slice(start, end)
  const n = marker.length
  if (selected.length >= 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(n, -n)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    }
  }
  if (value.slice(start - n, start) === marker && value.slice(end, end + n) === marker) {
    return {
      value: value.slice(0, start - n) + selected + value.slice(end + n),
      start: start - n,
      end: end - n,
    }
  }
  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    start: start + n,
    end: end + n,
  }
}
