<template>
  <div class="modal-overlay fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50">
    <div class="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-md">
      <!-- Modal Header -->
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-semibold text-white">{{ title }}</h2>

        <button
          type="button"
          class="text-gray-400 hover:text-white transition-colors duration-200"
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
        <!-- Category Name -->
        <div class="mb-6">
          <label for="categoryName" class="block text-sm font-medium text-gray-300 mb-2">
            Category Name
          </label>

          <input
            id="categoryName"
            v-model="categoryName"
            type="text"
            required
            placeholder="Enter category name"
            maxlength="32"
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />

          <div class="flex justify-between mt-1">
            <p v-if="categoryNameError" class="text-red-500 text-sm">
              {{ categoryNameError }}
            </p>

            <p class="text-gray-500 text-xs">{{ charCount }}/32 characters</p>
          </div>
        </div>

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
            class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors duration-200"
            :disabled="!isValid">
            {{ submitButtonText }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"

interface Props {
  title: string
  submitButtonText: string
  initialName?: string
}

const props = withDefaults(defineProps<Props>(), {
  initialName: "",
})

const emit = defineEmits<{
  close: []
  submit: [name: string]
}>()

// Form data
const categoryName = ref("")

onMounted(() => {
  categoryName.value = props.initialName
})

// Character count
const charCount = computed(() => {
  // Count actual Unicode characters, not bytes
  return Array.from(categoryName.value).length
})

// Validation errors
const categoryNameError = computed(() => {
  const trimmed = categoryName.value.trim()
  if (!trimmed) {
    return "Category name is required"
  }
  if (charCount.value > 32) {
    return "Category name is too long (max 32 characters)"
  }
  return ""
})

const isValid = computed(() => {
  const trimmed = categoryName.value.trim()
  return trimmed && charCount.value <= 32
})

const handleSubmit = () => {
  if (!isValid.value) {
    return
  }

  emit("submit", categoryName.value.trim())
}
</script>

<style scoped>
.modal-overlay {
  backdrop-filter: blur(4px);
}
</style>
