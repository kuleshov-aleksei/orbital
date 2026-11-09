<template>
  <div>
    <div
      class="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border rounded focus-within:border-theme-accent">
      <span
        v-for="alias in aliases"
        :key="alias"
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-theme-bg-hover text-xs text-theme-text-primary">
        {{ alias }}
        <button
          type="button"
          class="text-theme-text-muted hover:text-theme-text-primary"
          :title="`Remove ${alias}`"
          @click="removeAlias(alias)">
          <PhX class="w-3 h-3" />
        </button>
      </span>
      <input
        v-if="aliases.length < max"
        v-model="draft"
        type="text"
        :maxlength="maxLength"
        :placeholder="aliases.length ? '' : placeholder"
        class="flex-1 min-w-[6rem] bg-transparent text-sm focus:outline-none text-theme-text-primary"
        @keydown="onKeydown"
        @blur="commit" />
    </div>
    <p class="mt-1 text-[11px] text-theme-text-muted">
      Press Enter or comma to add. Up to {{ max }}.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { PhX } from "@phosphor-icons/vue"

// Lowercase, de-duplicated search aliases (chips). Mirrors the backend
// NormalizeSoundAliases rules shared by soundboard clips and custom emojis.
const props = withDefaults(
  defineProps<{ max?: number; maxLength?: number; placeholder?: string }>(),
  { max: 10, maxLength: 32, placeholder: "" },
)
const aliases = defineModel<string[]>({ required: true })
const draft = ref("")

/** Adds the pending text as an alias. Call before submitting the form. */
function commit() {
  const value = draft.value.trim().toLowerCase()
  draft.value = ""
  if (!value || aliases.value.includes(value) || aliases.value.length >= props.max) return
  aliases.value = [...aliases.value, value]
}

function removeAlias(alias: string) {
  aliases.value = aliases.value.filter((a) => a !== alias)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault()
    commit()
  } else if (event.key === "Backspace" && draft.value === "" && aliases.value.length) {
    aliases.value = aliases.value.slice(0, -1)
  }
}

defineExpose({ commit })
</script>
