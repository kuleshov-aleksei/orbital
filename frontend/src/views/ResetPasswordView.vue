<template>
  <div
    class="fixed inset-0 safe-area-pad bg-theme-bg-primary flex items-start sm:items-center justify-center overflow-y-auto"
    data-testid="reset-password-view">
    <div
      class="w-full max-w-md px-5 pt-16 pb-8 sm:p-8 sm:bg-theme-bg-secondary sm:rounded-xl sm:shadow-xl">
      <img
        src="/orbital-logo.png"
        alt="Orbital Logo"
        class="w-14 h-14 object-contain mx-auto mb-4" />

      <template v-if="done">
        <div class="text-center">
          <PhCheckCircle class="w-10 h-10 text-green-400 mx-auto mb-2" />
          <h1 class="text-2xl font-bold text-theme-text-primary">{{ text.doneTitle }}</h1>
          <p class="mt-2 text-theme-text-muted">
            {{ text.doneBody }} You're signed in on this device. Every other device was signed out.
          </p>
          <router-link
            to="/"
            class="mt-6 inline-block w-full py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-semibold transition-colors duration-200">
            Open Orbital
          </router-link>
        </div>
      </template>

      <template v-else-if="!token">
        <div class="text-center">
          <h1 class="text-2xl font-bold text-theme-text-primary">This link doesn't work</h1>
          <p class="mt-2 text-theme-text-muted">{{ text.incomplete }}</p>
          <router-link
            to="/"
            class="mt-6 inline-block w-full py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-semibold transition-colors duration-200 text-center">
            Back to sign in
          </router-link>
        </div>
      </template>

      <form v-else data-testid="reset-password-form" @submit.prevent="submit">
        <h1 class="text-2xl font-bold text-theme-text-primary text-center">
          {{ text.title }}
        </h1>
        <p class="mt-1 mb-6 text-theme-text-muted text-center">{{ text.intro }}</p>

        <div
          v-if="errorMessage"
          class="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm"
          data-testid="reset-password-error">
          {{ errorMessage }}
        </div>

        <label class="block text-theme-text-muted text-sm mb-1" for="new-password">
          New password
        </label>
        <input
          id="new-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          :class="inputClass"
          data-testid="reset-password-input" />
        <ul class="mt-2 mb-3 text-xs space-y-0.5">
          <li
            v-for="rule in rules"
            :key="rule.label"
            :class="rule.ok ? 'text-green-400' : 'text-theme-text-muted'">
            {{ rule.ok ? "✓" : "○" }} {{ rule.label }}
          </li>
        </ul>

        <label class="block text-theme-text-muted text-sm mb-1" for="confirm-new-password">
          Confirm password
        </label>
        <input
          id="confirm-new-password"
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          required
          :class="inputClass"
          data-testid="reset-password-confirm" />
        <p v-if="confirm && confirm !== password" class="text-red-400 text-xs mt-1">
          Passwords do not match
        </p>

        <button
          type="submit"
          class="mt-5 w-full py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-semibold transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="submitting || !canSubmit"
          data-testid="reset-password-submit">
          {{ submitting ? "Please wait…" : text.submit }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { PhCheckCircle } from "@phosphor-icons/vue"
import { apiService, type ApiError } from "@/services/api"
import { useUserStore } from "@/stores"
import { usePasswordRules } from "@/composables/usePasswordRules"

// reset: link from "Forgot password?". restore: the "this wasn't me" link
// mailed to the old address after an email change.
const props = withDefaults(defineProps<{ mode?: "reset" | "restore" }>(), { mode: "reset" })

const TEXT = {
  reset: {
    pageTitle: "Reset password",
    title: "Choose a new password",
    intro: "Setting it signs you out on every device.",
    submit: "Set new password",
    doneTitle: "Password changed",
    doneBody: "",
    incomplete:
      "The link is incomplete. Open it again from the email, or ask for a new one from the sign-in screen.",
    expired:
      "This link has expired or was already used. Ask for a new one from the sign-in screen.",
  },
  restore: {
    pageTitle: "Recover account",
    title: "Get your account back",
    intro:
      "Your email goes back to this address. Whoever changed it may know your password, so choose a new one: every device is signed out.",
    submit: "Restore email and set password",
    doneTitle: "Account recovered",
    doneBody: "Your email is back and your password is new.",
    incomplete: "The link is incomplete. Open it again from the email.",
    expired:
      "This link has expired or was already used. If you still can't sign in, contact the server owner.",
  },
}
const text = computed(() => TEXT[props.mode])

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const inputClass =
  "w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-theme-accent"

// Read once, then dropped from the address bar so it isn't kept in history.
const token = ref(typeof route.query.token === "string" ? route.query.token : "")
const password = ref("")
const confirm = ref("")
const submitting = ref(false)
const errorMessage = ref("")
const done = ref(false)

const { rules, passwordOk } = usePasswordRules(password)
const canSubmit = computed(() => passwordOk.value && password.value === confirm.value)

onMounted(() => {
  document.title = `${text.value.pageTitle} · Orbital`
  if (route.query.token) void router.replace({ query: {} })
})

async function submit() {
  submitting.value = true
  errorMessage.value = ""
  try {
    const response =
      props.mode === "restore"
        ? await apiService.restoreEmail(token.value, password.value)
        : await apiService.resetPassword(token.value, password.value)
    userStore.completePasswordReset(response)
    done.value = true
  } catch (error) {
    const err = error as ApiError
    if (err.status === 409) {
      errorMessage.value =
        "That address now belongs to another account, so it can't come back. Contact the server owner."
    } else if (err.status === 400) {
      errorMessage.value = err.message.includes("expired") ? text.value.expired : err.message.trim()
    } else {
      errorMessage.value = "Couldn't reach the server. Check your connection and try again."
    }
  } finally {
    submitting.value = false
  }
}
</script>
