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

    <div v-else>
      <div class="relative mb-2">
        <PhMagnifyingGlass
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search apps or PID..."
          class="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-600 bg-gray-700/30 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none" />
      </div>

      <label class="flex items-center gap-2 mb-2 cursor-pointer select-none">
        <input
          v-model="showAllProcesses"
          type="checkbox"
          class="accent-indigo-500"
          @change="loadSources(showAllProcesses)" />
        <span class="text-xs text-gray-500">Show system processes</span>
      </label>

      <div class="space-y-1 max-h-40 overflow-y-auto">
        <button
          v-for="source in filteredSources"
          :key="source.pid ?? source.name"
          type="button"
          class="w-full flex items-center p-2 rounded-lg border transition-all duration-200 text-left"
          :class="[
            isSelected(source)
              ? 'border-indigo-500 bg-indigo-500/10'
              : 'border-gray-600 bg-gray-700/30 hover:border-gray-500',
          ]"
          @click="toggleSource(source)">
          <div
            class="w-4 h-4 rounded border flex items-center justify-center mr-2 flex-shrink-0"
            :class="isSelected(source) ? 'border-indigo-500 bg-indigo-500' : 'border-gray-500'">
            <PhCheck v-if="isSelected(source)" class="w-3 h-3 text-white" />
          </div>
          <span class="text-sm text-gray-200 truncate flex-1">{{ source.name }}</span>
          <span
            v-if="!source.hasAudio"
            class="text-[10px] text-gray-500 ml-2 flex-shrink-0"
            title="No active audio output yet - will be captured automatically once it starts playing audio">
            no active output
          </span>
        </button>

        <p v-if="filteredSources.length === 0" class="text-sm text-gray-500 text-center py-4">
          {{ searchQuery ? "No apps match your search" : "No apps available" }}
        </p>
      </div>
    </div>

    <p class="text-xs text-gray-500 mt-2">
      Select applications to capture audio from during screen share. Apps without an active audio
      output are picked up automatically once they start producing sound.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue"
import { PhCheck, PhWarning, PhMagnifyingGlass } from "@phosphor-icons/vue"
import type { VenmicApp, VenmicSource } from "@/types"
import { listApps } from "@/services/venmic"

interface Props {
  selectedSources: VenmicSource[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  "update:selectedSources": [sources: VenmicSource[]]
}>()

const sources = ref<VenmicApp[]>([])
const searchQuery = ref("")
const showAllProcesses = ref(false)
const isLoading = ref(true)
const error = ref<string | null>(null)

const filteredSources = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return sources.value
  return sources.value.filter((s) => s.name.toLowerCase().includes(q) || (s.pid ?? "").includes(q))
})

onMounted(async () => {
  await loadSources()
})

async function loadSources(includeAll = false) {
  isLoading.value = true
  error.value = null

  try {
    sources.value = await listApps(includeAll)
  } catch {
    error.value = "Failed to load audio sources"
  } finally {
    isLoading.value = false
  }
}

function criteriaFor(source: VenmicApp): VenmicSource {
  const criteria: VenmicSource = {}
  if (source.pid) criteria["application.process.id"] = source.pid
  if (source.name) criteria["application.name"] = source.name
  return criteria
}

function isSelected(source: VenmicApp): boolean {
  return props.selectedSources.some((s) => {
    if (source.pid) return s["application.process.id"] === source.pid
    return s["application.name"] === source.name
  })
}

function toggleSource(source: VenmicApp) {
  const current = [...props.selectedSources]
  const index = current.findIndex((s) => {
    if (source.pid) return s["application.process.id"] === source.pid
    return s["application.name"] === source.name
  })

  if (index >= 0) {
    current.splice(index, 1)
  } else {
    current.push(criteriaFor(source))
  }

  emit("update:selectedSources", current)
}
</script>
