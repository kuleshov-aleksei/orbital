<template>
  <div class="thumbnail-stream relative aspect-video rounded-lg overflow-hidden">
    <video
      ref="videoElement"
      class="w-full h-full object-cover"
      autoplay
      playsinline
      muted
    />

    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
      <span class="text-white text-xs font-medium">{{ userNickname }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Props {
  userId: string
  userNickname: string
  stream: MediaStream | null
}

const props = defineProps<Props>()

const videoElement = ref<HTMLVideoElement | null>(null)

onMounted(() => {
  if (props.stream && videoElement.value) {
    videoElement.value.srcObject = props.stream
    videoElement.value.play().catch(error => {
      console.warn(`Thumbnail video play failed for user ${props.userId}:`, error)
    })
  }
})
</script>

<style scoped>
.thumbnail-stream {
  background-color: #1f2937;
}
</style>
