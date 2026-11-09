import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { SoundboardSound } from "@/types"

const ws = vi.hoisted(() => ({ sendMessage: vi.fn() }))
const player = vi.hoisted(() => ({
  playSoundboardSound: vi.fn(),
  setSoundboardEnabled: vi.fn(),
  setSoundboardVolume: vi.fn(),
  syncSoundboardLibrary: vi.fn(),
}))
const api = vi.hoisted(() => ({ getSoundboardSounds: vi.fn() }))

vi.mock("@/services/websocket", () => ({ wsService: ws }))
vi.mock("@/services/soundboardPlayer", () => player)
vi.mock("@/services/api", () => ({ apiService: api }))

import { matchesSoundQuery, useSoundboardStore, SOUNDBOARD_COOLDOWN_MS } from "./soundboard"

const sound = (id: string, name: string, aliases: string[] = []): SoundboardSound => ({
  id,
  name,
  emoji: "",
  aliases,
  format: "mp3",
  file_size: 1,
  created_at: "",
  audio_url: "",
})

const library = [
  sound("1", "Sad Trombone", ["fail", "womp"]),
  sound("2", "Airhorn", ["horn", "mlg"]),
  sound("3", "Horn Section"),
]

describe("soundboard store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.getSoundboardSounds.mockResolvedValue(library)
  })

  it("matches name and aliases case-insensitively", () => {
    expect(matchesSoundQuery(library[0], "TROMB")).toBe(true)
    expect(matchesSoundQuery(library[0], "womp")).toBe(true)
    expect(matchesSoundQuery(library[0], "horn")).toBe(false)
    expect(matchesSoundQuery(library[0], "  ")).toBe(true)
  })

  it("ranks exact alias matches before prefix matches", async () => {
    const store = useSoundboardStore()
    await store.fetchSounds()
    expect(player.syncSoundboardLibrary).toHaveBeenCalledWith(library)
    expect(store.search("horn").map((s) => s.id)).toEqual(["2", "3"])
    expect(store.search("").length).toBe(3)
  })

  it("throttles plays client-side", () => {
    vi.useFakeTimers()
    const store = useSoundboardStore()
    expect(store.play("2")).toBe(true)
    expect(store.play("2")).toBe(false)
    vi.advanceTimersByTime(SOUNDBOARD_COOLDOWN_MS)
    expect(store.play("2")).toBe(true)
    expect(ws.sendMessage).toHaveBeenCalledTimes(2)
    expect(ws.sendMessage).toHaveBeenCalledWith("play_sound", { sound_id: "2" })
    vi.useRealTimers()
  })

  it("fetches the library before playing an unknown clip", async () => {
    const store = useSoundboardStore()
    await store.onSoundPlayed("1")
    expect(api.getSoundboardSounds).toHaveBeenCalledTimes(1)
    expect(player.playSoundboardSound).toHaveBeenCalledWith("1", expect.any(Number))
    await store.onSoundPlayed("1")
    expect(api.getSoundboardSounds).toHaveBeenCalledTimes(1)
  })

  it("persists volume and enabled settings", () => {
    const store = useSoundboardStore()
    store.setVolume(0.3)
    store.setEnabled(false)
    expect(player.setSoundboardVolume).toHaveBeenLastCalledWith(0.3)
    expect(player.setSoundboardEnabled).toHaveBeenLastCalledWith(false)
    setActivePinia(createPinia())
    const fresh = useSoundboardStore()
    expect(fresh.volume).toBe(0.3)
    expect(fresh.enabled).toBe(false)
  })
})
