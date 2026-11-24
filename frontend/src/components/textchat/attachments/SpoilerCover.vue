<template>
  <!-- Sits over a blurred image/video. Interactive: any activation reveals it;
       otherwise the parent (e.g. a tile that is already a button) handles it. -->
  <div
    class="absolute inset-0 z-10 flex items-center justify-center bg-black/30 transition-colors"
    :class="
      interactive
        ? 'cursor-pointer hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-accent'
        : 'pointer-events-none'
    "
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined"
    :aria-label="interactive ? 'Spoiler, press to reveal' : undefined"
    data-testid="attachment-spoiler"
    @click.stop.prevent="interactive && $emit('reveal')"
    @keydown.enter.prevent.stop="interactive && $emit('reveal')"
    @keydown.space.prevent.stop="interactive && $emit('reveal')">
    <span
      class="px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-bold tracking-wider select-none">
      SPOILER
    </span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ interactive?: boolean }>(), { interactive: true })
defineEmits<{ reveal: [] }>()
</script>
