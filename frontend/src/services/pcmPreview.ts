/**
 * Local-only PCM preview for the soundboard editor (ported from
 * orbital-audiospriter's src/utils/playback.ts). Uses Web Audio so previews
 * can include normalization gain above unity.
 */

let audioContext: AudioContext | null = null
let activeSource: AudioBufferSourceNode | null = null

function ensureContext(): AudioContext {
  audioContext ??= new AudioContext()
  return audioContext
}

export function stopPcmPreview(): void {
  if (!activeSource) return
  const source = activeSource
  activeSource = null
  source.onended = null
  try {
    source.stop()
  } catch {
    // already stopped
  }
  source.disconnect()
}

/**
 * Play mono PCM once, stopping any previous preview. `onProgress` receives
 * elapsed seconds every animation frame; `onEnd` fires when playback stops
 * by itself.
 */
export function playPcmPreview(
  pcm: Float32Array,
  sampleRate: number,
  onProgress: (elapsed: number) => void,
  onEnd: () => void,
): void {
  stopPcmPreview()
  if (pcm.length === 0) {
    onEnd()
    return
  }
  const ctx = ensureContext()
  void ctx.resume()
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
  buffer.getChannelData(0).set(pcm)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  const startedAt = ctx.currentTime
  const tick = () => {
    if (activeSource !== source) return
    onProgress(ctx.currentTime - startedAt)
    requestAnimationFrame(tick)
  }
  source.onended = () => {
    if (activeSource === source) activeSource = null
    onEnd()
  }
  activeSource = source
  source.start()
  requestAnimationFrame(tick)
}

/** Stop playback and release the context (call on unmount). */
export function disposePcmPreview(): void {
  stopPcmPreview()
  if (audioContext) {
    void audioContext.close().catch(() => {})
    audioContext = null
  }
}
