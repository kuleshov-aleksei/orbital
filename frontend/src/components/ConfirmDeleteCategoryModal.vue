<template>
  <div
    class="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-md">
      <!-- Modal Header -->
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-semibold text-white">Delete Category</h2>

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
          <strong>Warning:</strong> You are about to delete the category "{{
            categoryName
          }}".
          {{
            roomCount > 0
              ? `This category contains ${roomCount} room${roomCount !== 1 ? "s" : ""}.`
              : "This category is empty."
          }}
        </p>
      </div>

      <form @submit.prevent="handleSubmit">
        <!-- Delete Rooms Option -->
        <div class="mb-4">
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="deleteRooms"
              type="checkbox"
              class="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500" />

            <div>
              <span class="text-sm font-medium text-gray-300"
                >Delete all rooms in this category</span
              >

              <p class="text-xs text-gray-500 mt-1">
                If checked, all {{ roomCount }} room{{
                  roomCount !== 1 ? "s" : ""
                }}
                will be permanently deleted. If unchecked, rooms will be moved
                to another category.
              </p>
            </div>
          </label>
        </div>

        <!-- Target Category Selection -->
        <div v-if="!deleteRooms && availableCategories.length > 0" class="mb-6">
          <label
            for="targetCategory"
            class="block text-sm font-medium text-gray-300 mb-2">
            Move rooms to category
          </label>

          <select
            id="targetCategory"
            v-model="targetCategoryId"
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
            <option
              v-for="cat in availableCategories"
              :key="cat.id"
              :value="cat.id">
              {{ cat.name }}
            </option>
          </select>

          <p class="text-gray-500 text-xs mt-1">
            All rooms will be moved to the selected category.
          </p>
        </div>

        <div
          v-else-if="!deleteRooms && availableCategories.length === 0"
          class="mb-6 p-3 bg-yellow-900 bg-opacity-30 border border-yellow-800 rounded-lg">
          <p class="text-yellow-400 text-sm">
            No other categories available. You must either create a new category
            first or delete the rooms.
          </p>
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
            class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200"
            :disabled="!isValid">
            Delete Category
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import type { Category } from "@/types"

interface Props {
  categoryId: string
  categoryName: string
  roomCount: number
  categories: Category[]
  generalCategoryId: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  confirm: [deleteRooms: boolean, targetCategoryId?: string]
}>()

// Form state
const deleteRooms = ref(false)
const targetCategoryId = ref("")

onMounted(() => {
  // Set default target category to "general" if available
  if (props.generalCategoryId && props.generalCategoryId !== props.categoryId) {
    targetCategoryId.value = props.generalCategoryId
  } else if (availableCategories.value.length > 0) {
    targetCategoryId.value = availableCategories.value[0].id
  }
})

// Filter out the current category from available targets
const availableCategories = computed(() => {
  return props.categories.filter((cat) => cat.id !== props.categoryId)
})

const isValid = computed(() => {
  if (deleteRooms.value) {
    return true // Can always delete if we're deleting rooms
  }
  // If not deleting rooms, must have a valid target category
  return availableCategories.value.length > 0 && targetCategoryId.value !== ""
})

const handleSubmit = () => {
  if (!isValid.value) {
    return
  }

  emit(
    "confirm",
    deleteRooms.value,
    deleteRooms.value ? undefined : targetCategoryId.value,
  )
}
</script>

<style scoped>
.modal-overlay {
  backdrop-filter: blur(4px);
}
</style>
