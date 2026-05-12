<template>
  <Transition name="slide-in">
    <div
      v-if="visible"
      class="absolute top-20 right-4 z-40 pointer-events-auto"
      @click="$emit('click')">
      <div
        class="bg-theme-bg-secondary border border-theme-border text-theme-text-primary px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-xs cursor-pointer hover:bg-theme-bg-hover transition-colors duration-200"
        role="button"
        tabindex="0"
        @keydown.enter="$emit('click')">
        <UserAvatar :user-id="senderId" :size="36" :show-status="false" />

        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2">
            <span class="font-medium text-sm">{{ senderName }}</span>
          </div>
          <p class="text-sm text-theme-text-muted truncate">{{ truncatedMessage }}</p>
        </div>

        <button
          type="button"
          class="flex-shrink-0 p-1 hover:bg-theme-bg-tertiary rounded transition-colors"
          @click.stop="$emit('dismiss')">
          <PhX class="w-4 h-4 text-theme-text-muted" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { PhX } from "@phosphor-icons/vue"

interface Props {
  visible: boolean
  senderName: string
  senderId: string
  message: string
}

const props = defineProps<Props>()

defineEmits<{
  dismiss: []
  click: []
}>()

const MAX_MESSAGE_LENGTH = 40

const truncatedMessage = computed(() => {
  if (props.message.length <= MAX_MESSAGE_LENGTH) {
    return props.message
  }
  return props.message.slice(0, MAX_MESSAGE_LENGTH) + "..."
})
</script>

<style scoped>
.slide-in-enter-active {
  animation: slide-in 0.3s ease-out;
}

.slide-in-leave-active {
  animation: slide-out 0.2s ease-out;
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slide-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(20px);
  }
}
</style>
