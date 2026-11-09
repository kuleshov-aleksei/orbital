// Ported from orbital-audiospriter (src/services/audioDecode.ts). The soundboard
// backend encodes Opus, whose native rate is 48 kHz, so we decode straight to it.
export const SOUNDBOARD_SAMPLE_RATE = 48000

export interface DecodedAudio {
  /** Mono PCM at SOUNDBOARD_SAMPLE_RATE. */
  pcm: Float32Array
  sampleRate: number
  duration: number
}

/** Average channel data into a single mono track (identity for mono sources). */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (const channel of channels) sum += channel[i]
    mono[i] = sum / channels.length
  }
  return mono
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
}

async function resampleTo(buffer: AudioBuffer, targetRate: number): Promise<Float32Array> {
  if (buffer.sampleRate === targetRate) return mixToMono(channelsOf(buffer))
  const length = Math.max(1, Math.ceil(buffer.duration * targetRate))
  const ctx = new OfflineAudioContext(1, length, targetRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0)
}

/**
 * Decode any format the browser understands (mp3/ogg/wav/flac/m4a/opus) to
 * mono 48 kHz PCM. OfflineAudioContext avoids autoplay-policy gestures.
 */
export async function decodeAudioFile(bytes: ArrayBuffer): Promise<DecodedAudio> {
  const ctx = new OfflineAudioContext(1, 1, SOUNDBOARD_SAMPLE_RATE)
  const buffer = await ctx.decodeAudioData(bytes)
  const pcm = await resampleTo(buffer, SOUNDBOARD_SAMPLE_RATE)
  return { pcm, sampleRate: SOUNDBOARD_SAMPLE_RATE, duration: pcm.length / SOUNDBOARD_SAMPLE_RATE }
}
