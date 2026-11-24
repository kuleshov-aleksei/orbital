<template>
  <div class="bg-theme-bg-tertiary rounded-lg p-4" data-testid="email-change-section">
    <div class="font-medium text-theme-text-primary mb-1">Email</div>
    <div class="flex items-center gap-2 min-w-0 mb-3">
      <span class="text-sm text-theme-text-secondary truncate" data-testid="current-email">
        {{ userStore.email || "No email" }}
      </span>
      <span
        v-if="userStore.currentUser?.emailVerified === true"
        class="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-600/20 text-green-400">
        Verified
      </span>
      <span
        v-else-if="userStore.currentUser?.emailVerified === false"
        class="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium bg-yellow-600/20 text-yellow-400">
        Not verified
      </span>
    </div>

    <p v-if="notice && !open" class="mb-3 text-sm text-green-400" data-testid="email-change-notice">
      {{ notice }}
    </p>

    <form v-if="open" class="space-y-2" @submit.prevent="submit">
      <label class="block text-sm text-theme-text-secondary" for="new-email">New email</label>
      <input
        id="new-email"
        v-model="newEmail"
        type="email"
        autocomplete="email"
        required
        :class="inputClass"
        data-testid="new-email-input" />

      <label class="block text-sm text-theme-text-secondary pt-1" for="email-change-password">
        Password
      </label>
      <input
        id="email-change-password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        :class="inputClass"
        data-testid="email-change-password-input" />
      <p v-if="configStore.emailEnabled" class="text-xs text-theme-text-muted">
        We'll send a link to the new address. Your email changes once you open it.
      </p>

      <p v-if="errorMessage" class="text-xs text-red-400" data-testid="email-change-error">
        {{ errorMessage }}
      </p>

      <div class="flex gap-2 pt-1">
        <button
          type="submit"
          class="flex-1 px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="submitting || !newEmail.trim() || !password || !connectionStore.isOnline"
          data-testid="email-change-submit">
          {{ submitting ? "Saving…" : "Change email" }}
        </button>
        <button
          type="button"
          class="flex-1 px-4 py-2 bg-theme-bg-secondary hover:bg-theme-bg-hover border border-theme-border text-theme-text-primary rounded-lg text-sm font-medium transition-colors duration-200"
          :disabled="submitting"
          @click="close">
          Cancel
        </button>
      </div>
    </form>

    <button
      v-else
      type="button"
      class="flex items-center gap-2 px-4 py-2 bg-theme-bg-secondary hover:bg-theme-bg-hover border border-theme-border text-theme-text-primary rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="!connectionStore.isOnline"
      data-testid="email-change-open"
      @click="openForm">
      <PhEnvelopeSimple class="w-4 h-4" />
      Change email
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { PhEnvelopeSimple } from "@phosphor-icons/vue"
import { useConfigStore, useConnectionStore, useUserStore } from "@/stores"
import { apiService, type ApiError } from "@/services/api"

const userStore = useUserStore()
const configStore = useConfigStore()
const connectionStore = useConnectionStore()

const inputClass =
  "w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-theme-accent"

const open = ref(false)
const newEmail = ref("")
const password = ref("")
const submitting = ref(false)
const errorMessage = ref("")
const notice = ref("")

function openForm() {
  open.value = true
  notice.value = ""
}

function close() {
  open.value = false
  newEmail.value = ""
  password.value = ""
  errorMessage.value = ""
}

async function submit() {
  submitting.value = true
  errorMessage.value = ""
  try {
    const result = await apiService.requestEmailChange(newEmail.value.trim(), password.value)
    userStore.setEmail(result.email, result.email_verified)
    close()
    notice.value = result.pending
      ? `Check ${result.new_email} and open the link to finish the change.`
      : "Email changed."
  } catch (error) {
    const err = error as ApiError
    if (err.status === 403) {
      errorMessage.value = "Wrong password."
    } else if (err.status === 409) {
      errorMessage.value = "That email is already used by another account."
    } else if (err.status === 429) {
      errorMessage.value = "Please wait a minute before trying again."
    } else if (err.status === 400) {
      errorMessage.value = err.message.trim()
    } else {
      errorMessage.value = "Couldn't change the email. Try again."
    }
  } finally {
    submitting.value = false
  }
}
</script>
