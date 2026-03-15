<template>
  <div class="text-center">
    <h2 class="text-2xl font-bold mb-2 text-red-500">Verify Image</h2>

    <p class="text-sm text-gray-400 mb-4">
      Click each piece to rotate it to the correct orientation
    </p>

    <div v-if="!isCompleted" class="flex flex-col items-center">
      <!-- Loading -->
      <div v-if="isLoading" class="mb-4 text-gray-400">Loading puzzle...</div>

      <!-- Puzzle Grid -->
      <div class="grid grid-cols-3 gap-1 bg-gray-700 p-1 rounded-lg mb-4">
        <div
          v-for="(piece, index) in pieces"
          :key="index"
          class="w-24 h-24 cursor-pointer transition-transform duration-200 hover:ring-2 hover:ring-red-400 rounded overflow-hidden"
          :style="{ transform: `rotate(${piece.totalRotation}deg)` }"
          @click="rotatePiece(index)">
          <img
            :src="piece.imageData"
            class="w-full h-full object-cover pointer-events-none select-none" />
        </div>
      </div>

      <!-- Robot detection message -->
      <div v-if="showRobotMessage" class="mb-4 text-red-400 font-bold animate-pulse">
        ROBOT DETECTED! Solving too fast. Try again.
      </div>

      <!-- Verify button -->
      <button
        type="button"
        class="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="isLoading"
        @click="checkSolution">
        Verify
      </button>
    </div>

    <!-- Completion checkmark -->
    <Transition name="fade">
      <div v-if="isCompleted" class="py-8">
        <svg
          class="w-16 h-16 text-green-500 mx-auto mb-4 animate-bounce"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="3"
            d="M5 13l4 4L19 7" />
        </svg>
        <p class="text-green-400 font-bold">Verification Complete!</p>
      </div>
    </Transition>

    <div class="text-sm text-gray-400 mt-2">
      {{ getTypeLabel() }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue"
import { useAprilStore } from "@/stores/april"

interface PuzzlePiece {
  imageData: string
  rotation: number
  totalRotation: number
}

const aprilStore = useAprilStore()

const IMAGE_PATHS = [
  "/assets/images/rotating-captcha-01.webp",
  "/assets/images/rotating-captcha-02.webp",
  "/assets/images/rotating-captcha-03.webp",
]
const GRID_SIZE = 3

let currentImagePath = ""

function getRandomImagePath(): string {
  return IMAGE_PATHS[Math.floor(Math.random() * IMAGE_PATHS.length)]
}

const pieces = ref<PuzzlePiece[]>([])
const isCompleted = ref(false)
const showRobotMessage = ref(false)
const isLoading = ref(true)

function getTypeLabel(): string {
  switch (aprilStore.currentType) {
    case "join":
      return "Join attempt blocked"
    case "theme":
      return "Theme change intercepted"
    case "settings":
      return "Settings access denied"
    case "mute":
      return "Mute action stopped"
    case "leave":
      return "Leave prevented"
    case "volume":
      return "Volume adjustment halted"
    case "video":
      return "Camera sharing blocked"
    case "screenshare":
      return "Screensharing blocked"
    default:
      return "Captcha required"
  }
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const milliseconds = Math.floor((ms % 1000) / 10)
  return `${seconds}.${milliseconds.toString().padStart(2, "0")}s`
}

async function loadAndSplitImage() {
  const response = await fetch(currentImagePath)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`)
  }
  const blob = await response.blob()

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Failed to load image"))
    img.src = URL.createObjectURL(blob)
  })
}

function getRandomRotation(): number {
  const rotations = [0, 90, 180, 270]
  return rotations[Math.floor(Math.random() * rotations.length)]
}

async function initPuzzle() {
  isLoading.value = true
  currentImagePath = getRandomImagePath()
  let objectUrl: string | null = null
  try {
    const img = await loadAndSplitImage()
    objectUrl = img.src

    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const pieceWidth = img.width / GRID_SIZE
    const pieceHeight = img.height / GRID_SIZE

    const newPieces: PuzzlePiece[] = []

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const pieceCanvas = document.createElement("canvas")
        pieceCanvas.width = pieceWidth
        pieceCanvas.height = pieceHeight
        const pieceCtx = pieceCanvas.getContext("2d")
        if (!pieceCtx) continue

        pieceCtx.drawImage(
          img,
          col * pieceWidth,
          row * pieceHeight,
          pieceWidth,
          pieceHeight,
          0,
          0,
          pieceWidth,
          pieceHeight,
        )

        let rotation = getRandomRotation()
        while (rotation === 0) {
          rotation = getRandomRotation()
        }

        newPieces.push({
          imageData: pieceCanvas.toDataURL("image/webp"),
          rotation: rotation,
          totalRotation: rotation,
        })
      }
    }

    pieces.value = newPieces
    isLoading.value = false

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  } catch (error) {
    console.error("Failed to load image:", error)
    isLoading.value = false
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

function rotatePiece(index: number) {
  if (isCompleted.value) return

  pieces.value[index].totalRotation += 90
  pieces.value[index].rotation = (pieces.value[index].rotation + 90) % 360
}

function checkSolution() {
  if (pieces.value.length === 0) return

  const allCorrect = pieces.value.every((piece) => piece.rotation === 0)

  if (allCorrect) {
    isCompleted.value = true
    setTimeout(() => {
      aprilStore.completeCaptcha()
    }, 500)
  }
}

watch(
  () => aprilStore.isCaptchaActive,
  (active) => {
    if (active) {
      isCompleted.value = false
      showRobotMessage.value = false
      isLoading.value = true
      initPuzzle()
    }
  },
)

onMounted(() => {
  if (aprilStore.isCaptchaActive && pieces.value.length === 0) {
    initPuzzle()
  }
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
