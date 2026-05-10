<template>
  <div
    class="user-control-panel transition-all duration-200 bg-theme-bg-secondary border-t border-theme-border">
    <!-- Expanded Panel - Only Visible When In Call (appears above base panel) -->
    <div v-if="isInCall" class="border-b border-theme-border p-3">
      <div class="flex items-center justify-between">
        <!-- Room Info -->
        <div class="flex items-center min-w-0 flex-1">
          <div class="w-2 h-2 rounded-full mr-2 flex-shrink-0" :class="connectionStatusColor"></div>

          <div class="min-w-0">
            <div class="text-sm font-medium text-theme-text-primary truncate">
              {{ roomName }}
            </div>

            <div class="text-xs text-theme-text-muted">
              {{ connectionStatusText }} • {{ ping }}ms
            </div>
          </div>
        </div>

        <!-- Call Control Buttons -->
        <div class="flex items-center space-x-2 ml-3">
          <!-- Screen Share Toggle - Hidden on mobile browsers -->
          <ScreenShareButton
            v-model="localScreenSharing"
            size="sm"
            @start-screen-share="$emit('start-screen-share')"
            @auth-required="$emit('auth-required')" />

          <!-- Stop Watching -->
          <button
            v-if="callStore.watchingUserIds.size > 0"
            type="button"
            class="w-9 h-9 rounded-lg flex items-center justify-center bg-amber-600 hover:bg-amber-700 text-white transition-colors duration-200"
            title="Stop watching"
            @click="callStore.triggerStopWatching()">
            <PhImageBroken class="w-5 h-5" />
          </button>

          <!-- Leave Room Button -->
          <button
            v-else
            type="button"
            class="w-9 h-9 rounded-lg flex items-center justify-center bg-red-600 hover:bg-red-700 text-white transition-colors duration-200"
            title="Leave Room"
            @click="leaveRoom">
            <PhSignOut class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Base Panel - Always Visible -->
    <div class="p-3">
      <div class="flex items-center justify-between">
        <!-- User Info -->
        <div class="flex items-center flex-1 min-w-0">
          <UserAvatar :user-id="userId" status="online" :size="36" class="mr-3 flex-shrink-0" />

          <div class="min-w-0">
            <div class="font-medium text-sm text-theme-text-primary truncate">
              {{ userStore.nickname }}
            </div>

            <div class="text-xs text-theme-text-muted">
              {{ statusText }}
            </div>
          </div>
        </div>

        <!-- Control Buttons -->
        <div class="flex items-center space-x-2 ml-2">
          <!-- Microphone Toggle -->
          <MicMuteButton v-model="localMuted" size="sm" />

          <!-- Headphone/Deafen Toggle -->
          <AudioDeafenButton v-model="localDeafened" size="sm" />

          <!-- Settings Button -->
          <button
            type="button"
            class="w-8 h-8 rounded-full flex items-center justify-center bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary transition-colors duration-200"
            title="Settings"
            @click="openSettings">
            <PhGearSix class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import UserAvatar from "@/components/UserAvatar.vue"
import MicMuteButton from "@/components/MicMuteButton.vue"
import AudioDeafenButton from "@/components/AudioDeafenButton.vue"
import ScreenShareButton from "@/components/ScreenShareButton.vue"
import { useModalStore, useUserStore, useCallStore } from "@/stores"
import { PhSignOut, PhGearSix, PhImageBroken } from "@phosphor-icons/vue"

interface Props {
  userId: string
  isInCall: boolean
  roomName?: string
  ping?: number
  connectionQuality?: "sub-wave" | "excellent" | "good" | "fair" | "poor"
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  roomName: "",
  ping: 0,
  connectionQuality: "excellent",
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false,
})

const emit = defineEmits<{
  "update:modelValueMuted": [value: boolean]
  "update:modelValueDeafened": [value: boolean]
  "update:modelValueScreenSharing": [value: boolean]
  "start-screen-share": []
  "auth-required": []
  "leave-room": []
  "open-settings": []
}>()

// Stores
const modalStore = useModalStore()
const userStore = useUserStore()
const callStore = useCallStore()

// Computed properties for v-model support - parent controls all state
const localMuted = computed({
  get: () => props.modelValueMuted,
  set: (value) => emit("update:modelValueMuted", value),
})

const localDeafened = computed({
  get: () => props.modelValueDeafened,
  set: (value) => emit("update:modelValueDeafened", value),
})

const localScreenSharing = computed({
  get: () => props.modelValueScreenSharing,
  set: (value) => emit("update:modelValueScreenSharing", value),
})

// Status text
const statusText = computed(() => {
  if (localDeafened.value) return "Deafened"
  if (localMuted.value) return "Muted"
  return "Online"
})

// Connection status
const connectionStatusText = computed(() => {
  switch (props.connectionQuality) {
    case "excellent":
      return "Excellent"
    case "good":
      return "Good"
    case "fair":
      return "Fair"
    case "poor":
      return "Poor"
    case "sub-wave":
      return "Sub-Wave"
    default:
      return "Connected"
  }
})

const connectionStatusColor = computed(() => {
  switch (props.connectionQuality) {
    case "excellent":
      return "bg-green-400"
    case "good":
      return "bg-green-500"
    case "fair":
      return "bg-yellow-400"
    case "poor":
      return "bg-red-400"
    case "sub-wave":
      return "bg-purple-400"
    default:
      return "bg-green-400"
  }
})

// Methods
const leaveRoom = () => {
  emit("leave-room")
}

const openSettings = () => {
  modalStore.openUserSettingsModal()
  emit("open-settings")
}
</script>
