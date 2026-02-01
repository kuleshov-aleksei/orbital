<template>
  <button
    v-if="isScreenShareSupported"
    type="button"
    class="control-button"
    :class="[
      sizeClasses,
      isScreenSharing
        ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
        : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'
    ]"
    :title="isScreenSharing ? 'Stop Sharing' : 'Share Screen'"
    @click="toggleScreenShare"
  >
    <PhMonitorPlay :class="iconClasses" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PhMonitorPlay } from '@phosphor-icons/vue'
import { useCallStore, useUserStore, useRoomStore } from '@/stores'
import { wsService } from '@/services/websocket'
import { useScreenShareSupport } from '@/composables/useScreenShareSupport'

interface Props {
  modelValue: boolean
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'start-screen-share': []
}>()

// Stores and composables
const callStore = useCallStore()
const userStore = useUserStore()
const roomStore = useRoomStore()
const { isScreenShareSupported } = useScreenShareSupport()

// Computed v-model
const isScreenSharing = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  }
})

// Size classes based on prop
const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-9 h-9 rounded-lg'
    case 'lg':
      return 'w-12 h-12 rounded-full'
    case 'md':
    default:
      return 'w-10 h-10 rounded-full'
  }
})

// Icon size classes
const iconClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-4 h-4'
    case 'lg':
      return 'w-5 h-5'
    case 'md':
    default:
      return 'w-5 h-5'
  }
})

// Toggle screen share with WebSocket notification
const toggleScreenShare = () => {
  const newValue = !isScreenSharing.value
  
  // If starting screen share, emit event so parent can show quality modal
  if (newValue) {
    emit('start-screen-share')
    return
  }
  
  // If stopping, handle immediately
  isScreenSharing.value = newValue
  
  // Update call store
  callStore.setScreenSharing(newValue)
  
  // Immediately update room store for local user so UI updates right away
  roomStore.updateUserStatus(userStore.userId, { is_screen_sharing: newValue })
  
  // Send WebSocket message if connected
  if (wsService.isConnected()) {
    wsService.sendMessage('screen_share_stop', {
      user_id: userStore.userId
    })
  }
}

// Method to be called by parent after quality is selected
const confirmStartScreenShare = (quality: string = 'source', hasAudio: boolean = false) => {
  const newValue = true
  isScreenSharing.value = newValue
  
  // Update call store
  callStore.setScreenSharing(newValue)
  
  // Immediately update room store for local user so UI updates right away
  roomStore.updateUserStatus(userStore.userId, { is_screen_sharing: newValue })
  
  // Send WebSocket message if connected
  if (wsService.isConnected()) {
    wsService.sendMessage('screen_share_start', {
      user_id: userStore.userId,
      quality: quality,
      has_audio: hasAudio
    })
  }
}

// Expose method for parent to call after quality selection
defineExpose({
  confirmStartScreenShare
})
</script>

<style scoped>
.control-button {
  @apply flex items-center justify-center transition-colors duration-200;
}
</style>
