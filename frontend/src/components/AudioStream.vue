<template>
  <div class="audio-stream relative bg-gray-800 rounded-lg p-3 border border-gray-600">
    <!-- User Info Header -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center">
        <div class="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold text-white mr-3">
          {{ userNickname.charAt(0).toUpperCase() }}
        </div>
        <div>
          <div class="text-white font-medium">{{ userNickname }}</div>
          <div class="text-xs text-gray-400">
            <span v-if="connectionState === 'connected'" class="text-green-400">Connected</span>
            <span v-else-if="connectionState === 'connecting'" class="text-yellow-400">Connecting...</span>
            <span v-else class="text-gray-400">{{ connectionState || 'Unknown' }}</span>
          </div>
        </div>
      </div>
      
      <!-- Audio Controls -->
      <div class="flex items-center space-x-2">
        <!-- Mute Button -->
        <button
          :class="[
            'p-2 rounded-full transition-colors duration-200',
            isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
          ]"
          :title="isMuted ? 'Unmute user' : 'Mute user'"
          @click="toggleMute"
        >
          <PhMicrophoneSlash v-if="isMuted" class="w-4 h-4 text-white" />
          <PhMicrophone v-else class="w-4 h-4 text-white" />
        </button>
        
        <!-- Volume Control -->
        <div class="flex items-center">
          <PhSpeakerHigh class="w-4 h-4 text-gray-400 mr-2" />
          <div class="relative">
            <input
              v-model="volume"
              type="range"
              min="0"
              max="100"
              class="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              title="Volume control"
              @input="updateVolume"
            />
            <div 
              class="absolute top-0 left-0 text-xs text-gray-400"
              style="margin-top: -20px;"
            >
              {{ Math.round(volume) }}%
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Audio Element (Hidden) -->
    <audio
      :id="`audio-${userId}`"
      ref="audioElement"
      :muted="isMuted"
      autoplay
      playsinline
      class="hidden"
    />

    <!-- Audio Level Visualization -->
    <div class="mt-3">
      <div class="flex items-center justify-between text-xs text-gray-400 mb-1">
        <span>Audio Level</span>
        <span>{{ Math.round(audioLevel * 100) }}%</span>
      </div>
      <div class="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          class="bg-green-400 h-full transition-all duration-150 ease-out"
          :style="{ width: (audioLevel * 100) + '%' }"
        />
      </div>
    </div>

    <!-- Speaking Indicator -->
    <div
      v-if="isSpeaking"
      class="absolute top-2 right-2 w-3 h-3 bg-green-400 rounded-full animate-pulse"
      title="Speaking"
    />

    <!-- Muted Indicator -->
    <div
      v-if="isMuted"
      class="absolute top-2 right-2 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center"
      title="Muted"
    >
      <PhMicrophoneSlash class="w-3 h-3 text-white" />
    </div>
  </div>
</template>

<script setup lang="ts">
 import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
 import { 
   PhMicrophone, 
   PhMicrophoneSlash, 
   PhSpeakerHigh 
 } from '@phosphor-icons/vue'

 interface Props {
   userId: string
   userNickname: string
   stream: MediaStream | null
   connectionState?: string
   initialVolume?: number
 }

 const props = withDefaults(defineProps<Props>(), {
   connectionState: 'disconnected',
   initialVolume: 80
 })

const emit = defineEmits<{
  'volume-change': [userId: string, volume: number]
  'mute-toggle': [userId: string, isMuted: boolean]
  'audio-level': [userId: string, level: number, isSpeaking: boolean]
}>()

 // Reactive state
 const audioElement = ref<HTMLAudioElement | null>(null)
 const volume = ref(props.initialVolume)
 const isMuted = ref(false)
 const audioLevel = ref(0)
 const audioContext = ref<AudioContext | null>(null)
 const analyser = ref<AnalyserNode | null>(null)
 const animationId = ref<number | null>(null)

 // Computed properties
 const isSpeaking = computed(() => audioLevel.value > 0.1) // Threshold for speaking detection

 // Update volume of audio element
 const updateVolume = () => {
   if (audioElement.value) {
     audioElement.value.volume = volume.value / 100
   }
   emit('volume-change', props.userId, volume.value)
 }

 // Toggle mute state
 const toggleMute = () => {
   isMuted.value = !isMuted.value
   if (audioElement.value) {
     audioElement.value.muted = isMuted.value
   }
   emit('mute-toggle', props.userId, isMuted.value)
 }

 // Analyze audio level
 const analyzeAudioLevel = () => {
   if (!analyser.value) return

   const dataArray = new Uint8Array(analyser.value.frequencyBinCount)
   analyser.value.getByteFrequencyData(dataArray)

   // Calculate average volume from frequency data
   let sum = 0
   for (let i = 0; i < dataArray.length; i++) {
     sum += dataArray[i]
   }
   const average = sum / dataArray.length
   const normalizedLevel = average / 255 // Normalize to 0-1

   audioLevel.value = normalizedLevel
 }

  // Animation loop for audio level visualization
  const animate = () => {
    analyzeAudioLevel()
    // Emit audio level data to parent for icon animation
    emit('audio-level', props.userId, audioLevel.value, isSpeaking.value)
    
    // Throttle to ~10fps (100ms intervals) instead of 60fps
    setTimeout(() => {
      animationId.value = requestAnimationFrame(animate)
    }, 100)
  }

 // Setup audio analysis
 const setupAudioAnalysis = () => {
   if (!props.stream || !audioElement.value) return

   try {
     // Create Web Audio API context
     audioContext.value = new (window.AudioContext || (window as any).webkitAudioContext)()
     
     const source = audioContext.value!.createMediaStreamSource(props.stream)
     analyser.value = audioContext.value!.createAnalyser()
     analyser.value.fftSize = 256
     
     source.connect(analyser.value)
     
     // Start animation loop
     animate()
   } catch (error) {
     console.error('Error setting up audio analysis:', error)
   }
 }

  // Watch for stream changes
  watch(() => props.stream, (newStream) => {
    if (newStream && audioElement.value) {
      console.log(`🎵 Setting stream for user ${props.userId}:`, newStream)
      audioElement.value.srcObject = newStream
      audioElement.value.play().catch(error => {
        console.warn(`Audio play failed for user ${props.userId}:`, error)
      })
      setupAudioAnalysis()
    }
  }, { immediate: true })

 // Watch for volume changes
 watch(volume, updateVolume)

 // Lifecycle hooks
 onMounted(() => {
   nextTick(() => {
     if (audioElement.value) {
       updateVolume()
     }
   })
 })

 onUnmounted(() => {
   if (animationId.value) {
     cancelAnimationFrame(animationId.value)
   }
   
   if (audioContext.value) {
     audioContext.value.close()
   }
 })
</script>

<style scoped>
.audio-stream input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
}

.audio-stream input[type="range"]::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
  border: none;
}
</style>