import { describe, expect, it } from "vitest"
import { applyGain, detectSilenceBounds, normalizationGain, sliceRange } from "./soundEdit"

const RATE = 48000

describe("detectSilenceBounds", () => {
  it("finds the audible part and pads it", () => {
    const pcm = new Float32Array(RATE * 2)
    pcm.fill(0.5, RATE * 0.5, RATE * 1.5) // audible from 0.5s to 1.5s
    const bounds = detectSilenceBounds(pcm, RATE, -50, 30)!
    expect(bounds.start).toBeCloseTo(0.47, 3)
    expect(bounds.end).toBeCloseTo(1.53, 3)
  })

  it("clamps padding to the clip and returns null for silence", () => {
    const pcm = new Float32Array(RATE).fill(0.5)
    expect(detectSilenceBounds(pcm, RATE)).toEqual({ start: 0, end: 1 })
    expect(detectSilenceBounds(new Float32Array(RATE), RATE)).toBeNull()
  })
})

describe("normalizationGain", () => {
  it("boosts a quiet clip to the target", () => {
    expect(normalizationGain(-30, -20)).toEqual({ gainDb: 7, limited: false })
  })

  it("attenuates a loud clip", () => {
    expect(normalizationGain(-12, -1)).toEqual({ gainDb: -11, limited: false })
  })

  it("caps gain so the peak stays under the ceiling", () => {
    expect(normalizationGain(-35, -6)).toEqual({ gainDb: 5, limited: true })
  })

  it("returns null for silence", () => {
    expect(normalizationGain(-Infinity, -Infinity)).toBeNull()
  })
})

describe("sliceRange / applyGain", () => {
  it("slices by seconds and scales by dB", () => {
    const pcm = new Float32Array(RATE).fill(0.5)
    const slice = sliceRange(pcm, RATE, { start: 0.25, end: 0.75 })
    expect(slice.length).toBe(RATE / 2)
    expect(applyGain(slice, -6.0206)[0]).toBeCloseTo(0.25, 4)
  })
})
