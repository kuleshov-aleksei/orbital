/**
 * Byte-range bookkeeping for partially downloaded media: a sorted list of
 * disjoint, non-adjacent half-open intervals [start, end).
 * Ported 1:1 to mobile/android/.../MediaCache.java (Ranges).
 */
export type Interval = [start: number, end: number]

/** Adds [start, end) to a sorted interval list, merging overlaps and neighbours. */
export function addRange(list: Interval[], start: number, end: number): Interval[] {
  if (end <= start) return list
  const out: Interval[] = []
  let s = start
  let e = end
  let placed = false
  for (const [a, b] of list) {
    if (b < s) {
      out.push([a, b])
    } else if (a > e) {
      if (!placed) {
        out.push([s, e])
        placed = true
      }
      out.push([a, b])
    } else {
      s = Math.min(s, a)
      e = Math.max(e, b)
    }
  }
  if (!placed) out.push([s, e])
  return out
}

/** True when the list covers [0, total). */
export function coversAll(list: Interval[], total: number): boolean {
  return list.length === 1 && list[0][0] === 0 && list[0][1] >= total
}

/** Parses "bytes start-end/total" (Content-Range); null when unusable. */
export function parseContentRange(
  header: string | null,
): { start: number; total: number } | null {
  const m = header ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header.trim()) : null
  if (!m) return null
  return { start: Number(m[1]), total: Number(m[3]) }
}
