/**
 * EBU R128 loudness measurement (ITU-R BS.1770).
 *
 * Ported from orbital-audiospriter (src/utils/loudness.ts); keep the two in
 * sync if the filter or gating changes.
 *
 * The K-weighting filters replicate ffmpeg's ebur128 implementation
 * (libavfilter/ebur128.c, ebur128_init_filter) exactly: a 2nd-order
 * high-shelf (f0 = 1681.974450955533, G = 3.999843853973347,
 * Q = 0.7071752369554196) cascaded with a 2nd-order high-pass
 * (f0 = 38.13547087602444, Q = 0.5003270373238773), designed with a
 * prewarped bilinear transform at the sample rate.
 */

export interface LoudnessMeasurement {
  /** Integrated loudness of the gated (K-weighted) blocks, LUFS. */
  integratedLufs: number
  /** Sample peak in dBFS (not oversampled true peak). */
  peakDb: number
}

export interface LoudnessFilter {
  /** 5 numerator taps (a0 = 1). */
  b: number[]
  /** 5 denominator taps. */
  a: number[]
}

export function designKWeighting(sampleRate: number): LoudnessFilter {
  const shelf = biquadShelf(sampleRate)
  const highpass = biquadHighpass(sampleRate)
  return {
    b: convolve(shelf.b, highpass.b),
    a: convolve(shelf.a, highpass.a),
  }
}

function convolve(x: number[], y: number[]): number[] {
  const out = new Array<number>(x.length + y.length - 1).fill(0)
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < y.length; j++) {
      out[i + j] += x[i] * y[j]
    }
  }
  return out
}

function biquadShelf(sampleRate: number): { b: number[]; a: number[] } {
  const f0 = 1681.974450955533
  const gain = 3.999843853973347
  const q = 0.7071752369554196
  const k = Math.tan((Math.PI * f0) / sampleRate)
  const vh = Math.pow(10, gain / 20)
  const vb = Math.pow(vh, 0.4996667741545416)
  const a0 = 1 + k / q + k * k
  return {
    b: [
      (vh + (vb * k) / q + k * k) / a0,
      (2 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
    ],
    a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  }
}

function biquadHighpass(sampleRate: number): { b: number[]; a: number[] } {
  const f0 = 38.13547087602444
  const q = 0.5003270373238773
  const k = Math.tan((Math.PI * f0) / sampleRate)
  const a0 = 1 + k / q + k * k
  return {
    b: [1, -2, 1],
    a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  }
}

/** Transposed direct form II (matches ebur128's v[] state machine). */
function filterSignal(samples: Float32Array, filter: LoudnessFilter): Float64Array {
  const out = new Float64Array(samples.length)
  const [b0, b1, b2, b3, b4] = filter.b
  const [a0, a1, a2, a3, a4] = filter.a
  let v1 = 0
  let v2 = 0
  let v3 = 0
  let v4 = 0
  for (let i = 0; i < samples.length; i++) {
    const v0 = samples[i] / a0 - a1 * v1 - a2 * v2 - a3 * v3 - a4 * v4
    out[i] = b0 * v0 + b1 * v1 + b2 * v2 + b3 * v3 + b4 * v4
    v4 = v3
    v3 = v2
    v2 = v1
    v1 = v0
  }
  return out
}

const ABSOLUTE_GATE_LUFS = -70
const RELATIVE_GATE_DB = -10
/** 0.691 dB calibration constant from the EBU R128 recommendation. */
const CALIBRATION_DB = 0.691

/**
 * Measure integrated loudness (LUFS) of mono PCM, including gating:
 * 400 ms blocks with 75% overlap, -70 LUFS absolute gate and
 * -10 LU relative gate. Returns -Infinity when no block passes the gate.
 */
export function measureLoudness(pcm: Float32Array, sampleRate: number): LoudnessMeasurement {
  const peak = maxAbs(pcm)
  let peakDb = -Infinity
  if (peak > 0) {
    peakDb = 20 * Math.log10(peak)
  }

  const samplesIn100ms = Math.round(sampleRate / 10)
  const blockFrames = samplesIn100ms * 4
  if (pcm.length === 0) {
    return { integratedLufs: -Infinity, peakDb }
  }

  const filtered = filterSignal(pcm, designKWeighting(sampleRate))
  const absoluteGateEnergy = Math.pow(10, (ABSOLUTE_GATE_LUFS + CALIBRATION_DB) / 10)

  // Shorter than one 400 ms gating block (e.g. after trimming a sample to a
  // short piece): there are no overlapping blocks, so treat the whole signal
  // as a single block. Non-silent short audio still gets a usable LUFS value.
  if (pcm.length < blockFrames) {
    let energy = 0
    for (let i = 0; i < filtered.length; i++) energy += filtered[i] * filtered[i]
    energy = energy / filtered.length
    if (energy < absoluteGateEnergy) {
      return { integratedLufs: -Infinity, peakDb }
    }
    return { integratedLufs: 10 * Math.log10(energy) - CALIBRATION_DB, peakDb }
  }

  const gatedEnergies: number[] = []
  for (let start = 0; start + blockFrames <= filtered.length; start += samplesIn100ms) {
    let sum = 0
    for (let i = start; i < start + blockFrames; i++) {
      const s = filtered[i]
      sum += s * s
    }
    const energy = sum / blockFrames
    if (energy >= absoluteGateEnergy) {
      gatedEnergies.push(energy)
    }
  }

  if (gatedEnergies.length === 0) {
    return { integratedLufs: -Infinity, peakDb }
  }

  const absoluteMean = mean(gatedEnergies)
  const relativeGate = absoluteMean * Math.pow(10, RELATIVE_GATE_DB / 10)
  const kept = gatedEnergies.filter((e) => e >= relativeGate)
  if (kept.length === 0) {
    return { integratedLufs: -Infinity, peakDb }
  }

  return {
    integratedLufs: 10 * Math.log10(mean(kept)) - CALIBRATION_DB,
    peakDb,
  }
}

function maxAbs(samples: Float32Array): number {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i])
    if (v > max) max = v
  }
  return max
}

function mean(values: number[]): number {
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}
