<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhShieldCheck class="w-5 h-5 text-theme-accent" />
      Security
    </h3>

    <!-- Link a new device -->
    <div class="bg-theme-bg-tertiary rounded-lg p-4">
      <div class="font-medium text-theme-text-primary mb-1">Link a new device</div>
      <p class="text-theme-text-muted text-sm mb-3">
        Show a QR code on the new device, then scan it here to sign it in — no password needed. Only
        approve codes from devices you recognize.
      </p>
      <button
        v-if="userStore.isLoggedIn && !userStore.isGuest"
        type="button"
        class="flex items-center gap-2 px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-medium transition-colors duration-200"
        @click="showScanner = true">
        <PhQrCode class="w-5 h-5" />
        Scan QR code
      </button>
      <p v-else class="text-theme-text-muted text-sm">
        Sign in with a full account to link new devices. Guest sessions cannot approve sign-ins.
      </p>
    </div>

    <QRScanModal :is-open="showScanner" @close="showScanner = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { PhQrCode, PhShieldCheck } from "@phosphor-icons/vue"
import { useUserStore } from "@/stores"
import QRScanModal from "@/components/auth/QRScanModal.vue"

defineProps<{ hideHeader?: boolean }>()

const userStore = useUserStore()
const showScanner = ref(false)
</script>
