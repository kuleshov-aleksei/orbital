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
  const animationId = ref<number | null>(null)
  const lastUpdateTime = ref(0)

  // Computed
  const isSpeaking = computed(() => !isMuted.value && audioLevel.value > speakingThreshold)

  // Analyze audio level from time domain data (better for speech detection)
  const analyzeAudioLevel = () => {
    if (!analyser.value || isMuted.value) {
      audioLevel.value = 0
      return
    }

    const dataArray = new Uint8Array(analyser.value.frequencyBinCount)
    analyser.value.getByteFrequencyData(dataArray)

    // Calculate RMS (root mean square) for better volume representation
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      const value = dataArray[i] / 255 // Normalize to 0-1
      sum += value * value
    }
    const rms = Math.sqrt(sum / dataArray.length)

    // Apply some smoothing
    //audioLevel.value = audioLevel.value * 0.7 + rms * 0.3
    audioLevel.value = rms
  }

  // Animation loop with throttling
  const animate = (currentTime: number) => {
    if (currentTime - lastUpdateTime.value >= updateInterval) {
      analyzeAudioLevel()
      lastUpdateTime.value = currentTime
    }

    setTimeout(() => {
      animationId.value = requestAnimationFrame(animate)
    }, updateInterval)
  }

  // Setup audio analysis
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

      // Start animation loop
      animationId.value = requestAnimationFrame(animate)

      console.log('Voice activity detection initialized')
    } catch (error) {
      console.error('Error setting up voice activity detection:', error)
    }
  }

  // Cleanup resources
  const cleanup = () => {
    if (animationId.value) {
      cancelAnimationFrame(animationId.value)
      animationId.value = null
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
