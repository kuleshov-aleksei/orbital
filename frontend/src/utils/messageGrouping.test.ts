import { describe, expect, it } from "vitest"
import {
  buildTimeline,
  formatMessageTime,
  formatShortTime,
  isCompact,
  GROUP_WINDOW_MS,
  type GroupableMessage,
} from "./messageGrouping"

const base = new Date(2026, 10, 10, 12, 0, 0).getTime()
let seq = 0
function msg(sender: string, offsetMs: number, reply: string | null = null): GroupableMessage {
  seq++
  return {
    id: String(seq),
    seq,
    sender_id: sender,
    created_at_ts: base + offsetMs,
    reply_to_id: reply,
  }
}

describe("isCompact", () => {
  it("groups the same author within 7 minutes", () => {
    expect(isCompact(msg("a", 0), msg("a", GROUP_WINDOW_MS - 1))).toBe(true)
  })
  it("starts a new group after 7 minutes", () => {
    expect(isCompact(msg("a", 0), msg("a", GROUP_WINDOW_MS))).toBe(false)
  })
  it("starts a new group for another author", () => {
    expect(isCompact(msg("a", 0), msg("b", 1000))).toBe(false)
  })
  it("never compacts replies", () => {
    expect(isCompact(msg("a", 0), msg("a", 1000, "1"))).toBe(false)
  })
  it("breaks at local midnight", () => {
    const lateEvening = new Date(2026, 10, 10, 23, 59, 0).getTime() - base
    const afterMidnight = new Date(2026, 10, 11, 0, 1, 0).getTime() - base
    expect(isCompact(msg("a", lateEvening), msg("a", afterMidnight))).toBe(false)
  })
  it("has no previous message to group with", () => {
    expect(isCompact(undefined, msg("a", 0))).toBe(false)
  })
})

describe("buildTimeline", () => {
  it("adds a day separator first and groups consecutive messages", () => {
    const items = buildTimeline([msg("a", 0), msg("a", 1000), msg("b", 2000)])
    expect(
      items.map((i) => (i.kind === "message" ? `${i.message.sender_id}:${i.compact}` : i.kind)),
    ).toEqual(["day", "a:false", "a:true", "b:false"])
  })

  it("places the new-messages divider and breaks the group there", () => {
    const first = msg("a", 0)
    const second = msg("a", 1000)
    const third = msg("a", 2000)
    const items = buildTimeline([first, second, third], second.seq)
    expect(
      items.map((i) => (i.kind === "message" ? `${i.message.id}:${i.compact}` : i.kind)),
    ).toEqual(["day", `${first.id}:false`, `${second.id}:true`, "new", `${third.id}:false`])
  })

  it("omits the divider when everything is read or nothing loaded above is read", () => {
    const a = msg("a", 0)
    const b = msg("b", 1000)
    expect(buildTimeline([a, b], b.seq).some((i) => i.kind === "new")).toBe(false)
    expect(buildTimeline([a, b], a.seq - 1).some((i) => i.kind === "new")).toBe(false)
  })

  it("places system lines by time and breaks the group", () => {
    const a = msg("a", 0)
    const b = msg("a", 2000)
    const items = buildTimeline([a, b], null, [
      { key: "old", ts: base - 1000 },
      { key: "mid", ts: base + 1000 },
      { key: "late", ts: base + 5000 },
    ])
    expect(
      items.map((i) =>
        i.kind === "message" ? `${i.message.id}:${i.compact}` : i.kind === "line" ? i.key : i.kind,
      ),
    ).toEqual(["day", `${a.id}:false`, "mid", `${b.id}:false`, "late"])
  })
})

describe("message times", () => {
  it("uses the 24-hour clock", () => {
    const afternoon = new Date(2026, 10, 10, 16, 33).getTime()
    expect(formatShortTime(afternoon)).toMatch(/^16:33$/)
    expect(formatMessageTime(afternoon, afternoon)).toBe("Today at 16:33")
    expect(formatShortTime(new Date(2026, 10, 10, 0, 5).getTime())).toBe("00:05")
  })
})
