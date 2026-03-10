<template>
  <div
    class="modal-overlay fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50"
    data-testid="room-modal">
    <div class="modal-content bg-theme-bg-secondary rounded-lg p-6 w-full max-w-md border border-theme-border">
      <!-- Modal Header -->
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-semibold text-theme-text-primary">Create New Room</h2>

        <button
          type="button"
          data-testid="room-modal-close"
          class="text-theme-text-muted hover:text-theme-text-primary transition-colors duration-200"
          @click="$emit('close')">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Form -->
      <form @submit.prevent="handleSubmit">
        <!-- Room Name -->
        <div class="mb-4">
          <label for="roomName" class="block text-sm font-medium text-theme-text-secondary mb-2">
            Room Name
          </label>

          <input
            id="roomName"
            v-model="roomName"
            type="text"
            required
            placeholder="Enter room name"
            data-testid="room-name-input"
            class="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-theme-accent focus:ring-1 focus:ring-theme-accent" />

          <p v-if="roomNameError" class="text-red-400 text-sm mt-1">
            {{ roomNameError }}
          </p>
        </div>

        <!-- Room Category -->
        <div class="mb-4">
          <label for="roomCategory" class="block text-sm font-medium text-theme-text-secondary mb-2">
            Category
          </label>

          <input
            id="roomCategory"
            v-model="roomCategory"
            type="text"
            placeholder="Enter category name (e.g., Gaming, Study)"
            data-testid="room-category-input"
            class="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-theme-accent focus:ring-1 focus:ring-theme-accent" />

          <p class="text-theme-text-muted text-xs mt-1">
            Leave empty for "general" category. Max 32 characters.
          </p>

          <p v-if="categoryError" class="text-red-400 text-sm mt-1">
            {{ categoryError }}
          </p>
        </div>

        <!-- Max Users -->
        <div class="mb-6">
          <label for="maxUsers" class="block text-sm font-medium text-theme-text-secondary mb-2">
            Max Users ({{ configStore.minUsers }} - {{ configStore.maxUsers }})
          </label>

          <input
            id="maxUsers"
            v-model.number="maxUsers"
            type="number"
            required
            :min="configStore.minUsers"
            :max="configStore.maxUsers"
            data-testid="max-users-input"
            class="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent focus:ring-1 focus:ring-theme-accent" />

          <p v-if="maxUsersError" class="text-red-400 text-sm mt-1">
            {{ maxUsersError }}
          </p>
        </div>

        <!-- Action Buttons -->
        <div class="flex space-x-3">
          <button
            type="button"
            data-testid="room-cancel"
            class="flex-1 px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary rounded-lg transition-colors duration-200"
            @click="$emit('close')">
            Cancel
          </button>

          <button
            type="submit"
            data-testid="room-create-submit"
            class="flex-1 px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg transition-colors duration-200">
            Create Room
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { useConfigStore } from "@/stores"

interface Props {
  initialCategory?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  create: [roomName: string, category: string, maxUsers: number]
}>()

const configStore = useConfigStore()

// Form data
const roomName = ref("")
const roomCategory = ref("")
const maxUsers = ref(10)

onMounted(() => {
  roomCategory.value = props.initialCategory ?? ""
  maxUsers.value = configStore.defaultMaxUsers
})

// Validation errors
const roomNameError = computed(() => {
  if (!roomName.value.trim()) {
    return "Room name is required"
  }
  if (roomName.value.length > 100) {
    return "Room name is too long (max 100 characters)"
  }
  return ""
})

const categoryError = computed(() => {
  // Count Unicode characters (not bytes)
  const charCount = Array.from(roomCategory.value).length
  if (charCount > 32) {
    return "Category name is too long (max 32 characters)"
  }
  return ""
})

const maxUsersError = computed(() => {
  if (maxUsers.value < configStore.minUsers || maxUsers.value > configStore.maxUsers) {
    return `Max users must be between ${configStore.minUsers} and ${configStore.maxUsers}`
  }
  return ""
})

const isValid = computed(() => {
  return (
    roomName.value.trim() &&
    roomName.value.length <= 100 &&
    Array.from(roomCategory.value).length <= 32 &&
    maxUsers.value >= configStore.minUsers &&
    maxUsers.value <= configStore.maxUsers
  )
})

const handleSubmit = () => {
  if (!isValid.value) {
    return
  }

  const category = roomCategory.value.trim() || "general"
  emit("create", roomName.value.trim(), category, maxUsers.value)
}
</script>

<style scoped>
.modal-overlay {
  backdrop-filter: blur(4px);
}
</style>
