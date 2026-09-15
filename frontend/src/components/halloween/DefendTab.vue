<template>
  <div class="flex flex-col items-center text-center gap-3 py-6">
    <PumpkinSprite :equipped="halloweenStore.equipped" :size="128" />
    <p class="text-sm text-theme-text-secondary max-w-xs">
      Slugs are on the move. Defend your pumpkin in a frantic tower-defense battle.
    </p>
    <button
      type="button"
      class="mt-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold transition-colors"
      data-testid="defend-pumpkin-button"
      @click="$emit('play')">
      Defend Pumpkin
    </button>
    <span class="text-xs text-theme-text-muted">The battle begins here (coming soon)</span>
  </div>
</template>

<script setup lang="ts">
import PumpkinSprite from "./PumpkinSprite.vue"
import { useHalloweenStore } from "@/stores"

defineEmits<{
  play: []
}>()

const halloweenStore = useHalloweenStore()
</script>
