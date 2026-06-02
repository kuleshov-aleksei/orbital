<template>
  <div
    class="modal-overlay fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50"
    data-testid="room-modal">
    <div
      class="modal-content bg-theme-bg-secondary rounded-lg p-6 w-full max-w-md border border-theme-border">
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

        <!-- Room Type -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-theme-text-secondary mb-2">
            Room Type
          </label>

          <div class="flex gap-2">
            <button
              type="button"
              :class="[
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-colors duration-200',
                roomType === 'voice'
                  ? 'bg-theme-accent border-theme-accent text-theme-text-on-accent'
                  : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover',
              ]"
              @click="roomType = 'voice'">
              <PhWaveform class="w-4 h-4" />
              <span class="text-sm font-medium">Voice</span>
            </button>

            <button
              type="button"
              :class="[
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-colors duration-200',
                roomType === 'spatial_audio'
                  ? 'bg-theme-accent border-theme-accent text-theme-text-on-accent'
                  : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover',
              ]"
              @click="roomType = 'spatial_audio'">
              <PhGameController class="w-4 h-4" />
              <span class="text-sm font-medium">Spatial</span>
            </button>
          </div>

          <p v-if="roomType === 'spatial_audio'" class="text-theme-text-muted text-xs mt-1">
            Move your character with WASD. Voice audio changes based on distance.
          </p>

          <!-- World Type (only for spatial rooms) -->
          <div v-if="roomType === 'spatial_audio'" class="mt-4">
            <label for="roomWorld" class="block text-sm font-medium text-theme-text-secondary mb-2">
              World Type
            </label>

            <select
              id="roomWorld"
              v-model="roomWorld"
              class="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent focus:ring-1 focus:ring-theme-accent">
              <option v-for="world in availableWorlds" :key="world" :value="world">
                {{ world }}
              </option>
            </select>
          </div>
        </div>

        <!-- Room Category -->
        <div class="mb-4">
          <label
            for="roomCategory"
            class="block text-sm font-medium text-theme-text-secondary mb-2">
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
import { PhWaveform, PhGameController } from "@phosphor-icons/vue"
import { useConfigStore } from "@/stores"
import { AVAILABLE_WORLDS } from "@/config/worlds"

interface Props {
  initialCategory?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  create: [roomName: string, category: string, maxUsers: number, roomType: string, world: string]
}>()

const configStore = useConfigStore()

// Form data
const roomName = ref("")
const roomCategory = ref("")
const roomType = ref<"voice" | "spatial_audio">("voice")
const roomWorld = ref(AVAILABLE_WORLDS[0] || "default")
const maxUsers = ref(10)

const availableWorlds = computed(() => AVAILABLE_WORLDS)

onMounted(() => {
  roomCategory.value = props.initialCategory ?? ""
  roomType.value = "voice"
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
  emit("create", roomName.value.trim(), category, maxUsers.value, roomType.value, roomWorld.value)
}
</script>

<style scoped>
.modal-overlay {
  backdrop-filter: blur(4px);
}
</style>
