<template>
  <div
    v-if="aprilStore.isCaptchaActive"
    class="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center">
    <div
      class="bg-theme-bg-primary text-theme-text-primary rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl border-2 border-red-500">
      <!-- Progress indicator -->
      <div class="flex items-center justify-between mb-6">
        <span class="text-sm font-medium text-red-500 uppercase tracking-wider">
          Are you sure you are not a robot?
        </span>
      </div>

      <!-- Captcha content -->
      <component :is="CaptchaComponent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue"
import { useAprilStore } from "@/stores/april"
import SampleCaptcha from "./SampleCaptcha.vue"
import PhoneDialCaptcha from "./PhoneDialCaptcha.vue"
import HorseRacingCaptcha from "./HorseRacingCaptcha.vue"
import DiceCaptcha from "./DiceCaptcha.vue"
import ImagePuzzleCaptcha from "./ImagePuzzleCaptcha.vue"
import Game2048Captcha from "./Game2048Captcha.vue"

const COOKIE_NAME = "april_captchas_completed"
const COOKIE_DAYS = 30

interface CaptchaEntry {
  id: string
  component: typeof SampleCaptcha
}

const captchaEntries: CaptchaEntry[] = [
  //{ id: "sample", component: SampleCaptcha },
  { id: "phone-dial", component: PhoneDialCaptcha },
  { id: "game-2048", component: Game2048Captcha },
  { id: "horse-racing", component: HorseRacingCaptcha },
  { id: "dice", component: DiceCaptcha },
  { id: "image-puzzle", component: ImagePuzzleCaptcha },
]

const aprilStore = useAprilStore()

const selectedIndex = ref(0)
const completedCaptchas = ref<string[]>([])

const CaptchaComponent = computed(() => {
  return captchaEntries[selectedIndex.value].component
})

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"))
  return match ? decodeURIComponent(match[2]) : null
}

function setCookie(name: string, value: string, days: number): void {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`
}

function loadCompletedCaptchas(): void {
  const cookieValue = getCookie(COOKIE_NAME)
  if (cookieValue) {
    try {
      completedCaptchas.value = JSON.parse(cookieValue)
    } catch {
      completedCaptchas.value = []
    }
  }
}

function saveCompletedCaptcha(id: string): void {
  if (!completedCaptchas.value.includes(id)) {
    completedCaptchas.value.push(id)
    setCookie(COOKIE_NAME, JSON.stringify(completedCaptchas.value), COOKIE_DAYS)
  }
}

function selectRandomCaptcha(): void {
  const uncompleted = captchaEntries.filter((entry) => !completedCaptchas.value.includes(entry.id))

  const pool = uncompleted.length > 0 ? uncompleted : captchaEntries
  const selected = pool[Math.floor(Math.random() * pool.length)]

  selectedIndex.value = captchaEntries.findIndex((e) => e.id === selected.id)
}

let lastActiveState = false
watch(
  () => aprilStore.isCaptchaActive,
  (active) => {
    if (active && !lastActiveState) {
      selectRandomCaptcha()
    } else if (!active && lastActiveState) {
      const captchaId = captchaEntries[selectedIndex.value].id
      saveCompletedCaptcha(captchaId)
    }
    lastActiveState = active
  },
)

onMounted(() => {
  loadCompletedCaptchas()
})
</script>
