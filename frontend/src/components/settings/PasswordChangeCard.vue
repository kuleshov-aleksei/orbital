<template>
  <div class="bg-theme-bg-tertiary rounded-lg p-4" data-testid="password-change-section">
    <div class="font-medium text-theme-text-primary mb-1">Password</div>
    <p class="text-theme-text-muted text-sm mb-3">
      Changing it signs you out on every other device. This one stays signed in.
    </p>

    <p
      v-if="successMessage && !open"
      class="mb-3 text-sm text-green-400"
      data-testid="password-change-success">
      {{ successMessage }}
    </p>

    <form v-if="open" class="space-y-2" @submit.prevent="submit">
      <label class="block text-sm text-theme-text-secondary" for="current-password">
        Current password
      </label>
      <input
        id="current-password"
        v-model="current"
        type="password"
        autocomplete="current-password"
        required
        :class="inputClass"
        data-testid="current-password-input" />

      <label class="block text-sm text-theme-text-secondary pt-1" for="change-new-password">
        New password
      </label>
      <input
        id="change-new-password"
        v-model="next"
        type="password"
        autocomplete="new-password"
        required
        :class="inputClass"
        data-testid="new-password-input" />
      <ul class="text-xs space-y-0.5">
        <li
          v-for="rule in rules"
          :key="rule.label"
          :class="rule.ok ? 'text-green-400' : 'text-theme-text-muted'">
          {{ rule.ok ? "✓" : "○" }} {{ rule.label }}
        </li>
      </ul>

      <label class="block text-sm text-theme-text-secondary pt-1" for="change-confirm-password">
        Confirm new password
      </label>
      <input
        id="change-confirm-password"
        v-model="confirm"
        type="password"
        autocomplete="new-password"
        required
        :class="inputClass"
        data-testid="confirm-password-input" />
      <p v-if="confirm && confirm !== next" class="text-xs text-red-400">Passwords do not match</p>

      <p v-if="errorMessage" class="text-xs text-red-400" data-testid="password-change-error">
        {{ errorMessage }}
      </p>

      <div class="flex gap-2 pt-1">
        <button
          type="submit"
          class="flex-1 px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="submitting || !canSubmit || !connectionStore.isOnline"
          data-testid="password-change-submit">
          {{ submitting ? "Saving…" : "Change password" }}
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
      data-testid="password-change-open"
      @click="openForm">
      <PhPassword class="w-4 h-4" />
      Change password
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { PhPassword } from "@phosphor-icons/vue"
import { useConnectionStore } from "@/stores"
import { apiService, type ApiError } from "@/services/api"
import { usePasswordRules } from "@/composables/usePasswordRules"

const emit = defineEmits<{ changed: [] }>()

const connectionStore = useConnectionStore()

const inputClass =
  "w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-theme-accent"

const open = ref(false)
const current = ref("")
const next = ref("")
const confirm = ref("")
const submitting = ref(false)
const errorMessage = ref("")
const successMessage = ref("")

const { rules, passwordOk } = usePasswordRules(next)
const canSubmit = computed(
  () => current.value !== "" && passwordOk.value && next.value === confirm.value,
)

function openForm() {
  open.value = true
  successMessage.value = ""
}

function close() {
  open.value = false
  current.value = ""
  next.value = ""
  confirm.value = ""
  errorMessage.value = ""
}

async function submit() {
  submitting.value = true
  errorMessage.value = ""
  try {
    await apiService.changePassword(current.value, next.value)
    close()
    successMessage.value = "Password changed. Other devices were signed out."
    emit("changed")
  } catch (error) {
    const err = error as ApiError
    if (err.status === 403) {
      errorMessage.value = "The current password is wrong."
    } else if (err.status === 409) {
      errorMessage.value = "Restart the app and try again: this sign-in is too old to keep."
    } else if (err.status === 400) {
      errorMessage.value = err.message.trim()
    } else {
      errorMessage.value = "Couldn't change the password. Try again."
    }
  } finally {
    submitting.value = false
  }
}
</script>
