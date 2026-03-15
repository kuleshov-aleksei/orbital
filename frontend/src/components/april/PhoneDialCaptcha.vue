<template>
  <div class="text-center">
    <h2 class="text-2xl font-bold mb-2 text-red-500">Verify with Rotary Phone</h2>

    <p class="text-sm text-gray-400 mb-4">Enter the 6-digit code by rotating the dial</p>

    <div v-if="!isCompleted" class="flex flex-col items-center">
      <!-- Target code display -->
      <div class="mb-6 p-4 bg-gray-800 rounded-lg">
        <div class="text-xs text-gray-500 mb-1">Dial this number:</div>
        <div class="text-3xl font-mono tracking-widest text-green-400">{{ targetCode }}</div>
      </div>

      <!-- Current input display -->
      <div class="mb-4 p-3 bg-gray-900 rounded-lg min-w-[120px]">
        <div class="text-xs text-gray-500 mb-1">Your input:</div>
        <div class="text-2xl font-mono tracking-widest text-white">
          {{ enteredDigits.map((d) => (d !== null ? d : "_")).join(" ") }}
        </div>
      </div>

      <!-- Rotary Dial -->
      <div class="rotary-container relative w-64 h-64 mb-4">
        <!-- Outer ring -->
        <div
          class="rotary-ring absolute inset-0 rounded-full bg-gradient-to-b from-gray-700 to-gray-800 border-4 border-gray-600 shadow-lg">
          <!-- Fixed indicator at top -->
          <div class="indicator absolute -top-2 left-1/2 -translate-x-1/2 z-10">
            <div
              class="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[16px] border-t-red-500"></div>
          </div>
          <!-- Current number indicator -->
          <div
            class="current-number absolute -top-8 left-1/2 -translate-x-1/2 bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg shadow-lg z-10">
            {{ currentDialNumber }}
          </div>
          <!-- Rotating dial -->
          <div
            class="rotary w-full h-full relative rounded-full bg-gradient-to-b from-gray-600 to-gray-700"
            :style="{ transform: `rotate(${currentRotation}deg)` }"
            @mousedown="startDrag"
            @touchstart.prevent="startDrag">
            <!-- Center hole -->
            <div
              class="center-hole absolute w-20 h-20 bg-gray-800 rounded-full border-4 border-gray-700 flex items-center justify-center shadow-inner"
              style="left: calc(50% - 40px); top: calc(50% - 40px)">
              <div class="w-10 h-10 bg-gray-900 rounded-full"></div>
            </div>

            <!-- Dial holes -->
            <div class="dial-holes absolute inset-0 pointer-events-none">
              <div
                v-for="n in 10"
                :key="n"
                class="hole absolute w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center shadow-inner"
                :style="{
                  left: getHolePosition(n - 1).left,
                  top: getHolePosition(n - 1).top,
                }">
                <span class="text-sm font-bold text-gray-400">{{ n - 1 }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Reset button -->
      <button
        type="button"
        class="text-sm text-gray-500 hover:text-gray-400 underline"
        @click="resetInput">
        Clear Input
      </button>

      <!-- Error message -->
      <Transition name="fade">
        <div v-if="showError" class="mt-4 text-red-500 font-bold">Wrong number! Try again.</div>
      </Transition>
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
import { ref, watch, onMounted, computed } from "vue"
import { useAprilStore } from "@/stores/april"

const aprilStore = useAprilStore()

const targetCode = ref("")
const enteredDigits = ref<(number | null)[]>([null, null, null, null, null, null])
const currentDigitIndex = ref(0)
const currentRotation = ref(0)
const showError = ref(false)
const isDragging = ref(false)
const lastAngle = ref(0)
const isCompleted = ref(false)

function rotationToNumber(rotation: number): number {
  const r = ((rotation % 360) + 360) % 360
  console.log(r)
  if (r >= 340 || r < 18) return 0
  if (r >= 18 && r < 52) return 9
  if (r >= 52 && r < 91) return 8
  if (r >= 91 && r < 127) return 7
  if (r >= 127 && r < 161) return 6
  if (r >= 161 && r < 199) return 5
  if (r >= 199 && r < 234) return 4
  if (r >= 234 && r < 270) return 3
  if (r >= 270 && r < 303) return 2
  if (r >= 303 && r < 340) return 1
  return 1
}

const currentDialNumber = computed(() => {
  return rotationToNumber(currentRotation.value)
})

function getHolePosition(index: number): { left: string; top: string } {
  const angle = index * 36 * (Math.PI / 180)
  const x = Math.sin(angle) * 80
  const y = -Math.cos(angle) * 80
  return {
    left: `calc(50% + ${x}px - 1.25rem)`,
    top: `calc(50% + ${y}px - 1.25rem)`,
  }
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function initCaptcha() {
  targetCode.value = generateCode()
  resetInput()
  showError.value = false
}

function resetInput() {
  enteredDigits.value = [null, null, null, null, null, null]
  currentDigitIndex.value = 0
  currentRotation.value = 0
}

function selectNumber(num: number) {
  if (isCompleted.value) return
  if (currentDigitIndex.value >= 6) return

  enteredDigits.value[currentDigitIndex.value] = num
  currentDigitIndex.value++

  // Check if 6 digits entered
  if (currentDigitIndex.value === 6) {
    validateInput()
  }
}

function validateInput() {
  const input = enteredDigits.value.map((d) => d?.toString() ?? "").join("")

  if (input === targetCode.value) {
    isCompleted.value = true
    aprilStore.completeCaptcha()
  } else {
    showError.value = true
    setTimeout(() => {
      targetCode.value = generateCode()
      resetInput()
      showError.value = false
    }, 1500)
  }
}

function getAngle(x: number, y: number): number {
  const rotaryEl = document.querySelector(".rotary-container")
  if (!rotaryEl) return 0

  const rect = rotaryEl.getBoundingClientRect()

  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  const deltaX = x - centerX
  const deltaY = y - centerY

  let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI)
  angle = angle + 90 // Adjust for starting position
  if (angle < 0) angle += 360

  //console.log(angle)
  return angle
}

function startDrag(event: MouseEvent | TouchEvent) {
  if (isCompleted.value) return

  isDragging.value = true
  const clientX = "touches" in event ? event.touches[0].clientX : event.clientX
  const clientY = "touches" in event ? event.touches[0].clientY : event.clientY

  const startAngle = getAngle(clientX, clientY)
  lastAngle.value = startAngle

  document.addEventListener("mousemove", onDrag)
  document.addEventListener("mouseup", stopDrag)
  document.addEventListener("touchmove", onDrag)
  document.addEventListener("touchend", stopDrag)
}

function onDrag(event: MouseEvent | TouchEvent) {
  if (!isDragging.value) return

  const clientX = "touches" in event ? event.touches[0].clientX : event.clientX
  const clientY = "touches" in event ? event.touches[0].clientY : event.clientY

  let currentAngle = getAngle(clientX, clientY)
  let prevAngle = lastAngle.value

  let delta = currentAngle - prevAngle
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360

  // Only allow clockwise rotation (positive delta), except wrap-around
  if (delta < 0 && delta > -180) return

  const newRotation = currentRotation.value + delta
  currentRotation.value = newRotation
  lastAngle.value = currentAngle
}

function stopDrag() {
  if (!isDragging.value) return

  isDragging.value = false

  document.removeEventListener("mousemove", onDrag)
  document.removeEventListener("mouseup", stopDrag)
  document.removeEventListener("touchmove", onDrag)
  document.removeEventListener("touchend", stopDrag)

  const rotation = currentRotation.value

  // Only register if rotated at least 5 degrees
  if (Math.abs(rotation) < 5) {
    currentRotation.value = 0
    return
  }

  const selectedNum = rotationToNumber(rotation)

  if (currentDigitIndex.value < 6) {
    selectNumber(selectedNum)
  }

  // Animate back to start
  setTimeout(() => {
    currentRotation.value = 0
  }, 200)
}

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

onMounted(() => {
  initCaptcha()
})

// Reinitialize when captcha becomes active
watch(
  () => aprilStore.isCaptchaActive,
  (active) => {
    if (active) {
      isCompleted.value = false
      initCaptcha()
    }
  },
)
</script>

<style scoped>
.rotary-container {
  perspective: 1000px;
}

.rotary-ring {
  transform: rotate(0deg);
}

.rotary {
  transition: transform 0.05s ease-out;
  user-select: none;
  transform-origin: center;
}

.rotary.numbers {
  animation: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
