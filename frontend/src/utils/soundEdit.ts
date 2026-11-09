/** Helpers for the soundboard upload editor: trim and loudness normalization. */

/** Recommended integrated loudness for soundboard clips (EBU R128). */
export const TARGET_LUFS = -23
/** Normalization never pushes the sample peak above this, to avoid clipping. */
export const PEAK_CEILING_DB = -1

export interface TimeRange {
  start: number
  end: number
}

/**
 * Find the audible part of a clip: from the first to the last sample whose
 * level exceeds `thresholdDb`, widened by `padMs` on each side. Returns null
 * when the whole clip is below the threshold.
 */
export function detectSilenceBounds(
  pcm: Float32Array,
  sampleRate: number,
  thresholdDb = -50,
  padMs = 30,
): TimeRange | null {
  const threshold = Math.pow(10, thresholdDb / 20)
  let first = -1
  let last = -1
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) > threshold) {
      first = i
      break
    }
  }
  if (first < 0) return null
  for (let i = pcm.length - 1; i >= first; i--) {
    if (Math.abs(pcm[i]) > threshold) {
      last = i
      break
    }
  }
  const pad = (padMs / 1000) * sampleRate
  const duration = pcm.length / sampleRate
  return {
    start: Math.max(0, (first - pad) / sampleRate),
    end: Math.min(duration, (last + 1 + pad) / sampleRate),
  }
}

/** Copy the samples between `start` and `end` seconds. */
export function sliceRange(pcm: Float32Array, sampleRate: number, range: TimeRange): Float32Array {
  const from = Math.max(0, Math.floor(range.start * sampleRate))
  const to = Math.min(pcm.length, Math.ceil(range.end * sampleRate))
  return pcm.slice(from, Math.max(from, to))
}

export interface NormalizationGain {
  gainDb: number
  /** True when the peak ceiling, not the loudness target, set the gain. */
  limited: boolean
}

/**
 * Gain that brings `measuredLufs` to `targetLufs`, capped so the peak stays
 * at or below `ceilingDb`. Returns null for silent audio (nothing to measure).
 */
export function normalizationGain(
  measuredLufs: number,
  peakDb: number,
  targetLufs = TARGET_LUFS,
  ceilingDb = PEAK_CEILING_DB,
): NormalizationGain | null {
  if (!Number.isFinite(measuredLufs)) return null
  const wanted = targetLufs - measuredLufs
  const headroom = Number.isFinite(peakDb) ? ceilingDb - peakDb : Infinity
  if (wanted > headroom) return { gainDb: headroom, limited: true }
  return { gainDb: wanted, limited: false }
}

/** Return a copy of `pcm` scaled by `gainDb`. */
export function applyGain(pcm: Float32Array, gainDb: number): Float32Array {
  const factor = Math.pow(10, gainDb / 20)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * factor
  return out
}
