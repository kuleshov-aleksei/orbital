import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { SoundboardSound } from "@/types"

const ws = vi.hoisted(() => ({ sendMessage: vi.fn() }))
const player = vi.hoisted(() => ({
  playSoundboardSound: vi.fn(),
  setSoundboardEnabled: vi.fn(),
  setSoundboardVolume: vi.fn(),
  syncSoundboardLibrary: vi.fn(),
  getSoundboardDurationMs: vi.fn(),
  onSoundboardDuration: vi.fn(),
}))
const api = vi.hoisted(() => ({ getSoundboardSounds: vi.fn() }))

vi.mock("@/services/websocket", () => ({ wsService: ws }))
vi.mock("@/services/soundboardPlayer", () => player)
vi.mock("@/services/api", () => ({ apiService: api }))

import {
  matchesSoundQuery,
  useSoundboardStore,
  SOUNDBOARD_COOLDOWN_MS,
  SOUNDBOARD_HIGHLIGHT_FALLBACK_MS,
} from "./soundboard"

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
    player.getSoundboardDurationMs.mockReturnValue(0)
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
    await store.onSoundPlayed({ room_id: "r1", sound_id: "1", user_id: "u1" })
    expect(api.getSoundboardSounds).toHaveBeenCalledTimes(1)
    expect(player.playSoundboardSound).toHaveBeenCalledWith("1", expect.any(Number))
    await store.onSoundPlayed({ room_id: "r1", sound_id: "1", user_id: "u1" })
    expect(api.getSoundboardSounds).toHaveBeenCalledTimes(1)
  })

  it("highlights the player's card for the length of the clip", async () => {
    vi.useFakeTimers()
    player.getSoundboardDurationMs.mockReturnValue(1500)
    const store = useSoundboardStore()
    await store.onSoundPlayed({ room_id: "r1", sound_id: "1", user_id: "u1" })
    expect(store.isUserPlayingSound("u1")).toBe(true)
    expect(store.isUserPlayingSound("u2")).toBe(false)
    vi.advanceTimersByTime(1499)
    expect(store.isUserPlayingSound("u1")).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.isUserPlayingSound("u1")).toBe(false)
    vi.useRealTimers()
  })

  it("uses a fallback highlight when the clip length is not known yet", async () => {
    vi.useFakeTimers()
    const store = useSoundboardStore()
    await store.onSoundPlayed({ room_id: "r1", sound_id: "2", user_id: "u1" })
    expect(store.isUserPlayingSound("u1")).toBe(true)
    vi.advanceTimersByTime(SOUNDBOARD_HIGHLIGHT_FALLBACK_MS - 1)
    expect(store.isUserPlayingSound("u1")).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.isUserPlayingSound("u1")).toBe(false)
    vi.useRealTimers()
  })

  it("extends the highlight to the real clip length once it is known", async () => {
    vi.useFakeTimers()
    const store = useSoundboardStore()
    await store.onSoundPlayed({ room_id: "r1", sound_id: "1", user_id: "u1" })
    vi.advanceTimersByTime(500)

    // The clip finished loading and turned out to be 4s long: the highlight is
    // extended from the moment the play arrived, not from the moment it loaded.
    player.getSoundboardDurationMs.mockReturnValue(4000)
    const onLoaded = player.onSoundboardDuration.mock.calls[0][1] as () => void
    onLoaded()
    vi.advanceTimersByTime(3400)
    expect(store.isUserPlayingSound("u1")).toBe(true)
    vi.advanceTimersByTime(100)
    expect(store.isUserPlayingSound("u1")).toBe(false)
    vi.useRealTimers()
  })

  it("keeps the highlight running while the same user plays another clip", async () => {
    vi.useFakeTimers()
    player.getSoundboardDurationMs.mockReturnValue(1000)
    const store = useSoundboardStore()
    await store.onSoundPlayed({ room_id: "r1", sound_id: "1", user_id: "u1" })
    vi.advanceTimersByTime(900)
    await store.onSoundPlayed({ room_id: "r1", sound_id: "2", user_id: "u1" })
    // The first clip's timer must not end the newer highlight.
    vi.advanceTimersByTime(200)
    expect(store.isUserPlayingSound("u1")).toBe(true)
    vi.advanceTimersByTime(800)
    expect(store.isUserPlayingSound("u1")).toBe(false)
    vi.useRealTimers()
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
