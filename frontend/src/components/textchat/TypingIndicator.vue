<template>
  <div class="h-5 px-4 -mt-1 text-xs text-theme-text-muted truncate" aria-live="polite">
    <template v-if="label">
      <span class="typing-dots" aria-hidden="true"><span /><span /><span /></span>
      <span>{{ label }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useTextChatStore, useUsersStore } from "@/stores"

const props = defineProps<{ roomId: string }>()

const textChatStore = useTextChatStore()
const usersStore = useUsersStore()

const label = computed(() => {
  const names = textChatStore
    .typingUsers(props.roomId)
    .map((id) => usersStore.allUsers.find((u) => u.id === id)?.nickname ?? "Someone")
  if (names.length === 0) return ""
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing…`
  return "Several people are typing…"
})
</script>

<style scoped>
.typing-dots {
  display: inline-flex;
  gap: 2px;
  margin-right: 6px;
  vertical-align: middle;
}
.typing-dots span {
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: currentColor;
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.typing-dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.typing-dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes typing-bounce {
  0%,
  60%,
  100% {
    opacity: 0.3;
  }
  30% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .typing-dots span {
    animation: none;
  }
}
</style>
