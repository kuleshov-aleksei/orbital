<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50 p-4"
      data-testid="mute-channel-modal"
      @click.self="$emit('close')"
      @keydown.escape="$emit('close')">
      <form
        class="bg-theme-bg-secondary rounded-lg p-6 w-full max-w-sm shadow-xl"
        @submit.prevent="confirm">
        <h2 class="text-lg font-semibold text-theme-text-primary mb-1">
          Mute #<EmojiText :text="channelName" />
        </h2>
        <p class="text-sm text-theme-text-secondary mb-4">
          No unread dot, mention badges or mention sounds while muted. You can still open the
          channel.
        </p>
        <fieldset class="space-y-1 mb-5">
          <legend class="sr-only">Mute for</legend>
          <label
            v-for="opt in OPTIONS"
            :key="opt.value"
            class="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm text-theme-text-primary hover:bg-theme-bg-hover"
            :class="{ 'bg-theme-bg-tertiary': duration === opt.value }">
            <input
              v-model="duration"
              type="radio"
              name="mute-duration"
              :value="opt.value"
              class="accent-theme-accent"
              :data-testid="`mute-${opt.value}`" />
            {{ opt.label }}
          </label>
        </fieldset>
        <p v-if="error" class="text-xs text-red-400 mb-3">{{ error }}</p>
        <div class="flex gap-3">
          <button
            type="button"
            class="flex-1 px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg transition-colors"
            @click="$emit('close')">
            Cancel
          </button>
          <button
            ref="confirmButton"
            type="submit"
            class="flex-1 px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg transition-colors disabled:opacity-60"
            :disabled="saving"
            data-testid="confirm-mute">
            Mute
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue"
import EmojiText from "@/components/common/EmojiText.vue"
import { useRoomStore } from "@/stores"
import { useTextNotifyStore } from "@/stores/textNotify"
import type { TextMuteDuration } from "@/types/textChat"

const props = defineProps<{ roomId: string }>()
const emit = defineEmits<{ close: [] }>()

const OPTIONS: { value: TextMuteDuration; label: string }[] = [
  { value: "1h", label: "For 1 hour" },
  { value: "4h", label: "For 4 hours" },
  { value: "1d", label: "For 1 day" },
  { value: "1w", label: "For 1 week" },
  { value: "forever", label: "Until I turn it back on" },
]

const roomStore = useRoomStore()
const notifyStore = useTextNotifyStore()
const duration = ref<TextMuteDuration>("1h")
const saving = ref(false)
const error = ref("")
const confirmButton = useTemplateRef<HTMLButtonElement>("confirmButton")

const channelName = computed(() => roomStore.rooms.find((r) => r.id === props.roomId)?.name ?? "")

async function confirm() {
  saving.value = true
  error.value = ""
  try {
    await notifyStore.setMode(props.roomId, "muted", duration.value)
    emit("close")
  } catch {
    error.value = "Failed to mute the channel. Try again."
  } finally {
    saving.value = false
  }
}

onMounted(() => confirmButton.value?.focus())
</script>
