<template>
  <!-- "Add reaction": a smiley with a plus badge (Phosphor has no such icon). -->
  <span class="relative inline-flex" aria-hidden="true">
    <PhSmiley :size="size" />
    <span
      class="absolute -right-[3px] -bottom-[3px] flex items-center justify-center rounded-full bg-current"
      :style="{ width: `${badge}px`, height: `${badge}px` }">
      <PhPlus :size="badge - 3" weight="bold" class="text-theme-bg-tertiary" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhPlus, PhSmiley } from "@phosphor-icons/vue"

const props = withDefaults(defineProps<{ size?: number }>(), { size: 16 })

const badge = computed(() => Math.max(8, Math.round(props.size * 0.55)))
</script>
