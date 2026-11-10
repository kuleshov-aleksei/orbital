<template>
  <span
    class="spoiler rounded px-0.5 transition-colors"
    :class="revealed ? 'bg-theme-bg-hover' : 'spoiler-hidden cursor-pointer bg-theme-text-muted'"
    :role="revealed ? undefined : 'button'"
    :tabindex="revealed ? undefined : 0"
    :aria-label="revealed ? undefined : 'Spoiler, press to reveal'"
    data-testid="message-spoiler"
    @click.stop="revealed = true"
    @keydown.enter.prevent.stop="revealed = true"
    @keydown.space.prevent.stop="revealed = true">
    <span :class="{ 'invisible select-none': !revealed }" :aria-hidden="!revealed"><slot /></span>
  </span>
</template>

<script setup lang="ts">
import { ref } from "vue"

// ||spoiler||: hidden until clicked (or Enter/Space for keyboard users).
const revealed = ref(false)
</script>
