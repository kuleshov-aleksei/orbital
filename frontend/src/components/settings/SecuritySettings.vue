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

    <template v-if="userStore.isAuthenticated && userStore.authProvider === 'password'">
      <PasswordChangeCard @changed="load" />
      <EmailChangeCard />
    </template>

    <!-- Active sessions -->
    <div v-if="userStore.isLoggedIn" class="bg-theme-bg-tertiary rounded-lg p-4">
      <div class="font-medium text-theme-text-primary mb-1">Active sessions</div>
      <p class="text-theme-text-muted text-sm mb-3">
        Devices signed in to your account. Sign out any you don't recognize.
      </p>

      <div v-if="loading && sessions.length === 0" class="py-3 text-sm text-theme-text-muted">
        Loading sessions…
      </div>
      <div v-else-if="loadError" class="py-3 text-sm text-red-400">
        {{ loadError }}
        <button
          type="button"
          class="ml-2 underline text-theme-text-secondary hover:text-theme-text-primary"
          @click="load">
          Retry
        </button>
      </div>

      <ul v-else class="divide-y divide-theme-border" data-testid="session-list">
        <li v-for="session in sessions" :key="session.id" class="flex items-center gap-3 py-2.5">
          <component
            :is="platformIcon(session.platform)"
            class="w-6 h-6 flex-shrink-0 text-theme-text-secondary" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-medium text-theme-text-primary truncate">
                {{ session.device_name }}
              </span>
              <span
                v-if="session.current"
                class="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium bg-theme-accent text-theme-text-on-accent">
                This device
              </span>
            </div>
            <div class="text-xs text-theme-text-muted truncate">
              <span :title="formatDate(session.last_active_at)">
                {{ session.current ? "Active now" : lastActiveLabel(session.last_active_at) }}
              </span>
              <template v-if="session.ip"> · {{ session.ip }}</template>
              · signed in {{ formatDay(session.created_at) }}
            </div>
          </div>
          <button
            v-if="!session.current"
            type="button"
            class="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-theme-text-secondary hover:text-white hover:bg-red-600 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="busy || !connectionStore.isOnline"
            :aria-label="`Sign out ${session.device_name}`"
            @click="revoke(session)">
            <PhSignOut class="w-4 h-4" />
            Sign out
          </button>
        </li>
      </ul>

      <p v-if="actionError" class="mt-2 text-xs text-red-400">{{ actionError }}</p>

      <div v-if="otherSessionCount > 0" class="pt-3 mt-2 border-t border-theme-border">
        <div v-if="confirmingRevokeAll" class="space-y-2">
          <p class="text-sm text-theme-text-secondary">
            Sign out {{ otherSessionCount }} other
            {{ otherSessionCount === 1 ? "session" : "sessions" }}? This device stays signed in.
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50"
              :disabled="busy || !connectionStore.isOnline"
              data-testid="confirm-revoke-others"
              @click="revokeOthers">
              Sign out
            </button>
            <button
              type="button"
              class="flex-1 px-4 py-2 bg-theme-bg-secondary hover:bg-theme-bg-hover border border-theme-border text-theme-text-primary rounded-lg text-sm font-medium transition-colors duration-200"
              @click="confirmingRevokeAll = false">
              Cancel
            </button>
          </div>
        </div>
        <button
          v-else
          type="button"
          class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-theme-bg-secondary hover:bg-theme-bg-hover border border-theme-border text-red-400 rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="busy || !connectionStore.isOnline"
          data-testid="revoke-others"
          @click="confirmingRevokeAll = true">
          <PhSignOut class="w-4 h-4" />
          Sign out of all other sessions
        </button>
      </div>
    </div>

    <!-- Delete account -->
    <div
      v-if="userStore.isAuthenticated"
      class="bg-theme-bg-tertiary rounded-lg p-4 border border-red-500/30"
      data-testid="delete-account-section">
      <div class="font-medium text-theme-text-primary mb-1">Delete account</div>
      <p class="text-theme-text-muted text-sm mb-3">
        Your profile, sign-in sessions, settings and uploaded files are deleted for good. Messages
        you posted stay visible as written by "Deleted user". This can't be undone.
      </p>

      <p v-if="userStore.isSuperAdmin" class="text-theme-text-muted text-sm">
        You own this server, so this account can't be deleted.
      </p>

      <form v-else-if="confirmingDelete" class="space-y-2" @submit.prevent="deleteAccount">
        <label class="block text-sm text-theme-text-secondary" for="delete-account-confirm">
          <template v-if="usesPassword">Enter your password to confirm.</template>
          <template v-else>
            Type your nickname
            <strong class="text-theme-text-primary">{{ userStore.nickname }}</strong>
            to confirm.
          </template>
        </label>
        <input
          id="delete-account-confirm"
          v-model="deleteConfirm"
          :type="usesPassword ? 'password' : 'text'"
          :autocomplete="usesPassword ? 'current-password' : 'off'"
          class="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-red-500"
          data-testid="delete-account-input" />
        <p v-if="deleteError" class="text-xs text-red-400">{{ deleteError }}</p>
        <div class="flex gap-2">
          <button
            type="submit"
            class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="deleting || !deleteConfirm || !connectionStore.isOnline"
            data-testid="confirm-delete-account">
            {{ deleting ? "Deleting…" : "Delete my account" }}
          </button>
          <button
            type="button"
            class="flex-1 px-4 py-2 bg-theme-bg-secondary hover:bg-theme-bg-hover border border-theme-border text-theme-text-primary rounded-lg text-sm font-medium transition-colors duration-200"
            :disabled="deleting"
            @click="cancelDelete">
            Cancel
          </button>
        </div>
      </form>

      <button
        v-else
        type="button"
        class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-theme-bg-secondary hover:bg-red-600 hover:text-white border border-theme-border text-red-400 rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!connectionStore.isOnline"
        data-testid="delete-account"
        @click="confirmingDelete = true">
        <PhTrash class="w-4 h-4" />
        Delete account
      </button>
    </div>

    <QRScanModal :is-open="showScanner" @close="showScanner = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, type Component } from "vue"
import {
  PhDesktop,
  PhDeviceMobile,
  PhGlobe,
  PhQrCode,
  PhShieldCheck,
  PhSignOut,
  PhTrash,
} from "@phosphor-icons/vue"
import { useConnectionStore, useUserStore } from "@/stores"
import { apiService, type AuthSessionInfo } from "@/services/api"
import QRScanModal from "@/components/auth/QRScanModal.vue"
import PasswordChangeCard from "./PasswordChangeCard.vue"
import EmailChangeCard from "./EmailChangeCard.vue"

defineProps<{ hideHeader?: boolean }>()
const emit = defineEmits<{ logout: [] }>()

const userStore = useUserStore()
const connectionStore = useConnectionStore()
const showScanner = ref(false)

const sessions = ref<AuthSessionInfo[]>([])
const loading = ref(false)
const busy = ref(false)
const loadError = ref("")
const actionError = ref("")
const confirmingRevokeAll = ref(false)

const otherSessionCount = computed(() => sessions.value.filter((s) => !s.current).length)

function platformIcon(platform: AuthSessionInfo["platform"]): Component {
  if (platform === "android") return PhDeviceMobile
  if (platform === "desktop") return PhDesktop
  return PhGlobe
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// The backend writes last_active_at at most once a minute, so anything within
// two minutes reads as "now".
function lastActiveLabel(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 2) return "Active now"
  if (minutes < 60) return `Active ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Active ${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Active ${days} ${days === 1 ? "day" : "days"} ago`
  return `Active ${formatDay(iso)}`
}

async function load() {
  loading.value = true
  loadError.value = ""
  try {
    sessions.value = await apiService.listSessions()
  } catch (error) {
    console.warn("[Security] Failed to load sessions:", error)
    loadError.value = connectionStore.isOnline
      ? "Couldn't load sessions."
      : "You're offline. Sessions will load when you reconnect."
  } finally {
    loading.value = false
  }
}

async function revoke(session: AuthSessionInfo) {
  busy.value = true
  actionError.value = ""
  try {
    await apiService.revokeSession(session.id)
    sessions.value = sessions.value.filter((s) => s.id !== session.id)
  } catch (error) {
    console.warn("[Security] Failed to sign out session:", error)
    actionError.value = `Couldn't sign out ${session.device_name}.`
    await load()
  } finally {
    busy.value = false
  }
}

async function revokeOthers() {
  busy.value = true
  actionError.value = ""
  try {
    await apiService.revokeOtherSessions()
    confirmingRevokeAll.value = false
    await load()
  } catch (error) {
    console.warn("[Security] Failed to sign out other sessions:", error)
    actionError.value = "Couldn't sign out the other sessions."
  } finally {
    busy.value = false
  }
}

// Delete account: password accounts confirm with the password, every other
// kind (OAuth, guest) by typing the nickname.
const confirmingDelete = ref(false)
const deleteConfirm = ref("")
const deleteError = ref("")
const deleting = ref(false)
const usesPassword = computed(() => userStore.authProvider === "password")

function cancelDelete() {
  confirmingDelete.value = false
  deleteConfirm.value = ""
  deleteError.value = ""
}

async function deleteAccount() {
  deleting.value = true
  deleteError.value = ""
  try {
    await userStore.deleteAccount(
      usesPassword.value ? { password: deleteConfirm.value } : { nickname: deleteConfirm.value },
    )
    emit("logout")
  } catch (error) {
    console.warn("[Security] Failed to delete account:", error)
    const status = (error as { status?: number }).status
    deleteError.value =
      status === 403
        ? usesPassword.value
          ? "Wrong password."
          : "The nickname doesn't match."
        : "Couldn't delete the account. Try again."
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  if (userStore.isLoggedIn) void load()
})
</script>
