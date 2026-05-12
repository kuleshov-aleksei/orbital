<template>
  <div class="flex items-center gap-3">
    <button
      type="button"
      class="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
      :class="enabled ? 'bg-theme-accent' : 'bg-theme-bg-hover'"
      :disabled="!canCapture"
      @click="toggleEnabled">
      <span
        class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
        :class="enabled ? 'translate-x-6' : 'translate-x-1'" />
    </button>

    <button
      ref="captureButton"
      type="button"
      class="flex-1 min-w-[120px] px-3 py-2 rounded-md border transition-colors text-left text-sm"
      :class="[
        isCapturing
          ? 'border-theme-accent bg-theme-accent/10 text-theme-accent'
          : enabled
            ? 'border-theme-border bg-theme-bg-secondary text-theme-text-primary hover:border-theme-text-muted'
            : 'border-theme-border bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed',
      ]"
      :disabled="!enabled || !canCapture"
      @click="startCapture">
      <span v-if="isCapturing">Press keys...</span>
      <span v-else-if="!enabled">Disabled</span>
      <span v-else-if="accelerator">{{ formatAccelerator(accelerator) }}</span>
      <span v-else class="text-theme-text-muted">Click to set</span>
    </button>

    <div class="w-4">
      <button
        v-if="showReset"
        type="button"
        class="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-md hover:bg-theme-bg-hover transition-colors"
        title="Reset to default"
        @click="resetToDefault">
        <PhArrowCounterClockwise class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue"
import { PhArrowCounterClockwise } from "@phosphor-icons/vue"

const props = defineProps<{
  enabled: boolean
  accelerator: string
  canCapture: boolean
  showReset: boolean
}>()

const emit = defineEmits<{
  (e: "update:enabled", value: boolean): void
  (e: "update:accelerator", value: string): void
  (e: "reset"): void
}>()

const captureButton = ref<HTMLButtonElement | null>(null)
const isCapturing = ref(false)
const pendingKeys = ref<string[]>([])
const heldKeys = ref<Set<string>>(new Set())

const MODIFIER_KEYS = [
  "Control",
  "ControlLeft",
  "ControlRight",
  "Shift",
  "ShiftLeft",
  "ShiftRight",
  "Alt",
  "AltLeft",
  "AltRight",
  "Meta",
  "MetaLeft",
  "MetaRight",
  "CommandOrControl",
  "Command",
  "CommandLeft",
  "CommandRight",
]

function formatAccelerator(acc: string): string {
  return acc
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/Command/gi, "Cmd")
    .replace(/Meta/gi, "Win")
    .replace(/Arrow/g, "")
    .split("+")
    .map((k) => k.trim())
    .filter((k) => k)
    .join(" + ")
}

function toggleEnabled() {
  emit("update:enabled", !props.enabled)
}

function startCapture() {
  if (!props.enabled || !props.canCapture) return
  isCapturing.value = true
  pendingKeys.value = []
  heldKeys.value = new Set()

  document.addEventListener("keydown", handleKeyDown)
  document.addEventListener("keyup", handleKeyUp)

  setTimeout(() => {
    captureButton.value?.focus()
  }, 10)
}

function stopCapture() {
  document.removeEventListener("keydown", handleKeyDown)
  document.removeEventListener("keyup", handleKeyUp)
  isCapturing.value = false
  pendingKeys.value = []
  heldKeys.value = new Set()
}

function handleKeyDown(e: KeyboardEvent) {
  if (!isCapturing.value) return

  if (e.code === "Escape") {
    e.preventDefault()
    stopCapture()
    return
  }

  e.preventDefault()
  e.stopPropagation()

  heldKeys.value.add(e.code)
}

function handleKeyUp(e: KeyboardEvent) {
  if (!isCapturing.value) return
  e.preventDefault()
  e.stopPropagation()

  const modifiers = Array.from(heldKeys.value).filter((k) => MODIFIER_KEYS.includes(k))
  const regularKeys = Array.from(heldKeys.value).filter((k) => !MODIFIER_KEYS.includes(k))

  if (modifiers.length > 0 && regularKeys.length > 0) {
    const accelerator = [...modifiers, regularKeys[0]]
      .map((k) => {
        if (k.startsWith("Control")) return "CommandOrControl"
        if (k.startsWith("Shift")) return "Shift"
        if (k.startsWith("Alt")) return "Alt"
        if (k.startsWith("Meta")) return "Meta"
        return k.replace(/^Key/, "")
      })
      .join("+")

    emit("update:accelerator", accelerator)
  }

  heldKeys.value.delete(e.code)

  if (heldKeys.value.size === 0) {
    stopCapture()
  }
}

function resetToDefault() {
  emit("reset")
}

watch(
  () => props.enabled,
  (newVal) => {
    if (!newVal) {
      isCapturing.value = false
    }
  },
)

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeyDown)
  document.removeEventListener("keyup", handleKeyUp)
})
</script>
