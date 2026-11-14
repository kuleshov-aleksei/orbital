import { describe, expect, it } from "vitest"
import { PcmRing } from "./pcmRing"

/** Interleaved s16le stereo bytes from [left, right] sample pairs. */
function pcm(frames: Array<[number, number]>): Uint8Array {
  const bytes = new Uint8Array(frames.length * 4)
  const view = new DataView(bytes.buffer)
  frames.forEach(([l, r], i) => {
    view.setInt16(i * 4, l, true)
    view.setInt16(i * 4 + 2, r, true)
  })
  return bytes
}

function pull(ring: PcmRing, n: number) {
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const got = ring.pull(left, right)
  return { got, left: Array.from(left), right: Array.from(right) }
}

describe("PcmRing", () => {
  it("converts s16le stereo to float per channel", () => {
    const ring = new PcmRing(8)
    ring.push(
      pcm([
        [16384, -16384],
        [-32768, 32767],
      ]),
    )
    const { got, left, right } = pull(ring, 2)
    expect(got).toBe(2)
    expect(left).toEqual([0.5, -1])
    expect(right[0]).toBe(-0.5)
    expect(right[1]).toBeCloseTo(32767 / 32768)
  })

  it("pads an underrun with silence", () => {
    const ring = new PcmRing(8)
    ring.push(pcm([[3276, 3276]]))
    const { got, left } = pull(ring, 3)
    expect(got).toBe(1)
    expect(left[0]).toBeCloseTo(0.1, 3)
    expect(left.slice(1)).toEqual([0, 0])
    expect(ring.buffered).toBe(0)
  })

  it("drops the oldest frames on overflow", () => {
    const ring = new PcmRing(3)
    ring.push(
      pcm([
        [1, 1],
        [2, 2],
      ]),
    )
    ring.push(
      pcm([
        [3, 3],
        [4, 4],
      ]),
    )
    expect(ring.buffered).toBe(3)
    expect(ring.dropped).toBe(1)
    const { left } = pull(ring, 3)
    expect(left.map((v) => Math.round(v * 32768))).toEqual([2, 3, 4])
  })

  it("keeps only the newest frames when one chunk exceeds the capacity", () => {
    const ring = new PcmRing(2)
    ring.push(
      pcm([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    )
    expect(ring.dropped).toBe(1)
    const { left } = pull(ring, 2)
    expect(left.map((v) => Math.round(v * 32768))).toEqual([2, 3])
  })

  it("wraps around the buffer end", () => {
    const ring = new PcmRing(3)
    ring.push(
      pcm([
        [1, 1],
        [2, 2],
      ]),
    )
    pull(ring, 2)
    ring.push(
      pcm([
        [3, 3],
        [4, 4],
        [5, 5],
      ]),
    )
    const { left } = pull(ring, 3)
    expect(left.map((v) => Math.round(v * 32768))).toEqual([3, 4, 5])
  })

  it("waits for the prebuffer before playing, and again after an underrun", () => {
    const ring = new PcmRing(16, 4)
    ring.push(
      pcm([
        [1, 1],
        [2, 2],
      ]),
    )
    expect(pull(ring, 2).got).toBe(0) // still priming
    ring.push(
      pcm([
        [3, 3],
        [4, 4],
      ]),
    )
    expect(pull(ring, 2).got).toBe(2)
    expect(pull(ring, 4).got).toBe(2) // underrun → re-prime
    ring.push(pcm([[5, 5]]))
    expect(pull(ring, 1).got).toBe(0)
  })

  it("ignores a trailing partial frame", () => {
    const ring = new PcmRing(4)
    const bytes = new Uint8Array(6) // one frame + 2 stray bytes
    ring.push(bytes)
    expect(ring.buffered).toBe(1)
  })
})
