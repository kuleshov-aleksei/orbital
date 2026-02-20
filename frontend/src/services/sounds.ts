import Snd from "snd-lib"

let snd: Snd | null = null
let isInitialized = false

/**
 * Initializes the sound system with the SND01 sound kit.
 *
 * This must be called before any sound functions can be used.
 * If initialization fails, sound functions will log warnings instead of playing sounds.
 */
export async function initSounds(): Promise<void> {
  if (isInitialized) return

  const instance = new Snd()
  try {
    await instance.load(Snd.KITS.SND01)
    snd = instance
    isInitialized = true
  } catch (error) {
    console.warn("Failed to load sound kit:", error)
    snd = null
    throw error
  }
}

/**
 * Plays the toggle on sound effect.
 * Used when user unmutes or undeafens.
 */
export function toggleOn(): void {
  if (!snd) {
    console.warn("Sound not initialized, cannot play toggleOn")
    return
  }
  snd.play(Snd.SOUNDS.TOGGLE_ON)
}

/**
 * Plays the toggle off sound effect.
 * Used when user mutes or deafens.
 */
export function toggleOff(): void {
  if (!snd) {
    console.warn("Sound not initialized, cannot play toggleOff")
    return
  }
  snd.play(Snd.SOUNDS.TOGGLE_OFF)
}

/**
 * Plays the transition up sound effect.
 * Used when user starts screen share, camera, or joins room.
 */
export function transitionOpen(): void {
  if (!snd) {
    console.warn("Sound not initialized, cannot play transitionOpen")
    return
  }
  snd.play(Snd.SOUNDS.TRANSITION_UP)
}

/**
 * Plays the transition down sound effect.
 * Used when user stops screen share, camera, or leaves room.
 */
export function transitionClose(): void {
  if (!snd) {
    console.warn("Sound not initialized, cannot play transitionClose")
    return
  }
  snd.play(Snd.SOUNDS.TRANSITION_DOWN)
}

/**
 * Plays the tap sound effect.
 * Used for screen share and camera toggle actions.
 */
export function tap(): void {
  if (!snd) {
    console.warn("Sound not initialized, cannot play tap")
    return
  }
  snd.play(Snd.SOUNDS.TAP)
}
