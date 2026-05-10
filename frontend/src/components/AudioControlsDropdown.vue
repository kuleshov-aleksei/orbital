<template>
  <div class="relative w-full h-full" ref="dropdownRef">
    <!-- Trigger Button -->
    <button
      @click.stop="toggleDropdown"
      type="button"
      class="absolute -top-2 -right-2 w-6 h-6 rounded flex items-center justify-center bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary transition-colors z-20 cursor-pointer"
      :class="{ 'ring-2 ring-theme-accent': isOpen }"
      title="Audio Settings">
      <PhCaretDown v-if="isOpen" class="w-3 h-3 pointer-events-none" />
      <PhCaretUp v-else class="w-3 h-3 pointer-events-none" />
    </button>

    <!-- Dropdown Panel -->
    <Transition>
      <div
        v-if="isOpen"
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg overflow-hidden z-50">
        <div class="p-3 space-y-3">
          <!-- Input Device (compact) -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">
              Input
            </label>
            <select
              v-model="selectedInputDevice"
              class="w-full bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1.5 text-xs text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-theme-accent"
              @change="onInputDeviceChange">
              <option value="">Default</option>
              <option
                v-for="device in filteredInputDevices"
                :key="device.deviceId"
                :value="device.deviceId">
                {{ truncateLabel(device.label) }}
              </option>
            </select>
          </div>

          <!-- Toggles -->
          <div class="space-y-2 pt-2 border-t border-theme-border">
            <!-- Noise Suppression -->
            <div class="flex items-center justify-between">
              <span class="text-xs text-theme-text-secondary">Noise Suppression</span>
              <button
                type="button"
                class="relative inline-flex h-5 w-8 items-center rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-theme-accent"
                :class="noiseSuppressionEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
                @click="toggleNoiseSuppression">
                <span
                  class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                  :class="noiseSuppressionEnabled ? 'translate-x-4' : 'translate-x-1'" />
              </button>
            </div>

            <!-- Echo Cancellation -->
            <div class="flex items-center justify-between">
              <span class="text-xs text-theme-text-secondary">Echo Cancellation</span>
              <button
                type="button"
                class="relative inline-flex h-5 w-8 items-center rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-theme-accent"
                :class="echoCancellationEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
                @click="toggleEchoCancellation">
                <span
                  class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                  :class="echoCancellationEnabled ? 'translate-x-4' : 'translate-x-1'" />
              </button>
            </div>

            <!-- Auto Gain -->
            <div class="flex items-center justify-between">
              <span class="text-xs text-theme-text-secondary">Auto Gain</span>
              <button
                type="button"
                class="relative inline-flex h-5 w-8 items-center rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-theme-accent"
                :class="autoGainControlEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
                @click="toggleAutoGainControl">
                <span
                  class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                  :class="autoGainControlEnabled ? 'translate-x-4' : 'translate-x-1'" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Click outside to close -->
    <div
      v-if="isOpen"
      class="fixed inset-0 z-40"
      @click="closeDropdown" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, useTemplateRef } from "vue"
import { PhCaretUp, PhCaretDown } from "@phosphor-icons/vue"
import { useAudioSettingsStore } from "@/stores"

const audioStore = useAudioSettingsStore()
const isOpen = ref(false)
const dropdownRef = useTemplateRef<HTMLElement>("dropdownRef")

const selectedInputDevice = ref<string>("")
const availableInputDevices = ref<{ deviceId: string; label: string }[]>([])

const noiseSuppressionEnabled = computed(() => audioStore.noiseSuppressionEnabled)
const echoCancellationEnabled = computed(() => audioStore.echoCancellationEnabled)
const autoGainControlEnabled = computed(() => audioStore.autoGainControlEnabled)

const filteredInputDevices = computed(() => {
  return availableInputDevices.value.filter((d) => !d.label.toLowerCase().startsWith("monitor"))
})

function truncateLabel(label: string): string {
  return label.length > 25 ? label.slice(0, 22) + "..." : label
}

async function loadInputDevices() {
  const devices = await audioStore.requestPermissionsAndEnumerate()
  availableInputDevices.value = devices
}

function onInputDeviceChange() {
  audioStore.setInputDeviceId(selectedInputDevice.value || null)
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}

function toggleNoiseSuppression() {
  audioStore.toggleNoiseSuppression(!noiseSuppressionEnabled.value)
}

function toggleEchoCancellation() {
  audioStore.toggleEchoCancellation(!echoCancellationEnabled.value)
}

function toggleAutoGainControl() {
  audioStore.toggleAutoGainControl(!autoGainControlEnabled.value)
}

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

onMounted(async () => {
  audioStore.loadSettings()
  selectedInputDevice.value = audioStore.inputDeviceId || ""
  await loadInputDevices()
  document.addEventListener("click", handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside)
})
</script>
