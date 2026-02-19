import type { NoiseSuppressionAlgorithm } from "@/types/audio"
import { LocalAudioTrack } from "livekit-client"

// Global audio context for gain processing
let audioContext: AudioContext | null = null
let currentGainNode: GainNode | null = null

/**
 * Get or create the shared AudioContext
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/**
 * Create a LocalAudioTrack with gain control using Web Audio API
 *
 * @param constraints - MediaTrackConstraints for the microphone
 * @param gain - Gain value (0.0 to 1.2, where 1.0 is 100%)
 * @returns Promise<LocalAudioTrack | null>
 */
export async function createAudioTrackWithGain(
  constraints: MediaTrackConstraints,
  gain: number,
): Promise<LocalAudioTrack | null> {
  try {
    // Get raw microphone stream
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
    const sourceTrack = stream.getAudioTracks()[0]

    if (!sourceTrack) {
      throw new Error("No audio track found in stream")
    }

    // Create Web Audio pipeline
    const ctx = getAudioContext()

    // Create source from the microphone stream
    const source = ctx.createMediaStreamSource(new MediaStream([sourceTrack]))

    // Create gain node
    currentGainNode = ctx.createGain()
    currentGainNode.gain.value = gain

    // Create destination to get processed stream
    const destination = ctx.createMediaStreamDestination()

    // Connect: source -> gain -> destination
    source.connect(currentGainNode)
    currentGainNode.connect(destination)

    // Get the processed track from destination
    const processedTrack = destination.stream.getAudioTracks()[0]

    // Create LiveKit track from processed stream
    const track = new LocalAudioTrack(processedTrack, undefined, true)

    // When the track is stopped, also stop the source track
    const originalStop = track.stop.bind(track)
    track.stop = () => {
      originalStop()
      sourceTrack.stop()
      // Disconnect nodes
      source.disconnect()
      currentGainNode?.disconnect()
    }

    return track
  } catch (error) {
    console.error("Failed to create audio track with gain:", error)
    return null
  }
}

/**
 * Update the gain value on the current gain node
 * This can be called while the track is active
 *
 * @param gain - New gain value (0.0 to 1.2)
 */
export function setMicrophoneGain(gain: number): void {
  if (currentGainNode) {
    currentGainNode.gain.setValueAtTime(gain, getAudioContext().currentTime)
  }
}

/**
 * LiveKit Native Audio Processor
 *
 * Uses LiveKit's built-in noise suppression.
 * This is a simple processor that just provides constraints.
 */
export class LiveKitNativeProcessor {
  readonly id = "livekit-native" as const
  readonly name = "LiveKit Native"
  readonly description = "Built-in LiveKit noise suppression (SFU-optimized, low latency)"

  /**
   * Check if LiveKit is available (always true if this code runs)
   */
  isSupported(): boolean {
    // LiveKit native processing is always supported when using LiveKit
    // It runs server-side in the SFU, so no client-side requirements
    return true
  }

  /**
   * Get MediaTrackConstraints for LiveKit native processing
   * Disables browser-native noise suppression since LiveKit handles it
   */
  getConstraints(): MediaTrackConstraints {
    return {
      noiseSuppression: false, // Disable browser NS, use LiveKit's instead
      echoCancellation: true,
      autoGainControl: true,
    }
  }
}

/**
 * Factory function to create LiveKit native processor instance
 */
export function createLiveKitNativeProcessor(): LiveKitNativeProcessor {
  return new LiveKitNativeProcessor()
}

/**
 * Get the appropriate audio constraints for publishing to LiveKit
 *
 * @param algorithm - The selected noise suppression algorithm
 * @param deviceId - Optional device ID for input device selection (empty string = default)
 * @returns MediaTrackConstraints to use when creating the audio track
 */
export function getLiveKitAudioConstraints(
  algorithm: NoiseSuppressionAlgorithm,
  deviceId?: string,
): MediaTrackConstraints {
  // Base constraints based on algorithm
  let constraints: MediaTrackConstraints

  switch (algorithm) {
    case "livekit-native":
      // Use LiveKit's built-in noise suppression
      constraints = {
        noiseSuppression: false, // Let LiveKit handle it
        echoCancellation: true,
        autoGainControl: true,
      }
      break

    case "browser-native":
      // Use browser's WebRTC Audio Processing
      constraints = {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      }
      break

    case "off":
      // No noise suppression
      constraints = {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: true,
      }
      break

    default:
      constraints = {
        echoCancellation: true,
        autoGainControl: true,
      }
  }

  // Add device ID if specified (and not empty)
  if (deviceId && deviceId !== "") {
    constraints.deviceId = { exact: deviceId }
  }

  return constraints
}
