import { describe, expect, it } from "vitest"
import { measureLoudness } from "./loudness"

const RATE = 48000

function sine(seconds: number, freq: number, amplitude: number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < pcm.length; i++)
    pcm[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE)
  return pcm
}

// Reference values from ffmpeg `-af ebur128`, as in orbital-audiospriter's tests.
describe("measureLoudness (EBU R128)", () => {
  it.each([
    [1000, 0.25, -15.0],
    [440, 0.5, -9.7],
  ])("%d Hz sine at %f matches ffmpeg within 0.5 LU", (freq, amp, expected) => {
    const measured = measureLoudness(sine(3, freq, amp), RATE).integratedLufs
    expect(Math.abs(measured - expected)).toBeLessThan(0.5)
  })

  it("reports silence as -Infinity", () => {
    const measured = measureLoudness(new Float32Array(RATE), RATE)
    expect(measured.integratedLufs).toBe(-Infinity)
    expect(measured.peakDb).toBe(-Infinity)
  })

  it("measures sub-400 ms clips as a single block", () => {
    const measured = measureLoudness(sine(0.2, 1000, 0.25), RATE).integratedLufs
    expect(Math.abs(measured - -15.0)).toBeLessThan(0.7)
  })

  it("reports sample peak in dBFS", () => {
    expect(measureLoudness(sine(1, 1000, 0.5), RATE).peakDb).toBeCloseTo(-6.02, 1)
  })
})
