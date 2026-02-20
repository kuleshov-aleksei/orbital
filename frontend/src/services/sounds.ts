import Snd from "snd-lib"

let snd: Snd | null = null
let isLoading = false
let retryCount = 0
const MAX_RETRIES = 5

/**
 * Initializes the sound system with the SND01 sound kit.
 * Retries up to MAX_RETRIES times on failure.
 * Can be called multiple times - subsequent calls while loading are coalesced.
 */
async function initSounds(): Promise<void> {
  if (snd) return
  if (isLoading) return

  isLoading = true
  const instance = new Snd()

  try {
    await instance.load(Snd.KITS.SND01)
    snd = instance
    retryCount = 0
  } catch (error) {
    retryCount++
    console.warn(`Failed to load sound kit (attempt ${retryCount}/${MAX_RETRIES}):`, error)
  } finally {
    isLoading = false
  }
}

/**
 * Plays the toggle on sound effect.
 * Used when user unmutes or undeafens.
 */
export async function toggleOn(): Promise<void> {
  await initSounds()
  snd?.play(Snd.SOUNDS.TOGGLE_ON)
}

/**
 * Plays the toggle off sound effect.
 * Used when user mutes or deafens.
 */
export async function toggleOff(): Promise<void> {
  await initSounds()
  snd?.play(Snd.SOUNDS.TOGGLE_OFF)
}

/**
 * Plays the transition up sound effect.
 * Used when user starts screen share, camera, or joins room.
 */
export async function transitionOpen(): Promise<void> {
  await initSounds()
  snd?.play(Snd.SOUNDS.TRANSITION_UP)
}

/**
 * Plays the transition down sound effect.
 * Used when user stops screen share, camera, or leaves room.
 */
export async function transitionClose(): Promise<void> {
  await initSounds()
  snd?.play(Snd.SOUNDS.TRANSITION_DOWN)
}

/**
 * Plays the tap sound effect.
 * Used for screen share and camera toggle actions.
 */
export async function tap(): Promise<void> {
  await initSounds()
  snd?.play(Snd.SOUNDS.TAP)
}
