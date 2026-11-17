import { describe, expect, it } from "vitest"
import { activeCommandQuery, matchCommands } from "./chatCommands"

describe("activeCommandQuery", () => {
  it("matches a command name typed at the start", () => {
    expect(activeCommandQuery("/", 1)).toEqual({ query: "" })
    expect(activeCommandQuery("/ran", 4)).toEqual({ query: "ran" })
    expect(activeCommandQuery("/D2", 3)).toEqual({ query: "d2" })
  })

  it("ignores slashes elsewhere and finished commands", () => {
    expect(activeCommandQuery("see /random", 11)).toBeNull()
    expect(activeCommandQuery("/random 1 6", 11)).toBeNull()
    expect(activeCommandQuery("/usr/bin", 8)).toBeNull()
  })
})

describe("matchCommands", () => {
  it("filters by prefix", () => {
    expect(matchCommands("").map((c) => c.name)).toEqual(["random", "vrandom", "d20", "remindme"])
    expect(matchCommands("r").map((c) => c.name)).toEqual(["random", "remindme"])
    expect(matchCommands("x")).toEqual([])
  })
})
