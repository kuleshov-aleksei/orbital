import { describe, expect, it } from "vitest"
import { pcmToWav16 } from "./wav"

describe("pcmToWav16", () => {
  it("writes a 16-bit mono PCM header the backend accepts", () => {
    const wav = pcmToWav16(new Float32Array([0, 1, -1, 2]), 48000)
    const view = new DataView(wav.buffer)
    const ascii = (o: number) => String.fromCharCode(...wav.slice(o, o + 4))
    expect(ascii(0)).toBe("RIFF")
    expect(ascii(8)).toBe("WAVE")
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(8)
    expect(wav.byteLength).toBe(44 + 8)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(-32767)
    expect(view.getInt16(50, true)).toBe(32767) // clamped
  })
})
