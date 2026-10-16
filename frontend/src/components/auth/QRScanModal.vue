<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50"
    @click.self="close">
    <div class="bg-theme-bg-secondary rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
      <div class="px-5 py-4 border-b border-theme-border flex items-center justify-between">
        <h3 class="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
          <PhQrCode class="w-5 h-5 text-theme-accent" />
          Link a new device
        </h3>
        <button
          type="button"
          class="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover rounded-lg transition-colors"
          @click="close">
          <PhX class="w-5 h-5" />
        </button>
      </div>

      <div class="p-5">
        <!-- Camera error -->
        <div
          v-if="phase === 'error'"
          class="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm mb-4">
          {{ errorMessage }}
        </div>
        <button
          v-if="phase === 'error'"
          type="button"
          class="w-full py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-medium transition-colors duration-200"
          @click="startScanning">
          Try again
        </button>

        <!-- Scanning -->
        <div v-if="phase === 'starting' || phase === 'scanning'">
          <p class="text-theme-text-muted text-sm mb-3">
            Point your camera at the QR code shown on the new device.
          </p>
          <div class="relative rounded-xl overflow-hidden bg-black">
            <video
              ref="videoEl"
              class="w-full aspect-[4/3] object-cover"
              playsinline
              muted
              autoplay />
            <div
              v-if="phase === 'starting'"
              class="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
              Starting camera…
            </div>
          </div>
          <div v-if="cameras.length > 1" class="mt-3">
            <label class="block text-theme-text-muted text-xs mb-1" for="qr-camera-select"
              >Camera</label
            >
            <select
              id="qr-camera-select"
              v-model="selectedCamera"
              class="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-theme-accent"
              @change="switchCamera">
              <option v-for="cam in cameras" :key="cam.deviceId" :value="cam.deviceId">
                {{ cam.label || "Camera" }}
              </option>
            </select>
          </div>
        </div>

        <!-- Confirm -->
        <div v-if="phase === 'confirm' && challenge">
          <div class="bg-theme-bg-tertiary rounded-lg p-4 mb-4">
            <p class="text-theme-text-muted text-sm mb-1">You are trying to sign in on</p>
            <p class="text-theme-text-primary font-semibold text-lg">
              {{ challenge.device_name || "an unknown device" }}
            </p>
            <ul v-if="deviceDetails.length > 0" class="mt-2 space-y-0.5">
              <li
                v-for="(detail, i) in deviceDetails"
                :key="i"
                class="text-theme-text-muted text-xs">
                {{ detail }}
              </li>
            </ul>
            <p class="mt-2 text-theme-text-muted text-xs">
              This request expires in
              <span class="tabular-nums">{{ confirmCountdown }}</span>
            </p>
          </div>
          <p class="text-theme-text-muted text-sm mb-4">
            Only approve if you recognize this device. Approving signs it in as
            <span class="font-medium text-theme-text-primary">{{ userStore.nickname }}</span
            >.
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg font-medium transition-colors duration-200"
              :disabled="phase !== 'confirm'"
              @click="deny">
              Deny
            </button>
            <button
              type="button"
              class="flex-1 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-medium transition-colors duration-200 disabled:opacity-50"
              :disabled="phase !== 'confirm'"
              @click="approve">
              Approve sign-in
            </button>
          </div>
        </div>

        <!-- Approving -->
        <div v-if="phase === 'approving'" class="py-8 text-center text-theme-text-muted text-sm">
          Approving…
        </div>

        <!-- Done -->
        <div v-if="phase === 'done'" class="py-4 text-center">
          <PhCheckCircle class="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p class="text-theme-text-primary font-medium mb-1">Device linked</p>
          <p class="text-theme-text-muted text-sm mb-4">The new device is now signed in.</p>
          <button
            type="button"
            class="px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg font-medium transition-colors duration-200"
            @click="close">
            Done
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue"
import { PhCheckCircle, PhQrCode, PhX } from "@phosphor-icons/vue"
import { useUserStore } from "@/stores"
import { apiService, type QRChallengeView } from "@/services/api"
import { startLoginScanSession, type QRLoginPayload, type QRScanSession } from "@/services/qr"

type Phase = "starting" | "scanning" | "confirm" | "approving" | "done" | "error"

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const userStore = useUserStore()
const videoEl = useTemplateRef<HTMLVideoElement>("videoEl")
const phase = ref<Phase>("starting")
const errorMessage = ref("")
const challenge = ref<QRChallengeView | null>(null)
const scanned = ref<QRLoginPayload | null>(null)
const cameras = ref<Array<{ deviceId: string; label: string }>>([])
const selectedCamera = ref("")
const expiresAtMs = ref(0)
const nowMs = ref(Date.now())

let session: QRScanSession | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

const deviceDetails = computed(() => {
  if (!challenge.value?.device_info) return []
  try {
    const info = JSON.parse(challenge.value.device_info) as {
      browser?: { name?: string; version?: string }
      platform?: string
      app_version?: string
      is_electron?: boolean
    }
    const details: string[] = []
    if (info.browser?.name) {
      details.push(
        `Browser: ${info.browser.name}${info.browser.version ? ` ${info.browser.version}` : ""}`,
      )
    }
    if (info.platform) details.push(`Platform: ${info.platform}`)
    if (info.app_version) details.push(`App version: ${info.app_version}`)
    return details.slice(0, 4)
  } catch {
    return []
  }
})

const confirmCountdown = computed(() => {
  const remaining = Math.max(0, Math.ceil((expiresAtMs.value - nowMs.value) / 1000))
  return `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, "0")}`
})

function stopSession() {
  session?.stop()
  session = null
  if (clockTimer) clearInterval(clockTimer)
  clockTimer = null
}

function fail(message: string) {
  stopSession()
  errorMessage.value = message
  phase.value = "error"
}

async function startScanning() {
  stopSession()
  challenge.value = null
  scanned.value = null
  errorMessage.value = ""
  phase.value = "starting"
  await nextTick()
  if (!videoEl.value) {
    fail("Camera view is not available")
    return
  }
  try {
    session = await startLoginScanSession(
      videoEl.value,
      (payload) => void onDecoded(payload),
      () => {},
    )
    cameras.value = await session.listDevices().catch(() => [])
    phase.value = "scanning"
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not access the camera")
  }
}

async function onDecoded(payload: QRLoginPayload) {
  stopSession()
  scanned.value = payload
  try {
    const view = await apiService.getQRChallenge(payload.challengeId)
    // The server must present the same public key the QR code carried;
    // otherwise someone tampered with the exchange.
    if (view.public_key !== payload.publicKey) {
      fail("This code failed its integrity check. Ask the new device for a fresh code.")
      return
    }
    if (view.status !== "pending") {
      fail("This code was already used. Ask the new device for a fresh code.")
      return
    }
    challenge.value = view
    expiresAtMs.value = Date.parse(view.expires_at)
    nowMs.value = Date.now()
    clockTimer = setInterval(() => {
      nowMs.value = Date.now()
      if (nowMs.value >= expiresAtMs.value) {
        stopSession()
        fail("This code expired. Ask the new device for a fresh code.")
      }
    }, 500)
    phase.value = "confirm"
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404) fail("This code is unknown. Ask the new device for a fresh code.")
    else if (status === 410) fail("This code expired. Ask the new device for a fresh code.")
    else fail("Could not verify this code. Check your connection and try again.")
  }
}

async function approve() {
  if (!scanned.value || phase.value !== "confirm") return
  phase.value = "approving"
  try {
    await apiService.approveQRChallenge(scanned.value.challengeId, scanned.value.publicKey)
    if (clockTimer) clearInterval(clockTimer)
    clockTimer = null
    phase.value = "done"
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 403) fail("Guest accounts cannot link devices.")
    else if (status === 409 || status === 410)
      fail("This code was already used or expired. Ask the new device for a fresh code.")
    else fail("Approval failed. Check your connection and try again.")
  }
}

function deny() {
  close()
}

async function switchCamera() {
  if (!session || !selectedCamera.value) return
  try {
    await session.setDevice(selectedCamera.value)
  } catch {
    // keep the current camera on failure
  }
}

function close() {
  stopSession()
  emit("close")
}

watch(
  () => props.isOpen,
  (open) => {
    if (open) void startScanning()
    else stopSession()
  },
)
</script>
