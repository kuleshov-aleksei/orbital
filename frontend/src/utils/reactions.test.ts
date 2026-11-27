import { describe, expect, it } from "vitest"
import { orderReactors } from "./reactions"

const ME = "qkUrdzLDoqslx8EEy2cM7Q=="
const ALICE = "Zx9-_aB3cD4eF5gH6iJ7kA=="
const BOB = "mN8oP9qR0sT1uV2wX3yZ4w=="

describe("orderReactors", () => {
  it("moves the current user to the front", () => {
    expect(orderReactors([ALICE, BOB, ME], ME)).toEqual([ME, ALICE, BOB])
  })

  it("keeps reaction order when the current user hasn't reacted", () => {
    expect(orderReactors([BOB, ALICE], ME)).toEqual([BOB, ALICE])
  })

  it("handles an empty list and a missing user id", () => {
    expect(orderReactors([], ME)).toEqual([])
    expect(orderReactors([ALICE], "")).toEqual([ALICE])
  })

  it("does not mutate its input", () => {
    const ids = [ALICE, ME]
    orderReactors(ids, ME)
    expect(ids).toEqual([ALICE, ME])
  })
})
