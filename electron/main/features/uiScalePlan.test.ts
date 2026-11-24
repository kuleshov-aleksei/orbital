// Run with `make test-ota` (node --test; Node strips the types itself).
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  autoFactor,
  clampScale,
  detectHandheld,
  effectiveScale,
  normalizeSetting,
  type HandheldInputs,
} from "./uiScalePlan.ts"

function inputs(over: Partial<HandheldInputs> = {}): HandheldInputs {
  return { platform: "linux", dmi: null, env: {}, hasTouchscreen: false, ...over }
}

const dmi = (sysVendor: string, productName: string, productVersion = "") => ({
  sysVendor,
  productName,
  productVersion,
})

test("detects Steam Deck LCD and OLED from DMI", () => {
  assert.equal(detectHandheld(inputs({ dmi: dmi("Valve\n", "Jupiter\n", "1") })), "steam-deck")
  assert.equal(detectHandheld(inputs({ dmi: dmi("Valve", "Galileo") })), "steam-deck")
})

test("detects Legion Go and Go S from product_version", () => {
  assert.equal(detectHandheld(inputs({ dmi: dmi("LENOVO", "83E1", "Legion Go 8APU1") })), "legion-go")
  assert.equal(
    detectHandheld(inputs({ dmi: dmi("LENOVO", "83L3", "Legion Go S 8ARP1") })),
    "legion-go",
  )
})

test("ignores regular PCs and laptops", () => {
  assert.equal(detectHandheld(inputs({ dmi: dmi("LENOVO", "21CB", "ThinkPad X1 Carbon") })), null)
  assert.equal(detectHandheld(inputs({ dmi: dmi("ASUS", "System Product Name") })), null)
  assert.equal(detectHandheld(inputs({ dmi: dmi("Valve", "Index") })), null)
})

test("falls back to the SteamOS session env", () => {
  assert.equal(detectHandheld(inputs({ env: { SteamDeck: "1" } })), "steamos")
  assert.equal(detectHandheld(inputs({ env: { XDG_CURRENT_DESKTOP: "gamescope" } })), null)
  assert.equal(
    detectHandheld(inputs({ env: { XDG_CURRENT_DESKTOP: "gamescope" }, hasTouchscreen: true })),
    "gamescope-touch",
  )
})

test("never detects a handheld off Linux", () => {
  assert.equal(
    detectHandheld(inputs({ platform: "win32", dmi: dmi("LENOVO", "83E1", "Legion Go 8APU1") })),
    null,
  )
})

test("auto factor keeps at least 1024 CSS px", () => {
  assert.equal(autoFactor(true, 1280), 1.25) // Steam Deck
  assert.equal(autoFactor(true, 2560), 2) // Legion Go, unscaled
  assert.equal(autoFactor(true, 1920), 1.75) // Legion Go S
  assert.equal(autoFactor(true, 1706), 1.5) // Legion Go with KDE at 150%
  assert.equal(autoFactor(true, 800), 1) // portrait or tiny: never below 1
  for (const w of [1280, 1706, 1920, 2560]) assert.ok(w / autoFactor(true, w) >= 1024)
})

test("auto factor is 1 when not a handheld or width is bogus", () => {
  assert.equal(autoFactor(false, 2560), 1)
  assert.equal(autoFactor(true, 0), 1)
  assert.equal(autoFactor(true, Number.NaN), 1)
})

test("settings are normalized and clamped", () => {
  assert.equal(normalizeSetting("auto"), "auto")
  assert.equal(normalizeSetting(undefined), "auto")
  assert.equal(normalizeSetting("1.5"), "auto")
  assert.equal(normalizeSetting(5), 2)
  assert.equal(normalizeSetting(0.5), 1)
  assert.equal(clampScale(Number.POSITIVE_INFINITY), 1)
  assert.equal(effectiveScale("auto", 1.25), 1.25)
  assert.equal(effectiveScale(1.5, 1.25), 1.5)
})
