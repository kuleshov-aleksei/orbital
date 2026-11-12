// Client-side waveform for audio attachments (docs/specs/CHAT_SYSTEM.md
// §7.12.2): the server never decodes audio, so the uploader computes 200
// peaks once and they are stored with the message.
import { mixToMono } from "@/services/audioDecode"

export const PEAK_COUNT = 200

/**
 * Max |sample| per bucket, normalized to the loudest bucket (so quiet
 * recordings still show a shape) and quantized to 0..255.
 */
export function quantizedPeaks(pcm: Float32Array, count = PEAK_COUNT): number[] {
  const buckets = Math.min(count, pcm.length)
  if (buckets === 0) return []
  const size = pcm.length / buckets
  const raw = new Float32Array(buckets)
  let loudest = 0
  for (let b = 0; b < buckets; b++) {
    let max = 0
    const end = Math.min(pcm.length, Math.floor((b + 1) * size))
    for (let i = Math.floor(b * size); i < end; i++) {
      const v = Math.abs(pcm[i])
      if (v > max) max = v
    }
    raw[b] = max
    if (max > loudest) loudest = max
  }
  return Array.from(raw, (v) => (loudest > 0 ? Math.round((v / loudest) * 255) : 0))
}

export interface AudioAnalysis {
  peaks: number[]
  durationMs: number
}

/** Decode a picked file locally; null when the browser cannot decode it. */
export async function analyzeAudioFile(file: Blob): Promise<AudioAnalysis | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 8000)
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    )
    return { peaks: quantizedPeaks(mixToMono(channels)), durationMs: buffer.duration * 1000 }
  } catch {
    return null
  }
}

/** Duration and size of a video, read from a local media element. */
export function analyzeVideoFile(
  file: Blob,
): Promise<{ durationMs: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    let settled = false
    const done = (value: { durationMs: number; width: number; height: number } | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      video.removeAttribute("src")
      resolve(value)
    }
    video.preload = "metadata"
    video.muted = true
    video.onloadedmetadata = () =>
      done({
        durationMs: Number.isFinite(video.duration) ? video.duration * 1000 : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      })
    video.onerror = () => done(null)
    setTimeout(() => done(null), 10000)
    video.src = url
  })
}
