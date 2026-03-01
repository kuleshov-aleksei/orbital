const isElectron = typeof window !== "undefined" && typeof window.electronAPI !== "undefined"

type SndInstance = {
  load: (kit: string) => Promise<void>
  play: (sound: string) => void
}

let snd: SndInstance | null = null
let isLoading = false
let retryCount = 0
const MAX_RETRIES = 5

async function initSounds(): Promise<void> {
  if (isElectron) return
  if (snd) return
  if (isLoading) return

  isLoading = true

  try {
    const SndLib = await import("snd-lib")
    const SndClass = SndLib.default
    const instance = new SndClass()
    await instance.load(SndClass.KITS.SND01)
    snd = instance
    retryCount = 0
  } catch (error) {
    retryCount++
    console.warn(`Failed to load sound kit (attempt ${retryCount}/${MAX_RETRIES}):`, error)
  } finally {
    isLoading = false
  }
}

export async function toggleOn(): Promise<void> {
  await initSounds()
  snd?.play("TOGGLE_ON")
}

export async function toggleOff(): Promise<void> {
  await initSounds()
  snd?.play("TOGGLE_OFF")
}

export async function transitionOpen(): Promise<void> {
  await initSounds()
  snd?.play("TRANSITION_UP")
}

export async function transitionClose(): Promise<void> {
  await initSounds()
  snd?.play("TRANSITION_DOWN")
}

export async function tap(): Promise<void> {
  await initSounds()
  snd?.play("TAP")
}
