<template>
  <div
    class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 transition-opacity duration-300"
    :class="{ 'opacity-0': isFullscreen && !fullscreenControlsVisible }">
    <div class="flex items-center justify-between">
      <div class="flex items-center">
        <UserAvatar class="mr-2" :user-id="userId" :size="24" :show-status="false" />

        <div>
          <div class="text-theme-text-primary font-medium text-sm">{{ userNickname }}</div>

          <div class="text-xs text-theme-text-secondary flex items-center">
            <PhMonitorPlay class="w-3 h-3 mr-1" />
            {{ qualityLabel }}
          </div>
        </div>
      </div>

      <!-- Connection State -->
      <div class="flex items-center text-xs">
        <div class="w-2 h-2 rounded-full mr-1" :class="connectionDotClass" />
        <span class="text-theme-text-secondary capitalize">{{ connectionStateLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhMonitorPlay } from "@phosphor-icons/vue"
import UserAvatar from "@/components/UserAvatar.vue"

const props = defineProps<{
  userId: string
  userNickname: string
  qualityLabel: string
  connectionState?: string
  isFullscreen?: boolean
  fullscreenControlsVisible?: boolean
}>()

const connectionDotClass = computed(() => {
  switch (props.connectionState) {
    case "connected":
      return "bg-green-400"
    case "connecting":
      return "bg-yellow-400"
    case "failed":
    case "closed":
      return "bg-red-400"
    default:
      return "bg-theme-text-muted"
  }
})

const connectionStateLabel = computed(() => {
  return props.connectionState || "connecting"
})
</script>
