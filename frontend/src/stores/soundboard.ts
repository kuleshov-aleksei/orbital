import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { SoundboardSound } from "@/types"
import { apiService } from "@/services/api"
import { wsService } from "@/services/websocket"
import {
  playSoundboardSound,
  setSoundboardEnabled,
  setSoundboardVolume,
  syncSoundboardLibrary,
} from "@/services/soundboardPlayer"

const VOLUME_KEY = "orbital:soundboard_volume"
const ENABLED_KEY = "orbital:soundboard_enabled"

// Mirrors the backend per-user cooldown (SoundPlayCooldown).
export const SOUNDBOARD_COOLDOWN_MS = 2000

function readStoredVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "")
    return !isNaN(v) && v >= 0 && v <= 1 ? v : 0.5
  } catch {
    return 0.5
  }
}

function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false"
  } catch {
    return true
  }
}

/** Case-insensitive match on name and aliases. */
export function matchesSoundQuery(sound: SoundboardSound, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return sound.name.toLowerCase().includes(q) || sound.aliases.some((a) => a.includes(q))
}

export const useSoundboardStore = defineStore("soundboard", () => {
  const sounds = ref<SoundboardSound[]>([])
  const isLoaded = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const volume = ref(readStoredVolume())
  const enabled = ref(readStoredEnabled())
  const cooldownUntil = ref(0)

  setSoundboardVolume(volume.value)
  setSoundboardEnabled(enabled.value)

  const soundsById = computed(() => new Map(sounds.value.map((s) => [s.id, s])))

  function search(query: string): SoundboardSound[] {
    const q = query.trim().toLowerCase()
    if (!q) return sounds.value
    const matches = sounds.value.filter((s) => matchesSoundQuery(s, q))
    // Exact name/alias matches first, then prefix matches, then the rest.
    const rank = (s: SoundboardSound) => {
      const names = [s.name.toLowerCase(), ...s.aliases]
      if (names.includes(q)) return 0
      if (names.some((n) => n.startsWith(q))) return 1
      return 2
    }
    return matches.sort((a, b) => rank(a) - rank(b))
  }

  let inflight: Promise<void> | null = null
  function fetchSounds(): Promise<void> {
    if (inflight) return inflight
    isLoading.value = true
    inflight = apiService
      .getSoundboardSounds()
      .then((list) => {
        sounds.value = list
        isLoaded.value = true
        error.value = null
        syncSoundboardLibrary(list)
      })
      .catch((err) => {
        console.error("[Soundboard] Failed to load sounds:", err)
        error.value = "Failed to load sounds"
      })
      .finally(() => {
        isLoading.value = false
        inflight = null
      })
    return inflight
  }

  /** Loads and preloads the library once (called when entering a call). */
  async function ensureLoaded(): Promise<void> {
    if (!isLoaded.value) await fetchSounds()
  }

  /** soundboard_updated: refresh only if this client already uses the library. */
  function onLibraryChanged(): void {
    if (isLoaded.value) void fetchSounds()
  }

  /** Asks the server to play a clip for the whole room. */
  function play(soundId: string): boolean {
    const now = Date.now()
    if (now < cooldownUntil.value) return false
    cooldownUntil.value = now + SOUNDBOARD_COOLDOWN_MS
    wsService.sendMessage("play_sound", { sound_id: soundId })
    return true
  }

  /** sound_played from the server (including our own plays). */
  async function onSoundPlayed(soundId: string): Promise<void> {
    const receivedAt = Date.now()
    if (!soundsById.value.has(soundId)) {
      // A clip we have not seen yet (library not loaded or just uploaded).
      await fetchSounds()
    }
    playSoundboardSound(soundId, receivedAt)
  }

  function setVolume(next: number): void {
    volume.value = next
    setSoundboardVolume(next)
    try {
      localStorage.setItem(VOLUME_KEY, String(next))
    } catch {
      // storage unavailable; keep the in-memory value
    }
  }

  function setEnabled(next: boolean): void {
    enabled.value = next
    setSoundboardEnabled(next)
    try {
      localStorage.setItem(ENABLED_KEY, String(next))
    } catch {
      // storage unavailable; keep the in-memory value
    }
  }

  async function upload(input: {
    file: File
    name: string
    emoji: string
    aliases: string[]
  }): Promise<SoundboardSound> {
    const sound = await apiService.uploadSoundboardSound(input)
    await fetchSounds()
    return sound
  }

  async function update(
    id: string,
    patch: { name?: string; emoji?: string; aliases?: string[] },
  ): Promise<void> {
    await apiService.updateSoundboardSound(id, patch)
    await fetchSounds()
  }

  async function remove(id: string): Promise<void> {
    await apiService.deleteSoundboardSound(id)
    await fetchSounds()
  }

  return {
    sounds,
    isLoaded,
    isLoading,
    error,
    volume,
    enabled,
    cooldownUntil,
    search,
    fetchSounds,
    ensureLoaded,
    onLibraryChanged,
    play,
    onSoundPlayed,
    setVolume,
    setEnabled,
    upload,
    update,
    remove,
  }
})
