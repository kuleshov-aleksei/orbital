<template>
  <div
    class="spider-container fixed z-[100] pointer-events-auto"
    :style="containerStyle"
    @click="handleSpiderClick">
    <img
      :src="imageSrc"
      :class="{ 'animate-none': isPaused }"
      class="w-12 h-12 cursor-pointer select-none"
      draggable="false"
      :style="{ transform: `rotate(${rotation}deg)` }" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue"

defineOptions({
  name: "AprilSpider",
})

const SPIDER_GIF = "/assets/images/airian-cong-spider-animation-2.gif"
const SPIDER_STATIC = "/assets/images/airian-cong-spider-animation-2-static.png"
const imageSrc = ref(SPIDER_GIF)

type SpiderState = "waiting" | "appearing" | "crawling" | "paused" | "running"

const spiderState = ref<SpiderState>("waiting")
const position = ref({ x: 0, y: 0 })
const isVisible = ref(false)
const isPaused = ref(false)
const rotation = ref(0)
const prevPosition = ref({ x: 0, y: 0 })

let stateTimeout: ReturnType<typeof setTimeout> | null = null

const containerStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  opacity: spiderState.value === "waiting" ? "0" : "1",
  transition:
    spiderState.value === "crawling"
      ? `left ${crawlDuration.value}ms ease-in-out, top ${crawlDuration.value}ms ease-in-out, opacity 0.5s ease-in-out`
      : spiderState.value === "running"
        ? "opacity 0.3s ease-out, left 0.3s ease-out, top 0.3s ease-out"
        : "opacity 0.5s ease-in, left 0.5s ease-in-out, top 0.5s ease-in-out",
}))

const crawlDuration = ref(15000)

function getRandomWaitTime(): number {
  return Math.floor(Math.random() * 10000) + 10000
}

function getRandomCrawlTime(): number {
  return Math.floor(Math.random() * 10000) + 10000
}

function getRandomEdgePosition(): { x: number; y: number } {
  const edge = Math.floor(Math.random() * 4)
  const margin = 60

  switch (edge) {
    case 0:
      return { x: -margin, y: Math.random() * window.innerHeight }
    case 1:
      return { x: window.innerWidth + margin, y: Math.random() * window.innerHeight }
    case 2:
      return { x: Math.random() * window.innerWidth, y: -margin }
    case 3:
    default:
      return { x: Math.random() * window.innerWidth, y: window.innerHeight + margin }
  }
}

function getRandomScreenPosition(): { x: number; y: number } {
  const margin = 80
  const maxX = window.innerWidth - margin
  const maxY = window.innerHeight - margin

  return {
    x: Math.random() * maxX + margin / 2,
    y: Math.random() * maxY + margin / 2,
  }
}

function getEscapePosition(): { x: number; y: number } {
  const edge = Math.floor(Math.random() * 4)
  const margin = 60

  switch (edge) {
    case 0:
      return { x: -margin * 2, y: -margin * 2 }
    case 1:
      return { x: window.innerWidth + margin * 2, y: -margin * 2 }
    case 2:
      return { x: -margin * 2, y: window.innerHeight + margin * 2 }
    case 3:
    default:
      return { x: window.innerWidth + margin * 2, y: window.innerHeight + margin * 2 }
  }
}

function updateRotation(newX: number, newY: number): void {
  const dx = newX - prevPosition.value.x
  const dy = newY - prevPosition.value.y
  if (dx !== 0 || dy !== 0) {
    rotation.value = Math.atan2(dy, dx) * (180 / Math.PI) + 270
  }
  prevPosition.value = { x: newX, y: newY }
}

function setNextState(state: SpiderState, delay: number, callback?: () => void): void {
  if (stateTimeout) {
    clearTimeout(stateTimeout)
  }
  stateTimeout = setTimeout(() => {
    if (callback) {
      callback()
    }
    spiderState.value = state
  }, delay)
}

function startWaiting(): void {
  spiderState.value = "waiting"
  isVisible.value = false
  isPaused.value = false
  setNextState("appearing", getRandomWaitTime(), startAppearing)
}

function startAppearing(): void {
  spiderState.value = "appearing"
  isVisible.value = true
  isPaused.value = false
  imageSrc.value = SPIDER_GIF
  position.value = { x: 0, y: 0 }

  void nextTick(() => {
    const newPos = getRandomEdgePosition()
    updateRotation(newPos.x, newPos.y)
    position.value = newPos
    setNextState("crawling", 500, startCrawling)
  })
}

function startCrawling(): void {
  spiderState.value = "crawling"
  isPaused.value = false
  imageSrc.value = SPIDER_GIF
  crawlDuration.value = getRandomCrawlTime()

  void nextTick(() => {
    const newPos = getRandomScreenPosition()
    updateRotation(newPos.x, newPos.y)
    position.value = newPos
    setNextState("paused", crawlDuration.value, startPaused)
  })
}

function startPaused(): void {
  spiderState.value = "paused"
  isPaused.value = true
  imageSrc.value = SPIDER_STATIC

  setNextState("crawling", 5000, startCrawling)
}

function handleSpiderClick(): void {
  if (stateTimeout) {
    clearTimeout(stateTimeout)
  }

  spiderState.value = "running"
  isPaused.value = false
  const newPos = getEscapePosition()
  updateRotation(newPos.x, newPos.y)
  position.value = newPos

  setNextState("waiting", 500, startWaiting)
}

function handleResize(): void {
  if (spiderState.value === "crawling" || spiderState.value === "paused") {
    position.value = getRandomScreenPosition()
  }
}

onMounted(() => {
  window.addEventListener("resize", handleResize)
  startWaiting()
})

onUnmounted(() => {
  window.removeEventListener("resize", handleResize)
  if (stateTimeout) {
    clearTimeout(stateTimeout)
  }
})

void startAppearing
void startPaused
void getRandomEdgePosition
</script>
