// Ring buffer for interleaved stereo s16le PCM coming from the Windows audio
// helper. Shared by the AudioWorklet (pcmPlayer.worklet.ts) and unit tests.
//
// Policy (spec docs/specs/WINDOWS_APP_AUDIO.md §6):
// - underrun → silence (the helper sends nothing while the app is silent);
// - overflow → drop the oldest frames, so latency stays bounded and clock
//   drift between WASAPI and the AudioContext can never accumulate.

export const CHANNELS = 2

export class PcmRing {
  readonly capacity: number
  private readonly left: Float32Array
  private readonly right: Float32Array
  private readIdx = 0
  private size = 0
  private primed = false
  /** Frames dropped on overflow, for diagnostics. */
  dropped = 0

  /**
   * @param capacityFrames maximum buffered frames (latency ceiling)
   * @param prebufferFrames frames to collect before playback starts (and
   *   again after an underrun), so playback doesn't stutter on jitter
   */
  constructor(
    capacityFrames: number,
    private readonly prebufferFrames = 0,
  ) {
    this.capacity = capacityFrames
    this.left = new Float32Array(capacityFrames)
    this.right = new Float32Array(capacityFrames)
  }

  get buffered(): number {
    return this.size
  }

  /** Appends interleaved s16le stereo bytes. Partial trailing frames are ignored. */
  push(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let frames = Math.floor(bytes.byteLength / (2 * CHANNELS))
    let offset = 0

    // More than fits at all: keep only the newest `capacity` frames.
    if (frames > this.capacity) {
      const skip = frames - this.capacity
      offset = skip * 2 * CHANNELS
      this.dropped += skip
      frames = this.capacity
    }

    const overflow = this.size + frames - this.capacity
    if (overflow > 0) {
      this.readIdx = (this.readIdx + overflow) % this.capacity
      this.size -= overflow
      this.dropped += overflow
    }

    let writeIdx = (this.readIdx + this.size) % this.capacity
    for (let i = 0; i < frames; i++) {
      this.left[writeIdx] = view.getInt16(offset, true) / 32768
      this.right[writeIdx] = view.getInt16(offset + 2, true) / 32768
      offset += 4
      writeIdx = writeIdx + 1 === this.capacity ? 0 : writeIdx + 1
    }
    this.size += frames
  }

  /** Fills both channel arrays; returns the number of real (non-silent) frames written. */
  pull(outLeft: Float32Array, outRight: Float32Array): number {
    const want = outLeft.length
    if (!this.primed) {
      if (this.size < this.prebufferFrames || this.size === 0) {
        outLeft.fill(0)
        outRight.fill(0)
        return 0
      }
      this.primed = true
    }

    const n = Math.min(want, this.size)
    for (let i = 0; i < n; i++) {
      outLeft[i] = this.left[this.readIdx]
      outRight[i] = this.right[this.readIdx]
      this.readIdx = this.readIdx + 1 === this.capacity ? 0 : this.readIdx + 1
    }
    this.size -= n
    if (n < want) {
      outLeft.fill(0, n)
      outRight.fill(0, n)
      this.primed = false // underrun: collect a prebuffer again
    }
    return n
  }
}
