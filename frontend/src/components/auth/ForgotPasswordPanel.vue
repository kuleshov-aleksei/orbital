<template>
  <div data-testid="forgot-password-panel">
    <button
      type="button"
      data-testid="forgot-password-back"
      class="mb-4 flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
      @click="emit('back')">
      <PhArrowLeft class="w-4 h-4" />
      Back to sign in
    </button>

    <h2 class="text-2xl font-bold text-theme-text-primary">Reset your password</h2>

    <template v-if="sent">
      <p class="mt-3 text-theme-text-muted" data-testid="forgot-password-sent">
        If <span class="text-theme-text-primary">{{ email }}</span> belongs to an account with a
        confirmed email, we've sent a link to choose a new password. It's valid for 1 hour.
      </p>
      <p class="mt-3 text-sm text-theme-text-muted">
        Nothing arrived? Check the spam folder. Only a confirmed email can receive the link.
      </p>
    </template>

    <form v-else class="mt-1" @submit.prevent="submit">
      <p class="mb-5 text-theme-text-muted">
        Enter the email of your account and we'll send you a link to choose a new password.
      </p>
      <div
        v-if="errorMessage"
        class="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
        {{ errorMessage }}
      </div>
      <label class="block text-theme-text-muted text-sm mb-1" for="forgot-email">Email</label>
      <input
        id="forgot-email"
        v-model.trim="email"
        type="email"
        autocomplete="email"
        required
        placeholder="your@email.com"
        class="w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-theme-accent"
        data-testid="forgot-password-email" />
      <button
        type="submit"
        class="mt-4 w-full py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-semibold transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="submitting || !email"
        data-testid="forgot-password-submit">
        {{ submitting ? "Sending…" : "Send reset link" }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { PhArrowLeft } from "@phosphor-icons/vue"
import { apiService, type ApiError } from "@/services/api"

const props = defineProps<{ initialEmail?: string }>()
const emit = defineEmits<{ back: [] }>()

const email = ref(props.initialEmail?.includes("@") ? props.initialEmail : "")
const submitting = ref(false)
const sent = ref(false)
const errorMessage = ref("")

async function submit() {
  submitting.value = true
  errorMessage.value = ""
  try {
    await apiService.requestPasswordReset(email.value)
    sent.value = true
  } catch (error) {
    const status = (error as ApiError).status
    errorMessage.value =
      status === 429
        ? "Too many attempts. Wait a minute and try again."
        : status === 503
          ? "Password reset by email isn't available on this server."
          : "Couldn't reach the server. Check your connection and try again."
  } finally {
    submitting.value = false
  }
}
</script>
