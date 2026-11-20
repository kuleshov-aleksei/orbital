<template>
  <!-- Shown over the app (never instead of it: unmounting the call view
       disconnects LiveKit) while the signed-in user has not accepted the
       current Terms of Service and Privacy Policy. -->
  <div
    class="fixed inset-0 safe-area-pad bg-theme-bg-primary flex items-start lg:items-center justify-center overflow-y-auto z-50"
    data-testid="terms-gate">
    <div
      class="w-full max-w-md px-5 pt-10 pb-8 lg:p-8 lg:bg-theme-bg-secondary lg:rounded-xl lg:shadow-xl">
      <div class="text-center mb-6">
        <img
          src="/orbital-logo.png"
          alt="Orbital Logo"
          class="w-14 h-14 object-contain mx-auto mb-3" />
        <h2 class="text-2xl font-bold text-theme-text-primary">Before you continue</h2>
        <p class="mt-2 text-theme-text-muted text-sm">
          Orbital now has Terms of Service and a Privacy Policy. Please read them and confirm you
          agree to keep using your account.
        </p>
      </div>

      <div
        v-if="errorMessage"
        class="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
        {{ errorMessage }}
      </div>

      <TermsCheckbox v-model="accepted" testid="terms-gate-accept" @open="legalDoc = $event" />

      <button
        type="button"
        data-testid="terms-gate-continue"
        class="mt-5 w-full py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-semibold transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!accepted || isSaving"
        @click="handleContinue">
        {{ isSaving ? "Please wait..." : "Continue" }}
      </button>

      <p class="mt-4 text-center text-sm text-theme-text-muted">
        Don't agree?
        <button
          type="button"
          data-testid="terms-gate-logout"
          class="text-theme-accent hover:text-theme-accent-hover font-medium ml-1"
          @click="handleLogout">
          Sign out
        </button>
      </p>
      <p class="mt-2 text-center text-xs text-theme-text-muted">
        To delete your account, write to
        <a :href="`mailto:${LEGAL.contactEmail}`" class="text-theme-accent hover:underline">
          {{ LEGAL.contactEmail }}</a
        >.
      </p>
    </div>

    <LegalModal v-if="legalDoc" :doc="legalDoc" @close="legalDoc = null" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { useUserStore, useConnectionStore } from "@/stores"
import TermsCheckbox from "./TermsCheckbox.vue"
import LegalModal from "./LegalModal.vue"
import { LEGAL } from "./legalInfo"
import type { LegalDocId } from "./legal"

const userStore = useUserStore()
const connectionStore = useConnectionStore()

const accepted = ref(false)
const isSaving = ref(false)
const errorMessage = ref("")
const legalDoc = ref<LegalDocId | null>(null)

async function handleContinue() {
  if (!accepted.value) return
  if (connectionStore.status === "offline") {
    errorMessage.value = "You're offline. Connect to the internet and try again."
    return
  }
  errorMessage.value = ""
  isSaving.value = true
  try {
    await userStore.acceptTerms()
  } catch {
    errorMessage.value = "Couldn't save your answer. Please try again."
  } finally {
    isSaving.value = false
  }
}

async function handleLogout() {
  await userStore.logout()
}
</script>
