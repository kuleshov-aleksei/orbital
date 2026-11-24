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
        <h1 class="text-2xl font-bold text-theme-text-primary">{{ text.loading }}</h1>
      </template>

      <template v-else-if="state === 'done'">
        <PhCheckCircle class="w-10 h-10 text-green-400 mx-auto mb-2" />
        <h1 class="text-2xl font-bold text-theme-text-primary">{{ text.doneTitle }}</h1>
        <p class="mt-2 text-theme-text-muted">{{ doneBody }}</p>
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
import { computed, onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { PhCheckCircle, PhWarningCircle } from "@phosphor-icons/vue"
import { apiService, type ApiError } from "@/services/api"
import { useUserStore } from "@/stores"

// verify: first confirmation of the account email. change: the link sent to
// the new address of an email change.
const props = withDefaults(defineProps<{ mode?: "verify" | "change" }>(), { mode: "verify" })
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const TEXT = {
  verify: {
    pageTitle: "Confirm email",
    loading: "Confirming your email…",
    doneTitle: "Email confirmed",
    expired: "It has expired or was already used. Request a new one from the banner in Orbital.",
  },
  change: {
    pageTitle: "Confirm new email",
    loading: "Confirming your new email…",
    doneTitle: "Email changed",
    expired: "It has expired or was already used. Start the change again in Settings → Security.",
  },
}
const text = computed(() => TEXT[props.mode])

const state = ref<"loading" | "done" | "error">("loading")
const errorText = ref("")
const newEmail = ref("")
const doneBody = computed(() =>
  props.mode === "change"
    ? `Your account now uses ${newEmail.value}.`
    : "Thanks! Welcome to the Orbital!",
)

onMounted(async () => {
  document.title = `${text.value.pageTitle} · Orbital`
  const token = typeof route.query.token === "string" ? route.query.token : ""
  // Keep the token out of the address bar and history.
  void router.replace({ query: {} })
  if (!token) {
    state.value = "error"
    errorText.value = "The link is incomplete. Open it again from the email."
    return
  }
  try {
    if (props.mode === "change") {
      const result = await apiService.confirmEmailChange(token)
      newEmail.value = result.email
      // The link may be opened on another device or account.
      if (userStore.currentUser?.id === result.user_id) {
        userStore.setEmail(result.email, result.email_verified)
      }
    } else {
      await apiService.verifyEmail(token)
      userStore.setEmailVerified(true)
    }
    state.value = "done"
  } catch (error) {
    state.value = "error"
    const status = (error as ApiError).status
    errorText.value =
      status === 400
        ? text.value.expired
        : status === 409
          ? "That address is already used by another account."
          : "Couldn't reach the server. Check your connection and open the link again."
  }
})
</script>
