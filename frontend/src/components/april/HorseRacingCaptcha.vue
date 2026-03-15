<template>
  <div class="text-center min-h-[75svh] overflow-hidden">
    <h2 class="text-2xl font-bold mb-2 text-red-500">Pick the Winning Horse!</h2>

    <p class="text-sm text-gray-400 mb-4">Select a horse to win the race</p>

    <!-- Race Track -->
    <div v-if="!isCompleted" class="mb-6">
      <!-- Horse Selection Buttons -->
      <div class="flex justify-center gap-3 mb-6">
        <button
          v-for="(horse, index) in horses"
          :key="index"
          :disabled="isRacing || selectedHorseIndex !== -1"
          :class="[
            'px-4 py-2 rounded-lg font-bold text-lg transition-all duration-200 relative',
            horse.buttonClass,
            isRacing || selectedHorseIndex !== -1
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:scale-110 hover:shadow-lg',
            selectedHorseIndex === index
              ? 'ring-4 ring-white ring-offset-2 ring-offset-gray-900'
              : '',
          ]"
          @click="selectHorse(index)">
          {{ horse.emoji }}
          <span
            v-if="selectedHorseIndex === index"
            class="absolute -top-2 -right-2 text-xs bg-white text-gray-900 rounded-full w-5 h-5 flex items-center justify-center"
            >✓</span
          >
        </button>
      </div>

      <!-- Selected Horse Display -->
      <p v-if="selectedHorseIndex !== -1" class="text-sm text-gray-400 mb-4">
        You picked:
        <span :class="horses[selectedHorseIndex].textClass">{{
          horseNames[selectedHorseIndex]
        }}</span>
      </p>

      <!-- Race Progress Bars -->
      <div class="space-y-3">
        <div v-for="(horse, index) in horses" :key="index" class="flex items-center gap-3">
          <span class="text-2xl w-8">{{ horse.emoji }}</span>
          <div class="flex-1 h-8 bg-gray-800 rounded-full overflow-hidden relative">
            <div
              :class="['h-full transition-all duration-100 rounded-full', horse.progressClass]"
              :style="{ width: `${horse.progress}%` }" />
            <!-- Winner crown -->
            <div
              v-if="
                (raceFinished || firstFinisherIndex === index) &&
                (winnerIndex === index || firstFinisherIndex === index)
              "
              class="absolute right-2 top-1/2 -translate-y-1/2">
              👑
            </div>
          </div>
        </div>
      </div>

      <!-- Lose Message -->
      <Transition name="fade">
        <div v-if="showLoseMessage" class="mt-4">
          <p class="text-xl font-bold text-red-400 mb-2">
            {{ loseMessage }}
          </p>
          <p class="text-sm text-gray-400 mb-2">
            Winner:
            <span :class="horses[winnerIndex].textClass">{{ horseNames[winnerIndex] }}</span> 🏆
          </p>
          <button
            type="button"
            class="px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white font-bold rounded-lg transition-colors"
            @click="resetRace">
            Try Again
          </button>
        </div>
      </Transition>

      <!-- Race Status -->
      <p v-if="isRacing" class="text-sm text-gray-500 mt-4">Race in progress...</p>
    </div>

    <!-- Completion Checkmark -->
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
import { ref, watch, onMounted, reactive } from "vue"
import { useAprilStore } from "@/stores/april"

const aprilStore = useAprilStore()

const RACE_DURATION_MS = 20_000
const TICK_INTERVAL_MS = 50

const loseMessages = [
  "Not this one! 🐎",
  "Wrong horse! Try again! 🐴",
  "So close, yet so far! 🏇",
  "Better luck next time! 🎲",
  "That horse tripped! 😅",
]

const horseNames = ["Sky", "Encamy", "Fevrik", "Osas", "Shpetz"]

interface Horse {
  emoji: string
  buttonClass: string
  progressClass: string
  textClass: string
  progress: number
  speed: number
}

const horses = reactive<Horse[]>([
  {
    emoji: "🦈",
    buttonClass: "bg-red-500 hover:bg-red-600 text-white",
    progressClass: "bg-red-500",
    textClass: "text-red-400",
    progress: 0,
    speed: 0,
  },
  {
    emoji: "🪿",
    buttonClass: "bg-blue-500 hover:bg-blue-600 text-white",
    progressClass: "bg-blue-500",
    textClass: "text-blue-400",
    progress: 0,
    speed: 0,
  },
  {
    emoji: "👷",
    buttonClass: "bg-green-500 hover:bg-green-600 text-white",
    progressClass: "bg-green-500",
    textClass: "text-green-400",
    progress: 0,
    speed: 0,
  },
  {
    emoji: "🗿",
    buttonClass: "bg-orange-500 hover:bg-orange-600 text-white",
    progressClass: "bg-orange-500",
    textClass: "text-orange-400",
    progress: 0,
    speed: 0,
  },
  {
    emoji: "🐩",
    buttonClass: "bg-purple-500 hover:bg-purple-600 text-white",
    progressClass: "bg-purple-500",
    textClass: "text-purple-400",
    progress: 0,
    speed: 0,
  },
])

const isRacing = ref(false)
const isCompleted = ref(false)
const showLoseMessage = ref(false)
const loseMessage = ref("")
const attemptCount = ref(0)
const winningHorseIndex = ref(0)
const selectedHorseIndex = ref(-1)
const raceStartTime = ref(0)
const raceInterval = ref<number | null>(null)
const raceFinished = ref(false)
const winnerIndex = ref(-1)
const firstFinisherIndex = ref(-1)
const progressAtFinish = ref<number[]>([])

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

function initRace() {
  winningHorseIndex.value = Math.floor(Math.random() * 5)
  attemptCount.value = 0
  selectedHorseIndex.value = -1
  raceFinished.value = false
  winnerIndex.value = -1
  firstFinisherIndex.value = -1
  progressAtFinish.value = []
  resetProgressBars()
}

function resetProgressBars() {
  horses.forEach((horse) => {
    horse.progress = 0
    horse.speed = 0
  })
}

function resetRace() {
  showLoseMessage.value = false
  isRacing.value = false
  selectedHorseIndex.value = -1
  raceFinished.value = false
  winnerIndex.value = -1
  firstFinisherIndex.value = -1
  progressAtFinish.value = []
  resetProgressBars()

  if (attemptCount.value >= 4) {
    winningHorseIndex.value = selectedHorseIndex.value
  } else {
    winningHorseIndex.value = Math.floor(Math.random() * 5)
  }
}

function assignRandomSpeeds(userIndex: number, attemptNumber: number) {
  const speeds: number[] = []

  for (let i = 0; i < 5; i++) {
    const baseSpeed = 0.6 + Math.random() * 0.3
    const variation = 1.3 + Math.random() * 0.2
    speeds.push(baseSpeed * variation)
  }

  if (attemptNumber === 1) {
    const maxSpeed = Math.max(...speeds)
    const userSpeed = speeds[userIndex]

    if (userSpeed >= maxSpeed * 0.95) {
      speeds[userIndex] = Math.min(...speeds) * 0.85
    }
  }

  horses.forEach((horse, index) => {
    const acceleration = 0.000002 + Math.random() * 0.000004
    horse.speed = speeds[index]
    ;(horse as any).acceleration = acceleration
    ;(horse as any).currentSpeed = 0
  })
}

function selectHorse(index: number) {
  if (isRacing.value || isCompleted.value) return

  selectedHorseIndex.value = index
  attemptCount.value++
  isRacing.value = true
  showLoseMessage.value = false
  raceFinished.value = false
  firstFinisherIndex.value = -1

  while (attemptCount.value === 1 && winningHorseIndex.value === selectedHorseIndex.value) {
    winningHorseIndex.value = Math.floor(Math.random() * 5)
  }

  assignRandomSpeeds(index, attemptCount.value)
  raceStartTime.value = Date.now()

  raceInterval.value = window.setInterval(() => {
    const elapsed = Date.now() - raceStartTime.value

    let allFinished = true

    horses.forEach((horse, hIndex) => {
      const accel = (horse as any).acceleration || 0.00002
      const currentSpeed = (horse as any).currentSpeed || horse.speed

      const newSpeed = currentSpeed + accel * elapsed
      ;(horse as any).currentSpeed = newSpeed

      const increment = ((newSpeed * TICK_INTERVAL_MS) / RACE_DURATION_MS) * 100
      horse.progress = Math.min(horse.progress + increment, 100)

      if (horse.progress < 100) {
        allFinished = false
      } else if (firstFinisherIndex.value === -1) {
        firstFinisherIndex.value = hIndex
        progressAtFinish.value = horses.map((h) => h.progress)
      }
    })

    if (allFinished || elapsed >= RACE_DURATION_MS) {
      finishRace()
    }
  }, TICK_INTERVAL_MS)
}

function finishRace() {
  if (raceInterval.value) {
    clearInterval(raceInterval.value)
    raceInterval.value = null
  }

  raceFinished.value = true

  let determinedWinner: number

  if (attemptCount.value >= 5) {
    determinedWinner = selectedHorseIndex.value
  } else if (firstFinisherIndex.value !== -1) {
    determinedWinner = firstFinisherIndex.value
  } else {
    determinedWinner = winningHorseIndex.value
  }

  horses.forEach((horse, index) => {
    if (index === determinedWinner) {
      horse.progress = 100
    } else if (progressAtFinish.value.length > 0) {
      horse.progress = progressAtFinish.value[index]
    }
  })

  winnerIndex.value = determinedWinner
  isRacing.value = false

  if (determinedWinner === selectedHorseIndex.value) {
    isCompleted.value = true
    aprilStore.completeCaptcha()
  } else {
    loseMessage.value = loseMessages[Math.floor(Math.random() * loseMessages.length)]
    showLoseMessage.value = true
  }
}

onMounted(() => {
  initRace()
})

watch(
  () => aprilStore.isCaptchaActive,
  (active) => {
    if (active) {
      isCompleted.value = false
      initRace()
    }
  },
)
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
