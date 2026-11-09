import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SoundboardSound } from "@/types"

const howler = vi.hoisted(() => {
  const created: Array<{ src: string[]; unload: ReturnType<typeof vi.fn> }> = []
  class Howl {
    src: string[]
    unload = vi.fn()
    volume = vi.fn()
    play = vi.fn()
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

import { syncSoundboardLibrary } from "./soundboardPlayer"

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
})
