<template>
  <label class="flex items-start gap-2.5 text-sm text-theme-text-muted cursor-pointer text-left">
    <input
      v-model="accepted"
      type="checkbox"
      required
      :data-testid="testid"
      class="mt-0.5 w-4 h-4 flex-shrink-0 accent-theme-accent cursor-pointer" />
    <span>
      I am at least {{ LEGAL.minimumAge }} and agree to the
      <button
        type="button"
        :data-testid="`${testid}-terms`"
        class="text-theme-accent hover:text-theme-accent-hover font-medium"
        @click.prevent="emit('open', 'terms')">
        Terms of Service
      </button>
      and
      <button
        type="button"
        :data-testid="`${testid}-privacy`"
        class="text-theme-accent hover:text-theme-accent-hover font-medium"
        @click.prevent="emit('open', 'privacy')">
        Privacy Policy</button
      >.
    </span>
  </label>
</template>

<script setup lang="ts">
import { LEGAL } from "./legalInfo"
import type { LegalDocId } from "./legal"

withDefaults(defineProps<{ testid?: string }>(), { testid: "accept-terms" })

const emit = defineEmits<{ open: [doc: LegalDocId] }>()

// Unchecked by default: consent must be an explicit action.
const accepted = defineModel<boolean>({ required: true })
</script>
