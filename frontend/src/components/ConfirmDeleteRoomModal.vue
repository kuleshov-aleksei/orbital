<template>
  <div
    class="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-md">
      <!-- Modal Header -->
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-semibold text-white">Delete Room</h2>

        <button
          type="button"
          class="text-gray-400 hover:text-white transition-colors duration-200"
          @click="$emit('close')">
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Warning Message -->
      <div
        class="mb-6 p-4 bg-red-900 bg-opacity-30 border border-red-800 rounded-lg">
        <p class="text-red-400 text-sm">
          <strong>Warning:</strong> You are about to delete the room "{{
            roomName
          }}".
          {{
            userCount > 0
              ? `This room currently has ${userCount} user${userCount !== 1 ? "s" : ""} in it.`
              : "This room is empty."
          }}
          This action cannot be undone.
        </p>
      </div>

      <form @submit.prevent="handleSubmit">
        <!-- Action Buttons -->
        <div class="flex space-x-3">
          <button
            type="button"
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors duration-200"
            @click="$emit('close')">
            Cancel
          </button>

          <button
            type="submit"
            class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200">
            Delete Room
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  roomId: string
  roomName: string
  userCount: number
}

defineProps<Props>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const handleSubmit = () => {
  emit("confirm")
}
</script>

<style scoped>
.modal-overlay {
  backdrop-filter: blur(4px);
}
</style>
