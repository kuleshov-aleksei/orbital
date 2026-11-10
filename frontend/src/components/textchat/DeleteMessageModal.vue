<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50 p-4"
      data-testid="delete-message-modal"
      @click.self="$emit('close')"
      @keydown.escape="$emit('close')">
      <div class="bg-theme-bg-secondary rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 class="text-lg font-semibold text-theme-text-primary mb-2">Delete message</h2>
        <p class="text-sm text-theme-text-secondary mb-4">
          Are you sure you want to delete this message?
        </p>
        <div
          class="mb-4 p-3 rounded-lg bg-theme-bg-tertiary border border-theme-border max-h-40 overflow-hidden">
          <MessageContent :content="message.content" />
        </div>
        <p class="text-xs text-theme-text-muted mb-4">
          Tip: hold Shift when clicking delete to skip this confirmation.
        </p>
        <div class="flex gap-3">
          <button
            type="button"
            class="flex-1 px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg transition-colors"
            @click="$emit('close')">
            Cancel
          </button>
          <button
            ref="confirmButton"
            type="button"
            class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            data-testid="confirm-delete-message"
            @click="$emit('confirm')">
            Delete
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue"
import MessageContent from "./MessageContent.vue"
import type { TextMessage } from "@/types/textChat"

defineProps<{ message: TextMessage }>()
defineEmits<{ close: []; confirm: [] }>()

const confirmButton = useTemplateRef<HTMLButtonElement>("confirmButton")
onMounted(() => confirmButton.value?.focus())
</script>
