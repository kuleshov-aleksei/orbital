<template>
  <div :class="sheet ? 'space-y-1' : 'space-y-3'">
    <!-- Input device -->
    <div :class="sheet ? 'px-4 pt-3 pb-2' : ''">
      <label
        :for="selectId"
        class="font-medium text-theme-text-secondary block"
        :class="sheet ? 'text-sm mb-2' : 'text-xs mb-1.5'">
        Input device
      </label>
      <select
        :id="selectId"
        v-model="selectedInputDevice"
        class="w-full bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-theme-accent"
        :class="
          sheet ? 'h-11 px-3 text-sm rounded-lg bg-theme-bg-secondary' : 'px-2 py-1.5 text-xs'
        "
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

    <!-- Processing toggles -->
    <div :class="sheet ? '' : 'space-y-2 pt-2 border-t border-theme-border'">
      <div
        v-for="toggle in toggles"
        :key="toggle.label"
        class="flex items-center justify-between"
        :class="sheet ? 'min-h-14 px-4 py-2 gap-4 border-t border-theme-border/60' : ''">
        <div class="min-w-0">
          <div
            :class="
              sheet ? 'text-sm text-theme-text-primary' : 'text-xs text-theme-text-secondary'
            ">
            {{ toggle.label }}
          </div>
          <div v-if="sheet" class="text-xs text-theme-text-muted">{{ toggle.hint }}</div>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="toggle.enabled"
          :aria-label="toggle.label"
          class="relative inline-flex shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-theme-accent"
          :class="[
            sheet ? 'h-7 w-12' : 'h-5 w-8',
            toggle.enabled
              ? 'bg-theme-accent'
              : sheet
                ? 'bg-theme-bg-secondary'
                : 'bg-theme-bg-tertiary',
          ]"
          @click="toggle.onToggle">
          <span
            class="inline-block transform rounded-full bg-white transition-transform"
            :class="
              sheet
                ? ['h-5 w-5', toggle.enabled ? 'translate-x-6' : 'translate-x-1']
                : ['h-3.5 w-3.5', toggle.enabled ? 'translate-x-4' : 'translate-x-1']
            " />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue"
import { useAudioSettingsStore } from "@/stores"

interface Props {
  /** "compact": desktop dropdown sizing. "sheet": 44px+ touch rows for the mobile call sheet. */
  variant?: "compact" | "sheet"
}

const props = withDefaults(defineProps<Props>(), {
  variant: "compact",
})

const sheet = computed(() => props.variant === "sheet")
const selectId = useId()

const audioStore = useAudioSettingsStore()

const selectedInputDevice = ref<string>("")
const availableInputDevices = ref<{ deviceId: string; label: string }[]>([])

const filteredInputDevices = computed(() =>
  availableInputDevices.value.filter((d) => !d.label.toLowerCase().startsWith("monitor")),
)

const toggles = computed(() => [
  {
    label: "Noise Suppression",
    hint: "Suppress background noise from your mic",
    enabled: audioStore.noiseSuppressionEnabled,
    onToggle: () => audioStore.toggleNoiseSuppression(!audioStore.noiseSuppressionEnabled),
  },
  {
    label: "Echo Cancellation",
    hint: "Stop others hearing themselves through your speaker",
    enabled: audioStore.echoCancellationEnabled,
    onToggle: () => audioStore.toggleEchoCancellation(!audioStore.echoCancellationEnabled),
  },
  {
    label: "Auto Gain",
    hint: "Keep your voice at a steady volume",
    enabled: audioStore.autoGainControlEnabled,
    onToggle: () => audioStore.toggleAutoGainControl(!audioStore.autoGainControlEnabled),
  },
])

function truncateLabel(label: string): string {
  const max = sheet.value ? 40 : 25
  return label.length > max ? label.slice(0, max - 3) + "..." : label
}

function onInputDeviceChange() {
  audioStore.setInputDeviceId(selectedInputDevice.value || null)
}

onMounted(async () => {
  audioStore.loadSettings()
  selectedInputDevice.value = audioStore.inputDeviceId || ""
  availableInputDevices.value = await audioStore.requestPermissionsAndEnumerate()
})
</script>
