import { ref, computed, watch, type Ref, type MaybeRefOrGetter, toValue } from "vue"

export interface VoiceActivityState {
  audioLevel: number
  isSpeaking: boolean
  isMuted: boolean
}

export interface UseVoiceActivityOptions {
  stream: MaybeRefOrGetter<MediaStream | null | Promise<MediaStream | null>>
  isMuted: Ref<boolean>
  speakingThreshold?: number
  updateInterval?: number
}

export function useVoiceActivity(options: UseVoiceActivityOptions) {
  const { stream, isMuted, speakingThreshold = 0.01, updateInterval = 200 } = options

  console.log("[VoiceActivity] useVoiceActivity initialized")

  const audioLevel = ref(0)
  const audioContext = ref<AudioContext | null>(null)
  const analyser = ref<AnalyserNode | null>(null)
  const sourceNode = ref<MediaStreamAudioSourceNode | null>(null)
  const intervalId = ref<number | null>(null)
  const currentStream = ref<MediaStream | null>(null)

  const isSpeaking = computed(() => !isMuted.value && audioLevel.value > speakingThreshold)

  const analyzeAudioLevel = () => {
    if (!analyser.value || isMuted.value) {
      audioLevel.value = 0
      return
    }

    const dataArray = new Uint8Array(analyser.value.fftSize)
    analyser.value.getByteTimeDomainData(dataArray)

    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      const value = (dataArray[i] - 128) / 128
      sum += value * value
    }
    const rms = Math.sqrt(sum / dataArray.length)

    audioLevel.value = audioLevel.value * 0.7 + rms * 0.3
  }

  const setupAudioAnalysis = (mediaStream: MediaStream) => {
    if (!mediaStream) {
      console.log("[VoiceActivity] Stream is null, cleaning up")
      cleanup()
      return
    }

    const audioTracks = mediaStream.getAudioTracks()
    if (audioTracks.length === 0) {
      console.log("[VoiceActivity] No audio tracks in stream, waiting...")
      cleanup()
      return
    }

    try {
      cleanup()

      audioContext.value = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )()

      if (audioContext.value.state === "suspended") {
        console.log("[VoiceActivity] AudioContext is suspended, resuming...")
        void audioContext.value.resume()
      }

      analyser.value = audioContext.value.createAnalyser()
      analyser.value.fftSize = 256
      analyser.value.smoothingTimeConstant = 0.8

      sourceNode.value = audioContext.value.createMediaStreamSource(mediaStream)
      sourceNode.value.connect(analyser.value)

      currentStream.value = mediaStream
      currentStream.value.addEventListener("addtrack", handleTrackChange)
      currentStream.value.addEventListener("removetrack", handleTrackChange)

      intervalId.value = window.setInterval(() => {
        analyzeAudioLevel()
      }, updateInterval)

      console.log("[VoiceActivity] Initialized with", audioTracks.length, "audio track(s)")
    } catch (error) {
      console.error("[VoiceActivity] Error setting up:", error)
    }
  }

  const cleanup = () => {
    stopPolling()

    if (intervalId.value) {
      clearInterval(intervalId.value)
      intervalId.value = null
    }

    if (currentStream.value) {
      currentStream.value.removeEventListener("addtrack", handleTrackChange)
      currentStream.value.removeEventListener("removetrack", handleTrackChange)
      currentStream.value = null
    }

    if (sourceNode.value) {
      try {
        sourceNode.value.disconnect()
      } catch {
        // Ignore
      }
      sourceNode.value = null
    }

    if (analyser.value) {
      try {
        analyser.value.disconnect()
      } catch {
        // Ignore
      }
      analyser.value = null
    }

    if (audioContext.value) {
      void audioContext.value.close()
      audioContext.value = null
    }

    audioLevel.value = 0
  }

  const handleTrackChange = () => {
    console.log(
      "[VoiceActivity] Audio tracks changed:",
      currentStream.value?.getAudioTracks().length,
    )
    if (currentStream.value && currentStream.value.getAudioTracks().length > 0) {
      setupAudioAnalysis(currentStream.value)
    } else {
      cleanup()
    }
  }

  let pollingInterval: number | null = null

  const startPolling = (streamFn: () => Promise<MediaStream | null>) => {
    stopPolling()
    console.log("[VoiceActivity] Starting polling for stream...")
    pollingInterval = window.setInterval(async () => {
      try {
        const resolved = await streamFn()
        if (resolved instanceof MediaStream && resolved.getAudioTracks().length > 0) {
          console.log("[VoiceActivity] Polling found valid stream")
          stopPolling()
          setupAudioAnalysis(resolved)
        }
      } catch (e) {
        console.error("[VoiceActivity] Polling error:", e)
      }
    }, 500)
  }

  const stopPolling = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
  }

  const resolveStream = async (): Promise<MediaStream | null> => {
    const value = toValue(stream)

    if (value instanceof MediaStream) {
      return value
    }

    if (typeof value === "function") {
      const fn = value as () => Promise<MediaStream | null>
      return await fn()
    }

    if (value instanceof Promise) {
      return await (value as Promise<MediaStream | null>)
    }

    return null
  }

  watch(
    () => toValue(stream),
    async (newStream) => {
      console.log("[VoiceActivity] Watch triggered, resolving stream...")
      stopPolling()

      if (newStream instanceof MediaStream) {
        setupAudioAnalysis(newStream)
        return
      }

      let streamValue: MediaStream | null = null

      if (typeof newStream === "function") {
        const fn = newStream as () => Promise<MediaStream | null>
        streamValue = await fn()
      } else if (newStream instanceof Promise) {
        streamValue = await (newStream as Promise<MediaStream | null>)
      }

      if (streamValue && streamValue.getAudioTracks().length > 0) {
        setupAudioAnalysis(streamValue)
      } else {
        console.log("[VoiceActivity] Stream not ready yet, starting polling...")
        startPolling(resolveStream)
      }
    },
    { immediate: true },
  )

  watch(isMuted, (muted) => {
    if (muted) {
      audioLevel.value = 0
    }
  })

  return {
    audioLevel,
    isSpeaking,
    cleanup,
  }
}
