<template>
  <img
    :src="src"
    :alt="alt || badge.name"
    :title="title"
    :style="{ width: `${size}px`, height: `${size}px` }"
    class="object-contain select-none"
    draggable="false"
    loading="lazy"
    decoding="async"
    @error="onError" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { Badge } from "@/stores/badges"

// A badge image. In the apps the URL is the on-device cache; if that can't be
// served (an older shell that doesn't know `_badge`, or an evicted file) fall
// back to the plain backend URL instead of showing a broken image.
const props = defineProps<{
  badge: Badge
  size: number
  title?: string
  alt?: string
}>()

const failed = ref(false)
watch(
  () => props.badge.imageUrl,
  () => {
    failed.value = false
  },
)

const src = computed(() => (failed.value ? props.badge.sourceUrl : props.badge.imageUrl))

function onError() {
  if (!failed.value && props.badge.imageUrl !== props.badge.sourceUrl) {
    failed.value = true
  }
}
</script>
