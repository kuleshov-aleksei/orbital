<template>
  <div
    class="fixed inset-0 safe-area-pad bg-theme-bg-primary flex items-start sm:items-center justify-center overflow-y-auto"
    data-testid="verify-email-view">
    <div
      class="w-full max-w-md px-5 pt-16 pb-8 sm:p-8 sm:bg-theme-bg-secondary sm:rounded-xl sm:shadow-xl text-center">
      <img
        src="/orbital-logo.png"
        alt="Orbital Logo"
        class="w-14 h-14 object-contain mx-auto mb-4" />

      <template v-if="state === 'loading'">
        <h1 class="text-2xl font-bold text-theme-text-primary">Confirming your email…</h1>
      </template>

      <template v-else-if="state === 'done'">
        <PhCheckCircle class="w-10 h-10 text-green-400 mx-auto mb-2" />
        <h1 class="text-2xl font-bold text-theme-text-primary">Email confirmed</h1>
        <p class="mt-2 text-theme-text-muted">
          Thanks! If you forget your password, you can now reset it by email.
        </p>
      </template>

      <template v-else>
        <PhWarningCircle class="w-10 h-10 text-red-400 mx-auto mb-2" />
        <h1 class="text-2xl font-bold text-theme-text-primary">This link doesn't work</h1>
        <p class="mt-2 text-theme-text-muted" data-testid="verify-email-error">{{ errorText }}</p>
      </template>

      <router-link
        v-if="state !== 'loading'"
        to="/"
        class="mt-6 inline-block w-full py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-semibold transition-colors duration-200">
        Open Orbital
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { PhCheckCircle, PhWarningCircle } from "@phosphor-icons/vue"
import { apiService, type ApiError } from "@/services/api"
import { useUserStore } from "@/stores"

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const state = ref<"loading" | "done" | "error">("loading")
const errorText = ref("")

onMounted(async () => {
  document.title = "Confirm email · Orbital"
  const token = typeof route.query.token === "string" ? route.query.token : ""
  // Keep the token out of the address bar and history.
  void router.replace({ query: {} })
  if (!token) {
    state.value = "error"
    errorText.value = "The link is incomplete. Open it again from the email."
    return
  }
  try {
    await apiService.verifyEmail(token)
    userStore.setEmailVerified(true)
    state.value = "done"
  } catch (error) {
    state.value = "error"
    const status = (error as ApiError).status
    errorText.value =
      status === 400
        ? "It has expired or was already used. Request a new one from the banner in Orbital."
        : "Couldn't reach the server. Check your connection and open the link again."
  }
})
</script>
