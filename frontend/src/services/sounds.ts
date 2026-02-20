import Snd from "snd-lib"

let snd: Snd | null = null
let isInitialized = false
let initFailed = false

/**
 * Initializes the sound system with the SND01 sound kit.
 * Can be called multiple times - subsequent calls are no-ops.
 * If initialization previously failed, this will retry.
 */
export async function initSounds(): Promise<void> {
  if (isInitialized || initFailed) return

  const instance = new Snd()
  try {
    await instance.load(Snd.KITS.SND01)
    snd = instance
    isInitialized = true
  } catch (error) {
    console.warn("Failed to load sound kit:", error)
    snd = null
  }
}

/**
 * Ensures sounds are initialized, attempting init if not already done.
 * Returns true if sounds are ready to play.
 */
async function ensureSounds(): Promise<boolean> {
  if (isInitialized) return true
  if (initFailed) return false

  try {
    await initSounds()
    return isInitialized
  } catch {
    initFailed = true
    return false
  }
}

/**
 * Plays the toggle on sound effect.
 * Used when user unmutes or undeafens.
 */
export async function toggleOn(): Promise<void> {
  if (!await ensureSounds()) return
  snd?.play(Snd.SOUNDS.TOGGLE_ON)
}

/**
 * Plays the toggle off sound effect.
 * Used when user mutes or deafens.
 */
export async function toggleOff(): Promise<void> {
  if (!await ensureSounds()) return
  snd?.play(Snd.SOUNDS.TOGGLE_OFF)
}

/**
 * Plays the transition up sound effect.
 * Used when user starts screen share, camera, or joins room.
 */
export async function transitionOpen(): Promise<void> {
  if (!await ensureSounds()) return
  snd?.play(Snd.SOUNDS.TRANSITION_UP)
}

/**
 * Plays the transition down sound effect.
 * Used when user stops screen share, camera, or leaves room.
 */
export async function transitionClose(): Promise<void> {
  if (!await ensureSounds()) return
  snd?.play(Snd.SOUNDS.TRANSITION_DOWN)
}

/**
 * Plays the tap sound effect.
 * Used for screen share and camera toggle actions.
 */
export async function tap(): Promise<void> {
  if (!await ensureSounds()) return
  snd?.play(Snd.SOUNDS.TAP)
}
