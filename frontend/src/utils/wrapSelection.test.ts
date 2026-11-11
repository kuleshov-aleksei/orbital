import { describe, expect, it } from "vitest"
import { wrapSelection } from "./wrapSelection"

describe("wrapSelection", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(wrapSelection("say hello now", 4, 9, "**")).toEqual({
      value: "say **hello** now",
      start: 6,
      end: 11,
    })
  })

  it("unwraps when the markers are just outside the selection", () => {
    expect(wrapSelection("say ||hello|| now", 6, 11, "||")).toEqual({
      value: "say hello now",
      start: 4,
      end: 9,
    })
  })

  it("unwraps when the selection includes the markers", () => {
    expect(wrapSelection("say ~~hello~~ now", 4, 13, "~~")).toEqual({
      value: "say hello now",
      start: 4,
      end: 9,
    })
  })

  it("inserts an empty pair at a collapsed caret", () => {
    expect(wrapSelection("ab", 1, 1, "*")).toEqual({ value: "a**b", start: 2, end: 2 })
  })
})
