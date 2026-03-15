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
import { computed, ref, watch } from "vue"
import { useAprilStore } from "@/stores/april"
import SampleCaptcha from "./SampleCaptcha.vue"
import PhoneDialCaptcha from "./PhoneDialCaptcha.vue"
import HorseRacingCaptcha from "./HorseRacingCaptcha.vue"
import DiceCaptcha from "./DiceCaptcha.vue"
import ImagePuzzleCaptcha from "./ImagePuzzleCaptcha.vue"

const aprilStore = useAprilStore()

//const captchaComponents = [SampleCaptcha, PhoneDialCaptcha, HorseRacingCaptcha, DiceCaptcha, ImagePuzzleCaptcha]
// For local testing. Do not remove it
const captchaComponents = [ImagePuzzleCaptcha]

const selectedIndex = ref(0)

const CaptchaComponent = computed(() => {
  return captchaComponents[selectedIndex.value]
})

function selectRandomCaptcha() {
  selectedIndex.value = Math.floor(Math.random() * captchaComponents.length)
}

watch(() => aprilStore.isCaptchaActive, (active) => {
  if (active) {
    selectRandomCaptcha()
  }
})
</script>
