<template>
  <div ref="dropdownRef" class="relative">
    <!-- Trigger Button (inline segment) -->
    <button
      type="button"
      class="audio-caret h-10 w-6 rounded-r-lg flex items-center justify-center transition-colors cursor-pointer"
      :class="[
        props.muted
          ? 'bg-red-600 hover:bg-red-700 text-white'
          : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary',
        { 'text-theme-accent': isOpen && !props.muted },
      ]"
      title="Audio Settings"
      @click.stop="toggleDropdown">
      <PhCaretUp v-if="isOpen" class="w-4 h-4 pointer-events-none" />
      <PhCaretDown v-else class="w-4 h-4 pointer-events-none" />
    </button>

    <!-- Dropdown Panel -->
    <Transition>
      <div
        v-if="isOpen"
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg overflow-hidden z-50">
        <div class="p-3">
          <AudioQuickSettings variant="compact" />
        </div>
      </div>
    </Transition>

    <!-- Click outside to close -->
    <div v-if="isOpen" class="fixed inset-0 z-40" @click="closeDropdown" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, useTemplateRef } from "vue"
import { PhCaretUp, PhCaretDown } from "@phosphor-icons/vue"
import AudioQuickSettings from "@/components/AudioQuickSettings.vue"

interface Props {
  muted?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  muted: false,
})

const isOpen = ref(false)
const dropdownRef = useTemplateRef<HTMLElement>("dropdownRef")

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside)
})
</script>
