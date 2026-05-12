<template>
  <div class="audio-source-picker">
    <label class="text-xs font-medium text-gray-400 uppercase tracking-wide block mb-2">
      Select Audio Sources
    </label>

    <div v-if="isLoading" class="flex items-center justify-center py-4">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" />
    </div>

    <div v-else-if="error" class="text-center py-4">
      <PhWarning class="w-8 h-8 text-red-400 mx-auto mb-2" />
      <p class="text-red-400 text-sm">{{ error }}</p>
    </div>

    <div v-else class="space-y-1 max-h-40 overflow-y-auto">
      <button
        v-for="source in sources"
        :key="source.name"
        type="button"
        class="w-full flex items-center p-2 rounded-lg border transition-all duration-200 text-left"
        :class="[
          isSelected(source.value)
            ? 'border-indigo-500 bg-indigo-500/10'
            : 'border-gray-600 bg-gray-700/30 hover:border-gray-500',
        ]"
        @click="toggleSource(source)">
        <div
          class="w-4 h-4 rounded border flex items-center justify-center mr-2 flex-shrink-0"
          :class="isSelected(source.value) ? 'border-indigo-500 bg-indigo-500' : 'border-gray-500'">
          <PhCheck v-if="isSelected(source.value)" class="w-3 h-3 text-white" />
        </div>
        <span class="text-sm text-gray-200 truncate">{{ source.name }}</span>
      </button>

      <p v-if="sources.length === 0" class="text-sm text-gray-500 text-center py-4">
        No audio sources available
      </p>
    </div>

    <p class="text-xs text-gray-500 mt-2">
      Select applications to capture audio from during screen share
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { PhCheck, PhWarning } from "@phosphor-icons/vue"
import type { VenmicNode } from "@/types"
import { listAudioSourcesDeduplicated } from "@/services/venmic"

interface Props {
  selectedSources: VenmicNode[]
}

interface AudioSource {
  name: string
  value: VenmicNode
}

const props = defineProps<Props>()
const emit = defineEmits<{
  "update:selectedSources": [sources: VenmicNode[]]
}>()

const sources = ref<AudioSource[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  await loadSources()
})

async function loadSources() {
  isLoading.value = true
  error.value = null

  try {
    sources.value = await listAudioSourcesDeduplicated()
  } catch {
    error.value = "Failed to load audio sources"
  } finally {
    isLoading.value = false
  }
}

function isSelected(value: VenmicNode): boolean {
  return props.selectedSources.some((s) => Object.keys(value).every((key) => value[key] === s[key]))
}

function toggleSource(source: AudioSource) {
  const current = [...props.selectedSources]
  const index = current.findIndex((s) =>
    Object.keys(source.value).every((key) => source.value[key] === s[key]),
  )

  if (index >= 0) {
    current.splice(index, 1)
  } else {
    current.push(source.value)
  }

  emit("update:selectedSources", current)
}
</script>
