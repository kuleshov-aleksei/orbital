<template>
  <div class="text-center">
    <h2 class="text-xl font-semibold text-theme-text-primary mb-1">Sign in with QR code</h2>
    <p class="text-theme-text-muted text-sm mb-5">
      Scan this code with a logged-in device to sign in here
    </p>

    <!-- Error -->
    <div
      v-if="phase === 'error'"
      class="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
      {{ errorMessage }}
    </div>

    <!-- Starting -->
    <div v-if="phase === 'starting'" class="py-10 text-theme-text-muted text-sm">
      Generating your secure code…
    </div>

    <!-- Waiting: dots QR + countdown -->
    <div v-if="phase === 'waiting'">
      <!-- The SVG below is fully generated from the QR module matrix (booleans
           only) plus constants: no user data is interpolated into markup. -->
      <!-- eslint-disable vue/no-v-html -->
      <div
        class="inline-block bg-white rounded-2xl p-4 shadow-lg"
        data-testid="qr-login-code"
        v-html="qrSvg" />
      <!-- eslint-enable vue/no-v-html -->
      <div class="mt-4 text-theme-text-muted text-sm">
        Code expires in
        <span class="font-semibold text-theme-text-primary tabular-nums">{{ countdown }}</span>
      </div>
      <button
        type="button"
        class="mt-3 text-theme-accent hover:underline text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
        :disabled="!canRegenerate"
        @click="restart">
        Generate a new code
      </button>
      <p v-if="!canRegenerate" class="mt-2 text-theme-text-muted text-xs">
        You can generate a new code in {{ unlockCountdown }}
      </p>
    </div>

    <!-- Expired -->
    <div v-if="phase === 'expired'" class="py-6">
      <p class="text-theme-text-muted text-sm mb-4">
        This code expired. Generate a new one and scan it within 2 minutes.
      </p>
      <button
        type="button"
        class="px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-medium transition-colors duration-200"
        @click="restart">
        Generate a new code
      </button>
    </div>

    <!-- Approved (brief handover state) -->
    <div v-if="phase === 'done'" class="py-10 text-theme-text-muted text-sm">
      Approved — signing you in…
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useUserStore } from "@/stores"
import type { UserSession } from "@/stores/user"
import { apiService } from "@/services/api"
import { collectSystemInfo } from "@/services/systemInfo"
import { debugError } from "@/utils/debug"
import {
  buildQRLoginPayload,
  formatQRDeviceName,
  generateLoginKeypair,
  openSealedAuthResponse,
  renderDotsQR,
} from "@/services/qr"

type Phase = "starting" | "waiting" | "expired" | "error" | "done"

const POLL_INTERVAL_MS = 1500

// Regeneration is only unlocked in the final seconds of a code's life so the
// user cannot mint a flood of challenges (and orphaned pending rows).
const REGEN_UNLOCK_SECONDS = 30

const userStore = useUserStore()
const phase = ref<Phase>("starting")
const errorMessage = ref("")
const qrSvg = ref("")
const expiresAtMs = ref(0)
const nowMs = ref(Date.now())

let challengeId = ""
let privateKey: Uint8Array | null = null
let publicKeyB64 = ""
let pollTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
let stopped = false

const remainingSeconds = computed(() =>
  Math.max(0, Math.ceil((expiresAtMs.value - nowMs.value) / 1000)),
)

const canRegenerate = computed(() => remainingSeconds.value <= REGEN_UNLOCK_SECONDS)

function formatDuration(seconds: number): string {
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return `${mm}:${ss.toString().padStart(2, "0")}`
}

const countdown = computed(() => formatDuration(remainingSeconds.value))

// Time until the "Generate a new code" button unlocks, not the code's own
// expiry: it hits 0:00 exactly when remainingSeconds reaches the unlock window.
const unlockCountdown = computed(() =>
  formatDuration(Math.max(0, remainingSeconds.value - REGEN_UNLOCK_SECONDS)),
)

function stopTimers() {
  if (pollTimer) clearInterval(pollTimer)
  if (clockTimer) clearInterval(clockTimer)
  pollTimer = null
  clockTimer = null
}

function wipeKey() {
  privateKey?.fill(0)
  privateKey = null
}

function fail(message: string) {
  stopTimers()
  wipeKey()
  errorMessage.value = message
  phase.value = "error"
}

function expire() {
  stopTimers()
  wipeKey()
  phase.value = "expired"
}

async function pollOnce() {
  if (stopped || phase.value !== "waiting" || !privateKey) return
  try {
    const result = await apiService.claimQRChallenge(challengeId)
    if (stopped) return
    if (result.status !== "approved" || !result.sealed_payload) return
    stopTimers()
    const opened = await openSealedAuthResponse(result.sealed_payload, publicKeyB64, privateKey)
    wipeKey()
    const provider = opened.user.auth_provider
    const sessionUser: UserSession = {
      id: opened.user.id,
      nickname: opened.user.nickname,
      authProvider:
        provider === "discord" || provider === "google" || provider === "password"
          ? provider
          : "password",
      isGuest: false,
      role: opened.user.role || "user",
      email: opened.user.email,
      avatarUrl: opened.user.avatar_url,
    }
    phase.value = "done"
    userStore.handleOAuthCallback(opened.token, sessionUser, opened.expires_at)
  } catch (error) {
    if (stopped) return
    const status = (error as { status?: number }).status
    if (status === 404 || status === 410) {
      expire()
      return
    }
    // Transient network failure: keep polling; the countdown still bounds the wait.
  }
}

async function start() {
  stopped = false
  phase.value = "starting"
  errorMessage.value = ""
  try {
    const kp = await generateLoginKeypair()
    privateKey = kp.privateKey
    publicKeyB64 = kp.publicKeyB64

    const info = await collectSystemInfo()
    const deviceName = formatQRDeviceName({
      browserName: info.browser.name,
      browserVersion: info.browser.version,
      platform: info.platform,
      isElectron: info.is_electron,
      isMobile: info.is_mobile,
      electronOS: info.electron
        ? `${info.electron.os_type} ${info.electron.os_release}`
        : undefined,
    })

    const created = await apiService.createQRChallenge({
      public_key: publicKeyB64,
      device_name: deviceName,
      device_info: JSON.stringify(info).slice(0, 8000),
    })
    if (stopped) return
    challengeId = created.challenge_id
    expiresAtMs.value = Date.parse(created.expires_at)
    nowMs.value = Date.now()
    qrSvg.value = renderDotsQR(buildQRLoginPayload(challengeId, publicKeyB64))
    phase.value = "waiting"

    clockTimer = setInterval(() => {
      nowMs.value = Date.now()
      if (nowMs.value >= expiresAtMs.value) expire()
    }, 500)
    pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS)
    void pollOnce()
  } catch (error) {
    if (!stopped) {
      debugError("[QRLogin] Failed to start device linking:", error)
      fail("Could not start device linking. Check your connection and try again.")
    }
  }
}

function restart() {
  stopTimers()
  wipeKey()
  void start()
}

onMounted(() => void start())

onUnmounted(() => {
  stopped = true
  stopTimers()
  wipeKey()
})
</script>
