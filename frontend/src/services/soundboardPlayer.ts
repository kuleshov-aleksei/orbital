import { Howl } from "howler"
import type { SoundboardSound } from "@/types"
import { apiService } from "@/services/api"
import { useCallStore } from "@/stores/call"

// Soundboard clips are played locally by every client when the server
// broadcasts "sound_played". Clips are preloaded so playback starts at the
// same moment for everyone; a clip that arrives later than this is skipped
// rather than played out of sync.
const MAX_LATE_START_MS = 1000

type HowlInstance = ReturnType<typeof Howl>

const howls = new Map<string, HowlInstance>()
let volume = 0.5
let enabled = true

function createHowl(sound: SoundboardSound): HowlInstance {
  return new Howl({
    src: [apiService.getSoundboardAudioUrl(sound)],
    // The URL has no extension, so tell Howler the codec explicitly.
    format: [sound.format],
    // Web Audio (not <audio>) for low-latency, sample-accurate playback.
    html5: false,
    preload: true,
    volume,
    onloaderror: (_id: number, error: unknown) => {
      console.error(`[Soundboard] Failed to load sound ${sound.id}:`, error)
    },
  })
}

/** Preloads new clips and unloads deleted ones. Edits never change audio. */
export function syncSoundboardLibrary(sounds: SoundboardSound[]): void {
  const ids = new Set(sounds.map((s) => s.id))
  howls.forEach((howl, id) => {
    if (!ids.has(id)) {
      howl.unload()
      howls.delete(id)
    }
  })
  for (const sound of sounds) {
    if (!howls.has(sound.id)) howls.set(sound.id, createHowl(sound))
  }
}

export function setSoundboardVolume(next: number): void {
  volume = next
  howls.forEach((howl) => howl.volume(next))
}

export function setSoundboardEnabled(next: boolean): void {
  enabled = next
  if (!next) howls.forEach((howl) => howl.stop())
}

/**
 * Plays a clip. `receivedAt` is when the play event arrived; if the clip is
 * still loading it only starts when it is ready within MAX_LATE_START_MS.
 */
export function playSoundboardSound(soundId: string, receivedAt = Date.now()): void {
  if (!enabled || volume <= 0 || useCallStore().isDeafened) return
  const howl = howls.get(soundId)
  if (!howl) return
  if (howl.state() === "loaded") {
    howl.play()
    return
  }
  howl.once("load", () => {
    if (enabled && Date.now() - receivedAt <= MAX_LATE_START_MS) howl.play()
  })
}

/** Plays a clip for the local user only (upload preview / admin preview). */
export function previewSoundboardSound(sound: SoundboardSound): void {
  const howl = howls.get(sound.id) ?? createHowl(sound)
  howls.set(sound.id, howl)
  howl.volume(volume > 0 ? volume : 0.5)
  howl.play()
}
