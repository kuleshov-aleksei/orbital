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
      <CaptchaComponent :type="aprilStore.currentType" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useAprilStore } from "@/stores/april"
import SampleCaptcha from "./SampleCaptcha.vue"
import PhoneDialCaptcha from "./PhoneDialCaptcha.vue"
import HorseRacingCaptcha from "./HorseRacingCaptcha.vue"

const aprilStore = useAprilStore()

//const captchaComponents = [SampleCaptcha, PhoneDialCaptcha, HorseRacingCaptcha]
// For local testing. Do not remove it
const captchaComponents = [ HorseRacingCaptcha]

const CaptchaComponent = computed(() => {
  const randomIndex = Math.floor(Math.random() * captchaComponents.length)
  return captchaComponents[randomIndex]
})
</script>
