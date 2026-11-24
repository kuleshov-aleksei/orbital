<template>
  <div
    v-if="visible"
    role="status"
    data-testid="email-verify-banner"
    class="fixed z-40 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-xl p-4"
    :class="appStore.isMobile ? 'safe-top-4 left-4 right-4' : 'right-4 bottom-4 w-96'">
    <div class="flex items-start gap-3">
      <PhEnvelopeSimple class="w-5 h-5 mt-0.5 shrink-0 text-theme-accent" />
      <div class="flex-1 min-w-0 text-sm">
        <p class="font-semibold text-theme-text-primary">Confirm your email</p>
        <p class="mt-0.5 text-theme-text-muted break-words">
          <template v-if="status === 'sent'">
            We sent a new link to {{ userStore.email }}. It's valid for 24 hours.
          </template>
          <template v-else>
            Open the link we sent to {{ userStore.email }}, so you can reset your password if you
            ever forget it.
          </template>
        </p>
        <p v-if="error" class="mt-1 text-red-400" data-testid="email-verify-error">{{ error }}</p>
        <button
          v-if="status !== 'sent'"
          type="button"
          class="mt-2 text-theme-accent hover:underline disabled:opacity-50"
          :disabled="status === 'sending' || !connectionStore.isOnline"
          data-testid="email-verify-resend"
          @click="resend">
          {{ status === "sending" ? "Sending…" : "Send the link again" }}
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        class="text-theme-text-muted hover:text-theme-text-primary"
        data-testid="email-verify-dismiss"
        @click="dismiss">
        <PhX class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { PhEnvelopeSimple, PhX } from "@phosphor-icons/vue"
import { apiService, type ApiError } from "@/services/api"
import { useAppStore, useConfigStore, useConnectionStore, useUserStore } from "@/stores"

// Dismissing hides the banner until the app is opened again.
const DISMISS_KEY = "orbital_email_verify_dismissed"

const userStore = useUserStore()
const configStore = useConfigStore()
const connectionStore = useConnectionStore()
const appStore = useAppStore()

const dismissed = ref(sessionStorage.getItem(DISMISS_KEY) === userStore.userId)
const status = ref<"idle" | "sending" | "sent">("idle")
const error = ref("")

const visible = computed(
  () => configStore.emailEnabled && userStore.needsEmailVerification && !dismissed.value,
)

function dismiss() {
  dismissed.value = true
  sessionStorage.setItem(DISMISS_KEY, userStore.userId)
}

async function resend() {
  status.value = "sending"
  error.value = ""
  try {
    await apiService.resendVerificationEmail()
    status.value = "sent"
  } catch (err) {
    const code = (err as ApiError).status
    if (code === 409) {
      // Verified meanwhile (e.g. on another device).
      userStore.setEmailVerified(true)
      return
    }
    status.value = "idle"
    error.value =
      code === 429 ? "Please wait a minute before asking again." : "Couldn't send the email."
  }
}
</script>
