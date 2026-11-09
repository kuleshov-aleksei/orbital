<template>
  <div
    class="flex rounded overflow-hidden border border-gray-600 flex-shrink-0"
    role="radiogroup"
    :aria-label="label">
    <button
      v-for="state in visibleStates"
      :key="state.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === state.value"
      :title="state.title"
      :data-testid="`${testidPrefix}-${state.value}`"
      class="w-9 h-8 text-sm font-semibold transition-colors"
      :class="
        modelValue === state.value
          ? state.activeClass
          : 'bg-gray-900 text-gray-500 hover:bg-gray-700'
      "
      :disabled="disabled"
      @click="$emit('update:modelValue', state.value)">
      {{ state.symbol }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"

export type TriState = "deny" | "inherit" | "allow"

interface Props {
  modelValue: TriState
  label: string
  testidPrefix: string
  disabled?: boolean
  /** Hide "inherit" (used by @everyone, which has nothing below it to inherit from). */
  twoState?: boolean
}

const props = withDefaults(defineProps<Props>(), { disabled: false, twoState: false })
defineEmits<{ "update:modelValue": [value: TriState] }>()

const states: Array<{ value: TriState; symbol: string; title: string; activeClass: string }> = [
  { value: "deny", symbol: "✕", title: "Deny", activeClass: "bg-red-600 text-white" },
  { value: "inherit", symbol: "/", title: "Inherit", activeClass: "bg-gray-600 text-white" },
  { value: "allow", symbol: "✓", title: "Allow", activeClass: "bg-green-600 text-white" },
]

const visibleStates = computed(() =>
  props.twoState ? states.filter((s) => s.value !== "inherit") : states,
)
</script>
