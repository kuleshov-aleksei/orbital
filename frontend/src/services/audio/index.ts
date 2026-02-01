import type { AudioProcessor, AudioWorkletProcessor, NoiseSuppressionAlgorithm } from '@/types/audio'
import { BrowserNativeProcessor } from './browser'
import { createNoNoiseSuppressionProcessor } from './noNoiseSuppression'
import { createRNNoiseProcessor, createSpeexProcessor } from './noiseSuppressor'

/**
 * Audio Processor Registry
 * Factory for creating audio processors based on algorithm type
 */

const processorRegistry: Map<NoiseSuppressionAlgorithm, () => AudioProcessor> = new Map([
  ['browser-native', () => new BrowserNativeProcessor()],
  ['off', () => createNoNoiseSuppressionProcessor()],
  ['rnnoise', () => createRNNoiseProcessor()],
  ['speex', () => createSpeexProcessor()],
])

/**
 * Get an audio processor for the specified algorithm
 */
export function getAudioProcessor(algorithm: NoiseSuppressionAlgorithm): AudioProcessor | null {
  const factory = processorRegistry.get(algorithm)
  return factory ? factory() : null
}

/**
 * Get an AudioWorklet processor for the specified algorithm
 * Returns null if the algorithm doesn't require AudioWorklet processing
 */
export function getAudioWorkletProcessor(algorithm: NoiseSuppressionAlgorithm): AudioWorkletProcessor | null {
  const processor = getAudioProcessor(algorithm)
  if (processor && processor.requiresAudioWorklet()) {
    return processor as AudioWorkletProcessor
  }
  return null
}

/**
 * Check if an algorithm requires AudioWorklet processing
 */
export function requiresAudioWorklet(algorithm: NoiseSuppressionAlgorithm): boolean {
  const processor = getAudioProcessor(algorithm)
  return processor ? processor.requiresAudioWorklet() : false
}

/**
 * Register a new audio processor
 * Use this to add custom algorithms
 */
export function registerAudioProcessor(
  algorithm: NoiseSuppressionAlgorithm,
  factory: () => AudioProcessor
): void {
  processorRegistry.set(algorithm, factory)
}

/**
 * Check if an algorithm has a registered processor
 */
export function hasAudioProcessor(algorithm: NoiseSuppressionAlgorithm): boolean {
  return processorRegistry.has(algorithm)
}

/**
 * Get MediaTrackConstraints for the specified algorithm
 * Convenience function that handles the processor creation
 */
export function getConstraintsForAlgorithm(
  algorithm: NoiseSuppressionAlgorithm
): MediaTrackConstraints {
  const processor = getAudioProcessor(algorithm)
  if (processor && processor.isSupported()) {
    return processor.getConstraints()
  }

  // Fallback: return empty constraints
  return {}
}

/**
 * Check if a microphone supports the required sample rate for an algorithm
 */
export async function checkMicrophoneSampleRate(
  algorithm: NoiseSuppressionAlgorithm,
  requiredRate: number
): Promise<boolean> {
  if (algorithm !== 'rnnoise') return true

  try {
    // Try to get user media with the required sample rate
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { exact: requiredRate },
      },
    })

    // Check if we actually got the requested sample rate
    const track = stream.getAudioTracks()[0]
    const settings = track.getSettings()
    const actualRate = settings.sampleRate

    // Clean up
    stream.getTracks().forEach((t) => t.stop())

    return actualRate === requiredRate
  } catch {
    return false
  }
}

export { BrowserNativeProcessor }
export { createNoNoiseSuppressionProcessor } from './noNoiseSuppression'
export { createRNNoiseProcessor, createSpeexProcessor } from './noiseSuppressor'
