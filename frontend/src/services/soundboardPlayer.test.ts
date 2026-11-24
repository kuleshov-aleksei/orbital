import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SoundboardSound } from "@/types"

const howler = vi.hoisted(() => {
  const created: Array<{
    src: string[]
    unload: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    state: ReturnType<typeof vi.fn>
    duration: ReturnType<typeof vi.fn>
  }> = []
  class Howl {
    src: string[]
    unload = vi.fn()
    volume = vi.fn()
    play = vi.fn()
    once = vi.fn()
    state = vi.fn((): string => "unloaded")
    duration = vi.fn(() => 0)
    constructor(options: { src: string[] }) {
      this.src = options.src
      created.push(this)
    }
  }
  return { Howl, created }
})

vi.mock("howler", () => ({ Howl: howler.Howl }))
vi.mock("@/stores/call", () => ({ useCallStore: () => ({ isDeafened: false }) }))
vi.mock("@/services/api", () => ({
  apiService: { getSoundboardAudioUrl: (s: SoundboardSound) => s.audio_url },
}))

import {
  getSoundboardDurationMs,
  onSoundboardDuration,
  syncSoundboardLibrary,
} from "./soundboardPlayer"

const sound = (id: string, version: string): SoundboardSound => ({
  id,
  name: id,
  emoji: "",
  aliases: [],
  format: "ogg",
  file_size: 1,
  created_at: "",
  audio_url: `/api/soundboard/${id}/audio?v=${version}`,
})

describe("syncSoundboardLibrary", () => {
  beforeEach(() => {
    syncSoundboardLibrary([])
    howler.created.length = 0
  })

  it("keeps unchanged clips and reloads ones whose audio was replaced", () => {
    syncSoundboardLibrary([sound("a", "1"), sound("b", "1")])
    expect(howler.created).toHaveLength(2)
    const [a, b] = howler.created

    syncSoundboardLibrary([sound("a", "1"), sound("b", "2")])
    expect(a.unload).not.toHaveBeenCalled()
    expect(b.unload).toHaveBeenCalledTimes(1)
    expect(howler.created).toHaveLength(3)
    expect(howler.created[2].src).toEqual(["/api/soundboard/b/audio?v=2"])
  })

  it("unloads deleted clips", () => {
    syncSoundboardLibrary([sound("a", "1")])
    const [a] = howler.created
    syncSoundboardLibrary([])
    expect(a.unload).toHaveBeenCalledTimes(1)
  })

  it("reports a clip length only once it is loaded", () => {
    syncSoundboardLibrary([sound("a", "1")])
    const [a] = howler.created
    expect(getSoundboardDurationMs("a")).toBe(0)

    a.state.mockReturnValue("loaded")
    a.duration.mockReturnValue(2.5)
    expect(getSoundboardDurationMs("a")).toBe(2500)
    expect(getSoundboardDurationMs("missing")).toBe(0)
  })

  it("reports the clip length through the load callback", () => {
    syncSoundboardLibrary([sound("a", "1")])
    const [a] = howler.created
    const cb = vi.fn()

    onSoundboardDuration("a", cb)
    expect(cb).not.toHaveBeenCalled()
    expect(a.once).toHaveBeenCalledWith("load", expect.any(Function))

    a.state.mockReturnValue("loaded")
    a.duration.mockReturnValue(1)
    a.once.mock.calls[0][1]()
    expect(cb).toHaveBeenCalledWith(1000)

    // Already loaded: answered immediately, without waiting for an event.
    const immediate = vi.fn()
    onSoundboardDuration("a", immediate)
    expect(immediate).toHaveBeenCalledWith(1000)
  })
})
