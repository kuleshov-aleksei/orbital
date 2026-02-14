import { ref, computed, watch, type Ref } from 'vue'

export interface VoiceActivityState {
  audioLevel: number
  isSpeaking: boolean
  isMuted: boolean
}

export interface UseVoiceActivityOptions {
  stream: Ref<MediaStream | null>
  isMuted: Ref<boolean>
  speakingThreshold?: number
  updateInterval?: number
}

export function useVoiceActivity(options: UseVoiceActivityOptions) {
  const { stream, isMuted, speakingThreshold = 0.05, updateInterval = 200 } = options

  // Reactive state
  const audioLevel = ref(0)
  const audioContext = ref<AudioContext | null>(null)
  const analyser = ref<AnalyserNode | null>(null)
  const sourceNode = ref<MediaStreamAudioSourceNode | null>(null)
  const intervalId = ref<number | null>(null)

  // Computed
  const isSpeaking = computed(() => !isMuted.value && audioLevel.value > speakingThreshold)

  // Analyze audio level from time domain data (better for speech detection)
  const analyzeAudioLevel = () => {
    if (!analyser.value || isMuted.value) {
      audioLevel.value = 0
      return
    }

    const dataArray = new Uint8Array(analyser.value.fftSize)
    analyser.value.getByteTimeDomainData(dataArray)

    // Calculate RMS (root mean square) for better volume representation
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      // Time domain data is in range 0-255, center is 128
      const value = (dataArray[i] - 128) / 128 // Normalize to -1 to 1
      sum += value * value
    }
    const rms = Math.sqrt(sum / dataArray.length)

    // Apply exponential smoothing for smoother UI updates
    audioLevel.value = audioLevel.value * 0.7 + rms * 0.3
  }

  // Setup audio analysis using setInterval for 5-10fps updates instead of RAF
  const setupAudioAnalysis = () => {
    if (!stream.value) {
      cleanup()
      return
    }

    try {
      // Clean up existing context first
      cleanup()

      // Create new audio context
      audioContext.value = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

      // Create analyser
      analyser.value = audioContext.value.createAnalyser()
      analyser.value.fftSize = 256
      analyser.value.smoothingTimeConstant = 0.8

      // Create source from stream
      sourceNode.value = audioContext.value.createMediaStreamSource(stream.value)
      sourceNode.value.connect(analyser.value)

      // Use setInterval instead of requestAnimationFrame for 10fps updates
      intervalId.value = window.setInterval(() => {
        analyzeAudioLevel()
      }, updateInterval)

      console.log('Voice activity detection initialized')
    } catch (error) {
      console.error('Error setting up voice activity detection:', error)
    }
  }

  // Cleanup resources
  const cleanup = () => {
    if (intervalId.value) {
      clearInterval(intervalId.value)
      intervalId.value = null
    }

    if (sourceNode.value) {
      try {
        sourceNode.value.disconnect()
      } catch {
        // Ignore disconnection errors
      }
      sourceNode.value = null
    }

    if (analyser.value) {
      try {
        analyser.value.disconnect()
      } catch {
        // Ignore disconnection errors
      }
      analyser.value = null
    }

    if (audioContext.value) {
      void audioContext.value.close()
      audioContext.value = null
    }

    audioLevel.value = 0
  }

  // Watch for stream changes
  watch(stream, (newStream) => {
    if (newStream) {
      setupAudioAnalysis()
    } else {
      cleanup()
    }
  }, { immediate: true })

  // Watch for mute state changes
  watch(isMuted, (muted) => {
    if (muted) {
      audioLevel.value = 0
    }
  })

  return {
    audioLevel,
    isSpeaking,
    cleanup
  }
}
