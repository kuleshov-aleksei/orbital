<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div 
        class="absolute inset-0 bg-black/70 backdrop-blur-sm"
        @click="handleCancel"
      />
      
      <!-- Modal Content -->
      <div class="relative bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 border border-gray-600">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-gray-700">
          <div class="flex items-center">
            <PhMonitorPlay class="w-6 h-6 text-indigo-400 mr-3" />
            <h2 class="text-xl font-semibold text-white">Share Your Screen</h2>
          </div>
          <p class="text-sm text-gray-400 mt-1">Select streaming quality and audio options</p>
        </div>
        
        <!-- Quality Selection -->
        <div class="px-6 py-4 space-y-3">
          <label class="text-sm font-medium text-gray-300">Quality Settings</label>
          
          <div class="space-y-2">
            <button
              v-for="option in qualityOptions"
              :key="option.value"
              class="w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all duration-200"
              :class="[
                selectedQuality === option.value
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
              ]"
              @click="selectedQuality = option.value"
            >
              <div class="flex items-center">
                <div 
                  class="w-4 h-4 rounded-full border-2 mr-3 flex items-center justify-center"
                  :class="[
                    selectedQuality === option.value
                      ? 'border-indigo-500 bg-indigo-500'
                      : 'border-gray-500'
                  ]"
                >
                  <div 
                    v-if="selectedQuality === option.value" 
                    class="w-2 h-2 bg-white rounded-full"
                  />
                </div>
                <div class="text-left">
                  <div class="text-white font-medium">{{ option.label }}</div>
                  <div class="text-xs text-gray-400">{{ option.description }}</div>
                </div>
              </div>
            </button>
          </div>
        </div>
        
        <!-- Audio Option -->
        <div class="px-6 py-3 border-t border-gray-700">
          <label class="flex items-center cursor-pointer">
            <input
              v-model="shareAudio"
              type="checkbox"
              class="w-5 h-5 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-800"
            />
            <span class="ml-3 text-sm text-gray-300">
              <PhSpeakerHigh class="w-4 h-4 inline mr-1" />
              Share system audio
            </span>
          </label>
          <p class="text-xs text-gray-500 mt-1 ml-8">
            Allows others to hear sounds from your computer
          </p>
        </div>
        
        <!-- Actions -->
        <div class="px-6 py-4 border-t border-gray-700 flex justify-end space-x-3">
          <button
            class="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors duration-200"
            @click="handleCancel"
          >
            Cancel
          </button>
          <button
            class="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-200 flex items-center"
            @click="handleStartShare"
          >
            <PhMonitorPlay class="w-4 h-4 mr-2" />
            Start Sharing
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { PhMonitorPlay, PhSpeakerHigh } from '@phosphor-icons/vue'
import type { ScreenShareQuality } from '@/types'

interface Props {
  isOpen: boolean
}

interface QualityOption {
  value: ScreenShareQuality
  label: string
  description: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'select-quality': [quality: ScreenShareQuality, shareAudio: boolean]
  'cancel': []
}>()

const qualityOptions: QualityOption[] = [
  {
    value: 'source',
    label: 'Source (Native)',
    description: 'Original resolution and frame rate'
  },
  {
    value: '1080p60',
    label: '1080p 60fps',
    description: 'Full HD at 60 frames per second - Best for gaming'
  },
  {
    value: '1080p30',
    label: '1080p 30fps',
    description: 'Full HD at 30 frames per second - Standard HD'
  },
  {
    value: '720p30',
    label: '720p 30fps',
    description: 'HD at 30 frames per second - Balanced quality'
  },
  {
    value: '360p30',
    label: '360p 30fps',
    description: 'Low resolution - Best for slow connections'
  },
  {
    value: 'text',
    label: 'Text Optimized',
    description: 'High resolution at 5fps - Best for code and documents'
  }
]

const selectedQuality = ref<ScreenShareQuality>('1080p30')
const shareAudio = ref(false)

// Reset to defaults when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    selectedQuality.value = '1080p30'
    shareAudio.value = false
  }
})

const handleStartShare = () => {
  emit('select-quality', selectedQuality.value, shareAudio.value)
}

const handleCancel = () => {
  emit('cancel')
}
</script>
