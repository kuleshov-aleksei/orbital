/**
 * Noise Suppressor module
 * Re-exports all noise suppression processors
 */

export { WebNoiseSuppressorProcessor } from "./baseProcessor"
export { RNNoiseProcessor, createRNNoiseProcessor } from "./rnnoiseProcessor"
export { SpeexProcessor, createSpeexProcessor } from "./speexProcessor"
