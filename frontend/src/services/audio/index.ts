import type { AudioProcessor, NoiseSuppressionAlgorithm } from "@/types/audio"
import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client"
import { BrowserNativeProcessor } from "./browser"
import { createNoNoiseSuppressionProcessor } from "./noNoiseSuppression"
import { createLiveKitNativeProcessor } from "../livekit-audio-processors"
import { createRNNoiseProcessor } from "./RNNoiseProcessor"
import { createSpeexProcessor } from "./SpeexProcessor"

/**
 * Audio Processor Registry
 * Factory for creating audio processors based on algorithm type
 * Simplified: Only LiveKit native, browser native, and off options
 */

const processorRegistry: Map<NoiseSuppressionAlgorithm, () => AudioProcessor> = new Map([
  ["browser-native", () => new BrowserNativeProcessor()],
  ["off", () => createNoNoiseSuppressionProcessor()],
  ["livekit-native", () => createLiveKitNativeProcessor()],
  ["rnnoise", () => createRNNoiseProcessor()],
  ["speex", () => createSpeexProcessor()],
])

/**
 * Get an audio processor for the specified algorithm
 */
export function getAudioProcessor(algorithm: NoiseSuppressionAlgorithm): AudioProcessor | null {
  const factory = processorRegistry.get(algorithm)
  return factory ? factory() : null
}

/**
 * Register a new audio processor
 * Use this to add custom algorithms
 */
export function registerAudioProcessor(
  algorithm: NoiseSuppressionAlgorithm,
  factory: () => AudioProcessor,
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
  algorithm: NoiseSuppressionAlgorithm,
): MediaTrackConstraints {
  const processor = getAudioProcessor(algorithm)
  if (processor && processor.isSupported()) {
    return processor.getConstraints()
  }

  // Fallback: return empty constraints
  return {}
}

export { BrowserNativeProcessor }
export { createNoNoiseSuppressionProcessor } from "./noNoiseSuppression"
export {
  createLiveKitNativeProcessor,
  LiveKitNativeProcessor,
  getLiveKitAudioConstraints,
} from "../livekit-audio-processors"
export { createRNNoiseProcessor, RNNoiseProcessor } from "./RNNoiseProcessor"
export { createSpeexProcessor, SpeexProcessor } from "./SpeexProcessor"

/**
 * Get a LiveKit TrackProcessor for WASM-based noise suppression
 * Returns null for algorithms that don't use TrackProcessor (browser-native, livekit-native, off)
 */
export function getTrackProcessor(algorithm: NoiseSuppressionAlgorithm): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> | null {
  switch (algorithm) {
    case "rnnoise":
      return createRNNoiseProcessor()
    case "speex":
      return createSpeexProcessor()
    default:
      return null
  }
}

/**
 * Check if an algorithm uses WASM-based processing (requires TrackProcessor)
 */
export function isWasmAlgorithm(algorithm: NoiseSuppressionAlgorithm): boolean {
  return algorithm === "rnnoise" || algorithm === "speex"
}
