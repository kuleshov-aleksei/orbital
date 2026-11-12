import { describe, expect, it } from "vitest"
import { PEAK_COUNT, quantizedPeaks } from "./audioPeaks"

describe("quantizedPeaks", () => {
  it("returns PEAK_COUNT values normalized to 0..255", () => {
    const pcm = new Float32Array(48000)
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 10) * (i / pcm.length) * 0.4
    const peaks = quantizedPeaks(pcm)
    expect(peaks).toHaveLength(PEAK_COUNT)
    expect(Math.max(...peaks)).toBe(255)
    expect(peaks.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)).toBe(true)
    // Rising amplitude: the end is louder than the start.
    expect(peaks[PEAK_COUNT - 1]).toBeGreaterThan(peaks[5])
  })

  it("handles silence and very short input", () => {
    expect(quantizedPeaks(new Float32Array(1000))).toEqual(new Array(PEAK_COUNT).fill(0))
    expect(quantizedPeaks(new Float32Array([0.5, -1]))).toEqual([128, 255])
    expect(quantizedPeaks(new Float32Array(0))).toEqual([])
  })
})
