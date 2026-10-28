import { describe, expect, it } from "vitest"
import { abilityDamageMultiplierForRound } from "./balance"

describe("abilityDamageMultiplierForRound", () => {
  it("keeps round 1 at base damage", () => {
    expect(abilityDamageMultiplierForRound(1, { ability_damage_growth: 1.27 })).toBe(1)
  })

  it("compounds the configured growth per round", () => {
    expect(abilityDamageMultiplierForRound(4, { ability_damage_growth: 1.27 })).toBeCloseTo(
      1.27 ** 3,
    )
  })

  it("falls back to flat damage when growth is absent", () => {
    expect(abilityDamageMultiplierForRound(10)).toBe(1)
  })
})
