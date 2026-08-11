<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhHeadphones class="w-5 h-5 text-theme-accent" />
      Debug Audio
    </h3>

    <p class="text-sm text-theme-text-muted">
      Capture 10 seconds of system (loopback) audio and play it back. Use this to verify that system
      audio capture works on this machine, e.g. when screen share audio is missing or silent.
    </p>

    <!-- Capture -->
    <div class="pt-2 border-t border-theme-border space-y-3">
      <p class="text-sm text-theme-text-secondary">
        1. Start playing any audio on your machine (music, video, game sounds).
        <br />
        2. Press the button below. The app will capture 10 seconds of system audio.
        <template v-if="isElectronApp">
          <br />
          3. If capture fails with &quot;Could not start audio source&quot;, copy the error and the
          device list below and share it with the duck.
        </template>
      </p>

      <button
        type="button"
        class="px-3 py-1.5 text-sm bg-theme-accent hover:bg-theme-accent-hover disabled:bg-theme-bg-hover text-theme-text-on-accent rounded transition-colors whitespace-nowrap"
        :disabled="capturing"
        @click="startCapture">
        <span v-if="capturing">Capturing... {{ remainingSeconds }}s</span>
        <span v-else>Capture 10s of System Audio</span>
      </button>

      <p
        v-if="statusMessage"
        class="text-xs"
        :class="statusIsError ? 'text-red-400' : 'text-green-400'">
        {{ statusMessage }}
      </p>
    </div>

    <!-- Playback -->
    <div v-if="playbackUrl" class="pt-2 border-t border-theme-border space-y-2">
      <label class="text-sm font-medium text-theme-text-primary block">Playback</label>
      <audio ref="playbackEl" :src="playbackUrl" controls class="w-full" />
      <div class="flex gap-2">
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded transition-colors"
          @click="play">
          Play
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover rounded transition-colors"
          @click="stopPlayback">
          Stop
        </button>
      </div>
    </div>

    <!-- Diagnostics -->
    <div class="pt-2 border-t border-theme-border">
      <div class="flex items-center justify-between gap-4">
        <div>
          <label class="text-sm font-medium text-theme-text-primary block">Audio Devices</label>

          <p class="text-xs text-theme-text-muted mt-0.5">
            Current input/output devices, plus loopback track settings if the last capture
            succeeded.
          </p>
        </div>

        <button
          type="button"
          class="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover rounded transition-colors whitespace-nowrap"
          @click="enumerateDevices">
          Refresh
        </button>
      </div>

      <pre
        v-if="detailsText"
        class="mt-2 p-2 bg-theme-bg-tertiary border border-theme-border rounded text-xs text-theme-text-secondary overflow-auto whitespace-pre-wrap max-h-64"
        >{{ detailsText }}</pre
      >
      <p v-else class="text-xs text-theme-text-muted mt-2">
        Press &quot;Refresh&quot; to enumerate devices.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, useTemplateRef } from "vue"
import { PhHeadphones } from "@phosphor-icons/vue"
import { isElectron, getDesktopSources, startElectronScreenShare } from "@/services/electron"
import { debugLog, debugError } from "@/utils/debug"

const CAPTURE_DURATION_MS = 10000

const isElectronApp = isElectron()

const capturing = ref(false)
const remainingSeconds = ref(0)
const statusMessage = ref("")
const statusIsError = ref(false)
const playbackUrl = ref<string | null>(null)
const detailsText = ref("")
const playbackEl = useTemplateRef<HTMLAudioElement>("playbackEl")

let capturedStream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let captureTimer: number | null = null
let countdownTimer: number | null = null

interface DeviceInfo {
  kind: MediaDeviceKind
  deviceId: string
  label: string
  groupId: string
}

function describeDevices(devices: MediaDeviceInfo[]): DeviceInfo[] {
  return devices.map((d) => ({
    kind: d.kind,
    deviceId: d.deviceId,
    label: d.label || "(no label)",
    groupId: d.groupId,
  }))
}

async function enumerateDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    detailsText.value = JSON.stringify({ devices: describeDevices(devices) }, null, 2)
  } catch (error) {
    detailsText.value = describeError(error)
  }
}

function stopTracks() {
  capturedStream?.getTracks().forEach((t) => t.stop())
  capturedStream = null
}

function stopCountdown() {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function cleanup() {
  stopCountdown()
  if (captureTimer !== null) {
    window.clearTimeout(captureTimer)
    captureTimer = null
  }
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop()
    } catch {
      // ignore
    }
  }
  recorder = null
  stopTracks()
  chunks = []
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    return JSON.stringify({ name: error.name, message: error.message, code: error.code }, null, 2)
  }
  if (error instanceof Error) {
    return JSON.stringify({ name: error.name, message: error.message }, null, 2)
  }
  return String(error)
}

async function buildDetails(devicesBefore: MediaDeviceInfo[], trackSettings?: MediaTrackSettings) {
  let devicesAfter: MediaDeviceInfo[] = []
  try {
    devicesAfter = await navigator.mediaDevices.enumerateDevices()
  } catch {
    // ignore
  }
  detailsText.value = JSON.stringify(
    {
      before: describeDevices(devicesBefore),
      after: describeDevices(devicesAfter),
      loopbackTrackSettings: trackSettings ?? null,
    },
    null,
    2,
  )
}

async function startCapture() {
  cleanup()
  statusMessage.value = ""
  statusIsError.value = false
  if (playbackUrl.value) {
    URL.revokeObjectURL(playbackUrl.value)
    playbackUrl.value = null
  }

  let devicesBefore: MediaDeviceInfo[] = []
  try {
    devicesBefore = await navigator.mediaDevices.enumerateDevices()
  } catch {
    // ignore
  }

  if (isElectronApp) {
    try {
      const sources = await getDesktopSources()
      const screen = sources.find((s) => s.id.startsWith("screen:"))
      if (!screen) {
        throw new Error("No screen source available for loopback capture")
      }
      const res = await startElectronScreenShare(screen.id, true)
      if (!res?.success) {
        throw new Error(`Failed to initialize capture source: ${res?.error ?? "unknown error"}`)
      }
      debugLog("[DebugAudio] Set pending screen share source for loopback:", screen.id)
    } catch (error) {
      statusIsError.value = true
      statusMessage.value = "Failed to initialize loopback capture"
      detailsText.value = describeError(error)
      debugError("[DebugAudio] init failed:", error)
      return
    }
  }

  capturing.value = true

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: { ideal: 640 }, height: { ideal: 360 } },
    })

    capturedStream = stream
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) {
      throw new Error("No loopback audio track in captured stream")
    }

    const trackSettings = audioTrack.getSettings()
    debugLog("[DebugAudio] Loopback audio track settings:", trackSettings)

    chunks = []
    recorder = new MediaRecorder(new MediaStream([audioTrack]))
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data)
      }
    }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" })
      if (playbackUrl.value) {
        URL.revokeObjectURL(playbackUrl.value)
      }
      playbackUrl.value = URL.createObjectURL(blob)
      captureTimer = null
      stopCountdown()
      capturing.value = false
      statusIsError.value = false
      statusMessage.value = `Captured ${(blob.size / 1024).toFixed(1)} KB (${CAPTURE_DURATION_MS / 1000}s) of system audio. Press play to hear it back.`
      void buildDetails(devicesBefore, trackSettings)
      stopTracks()
    }
    recorder.start()

    remainingSeconds.value = Math.ceil(CAPTURE_DURATION_MS / 1000)
    countdownTimer = window.setInterval(() => {
      remainingSeconds.value = Math.max(0, remainingSeconds.value - 1)
    }, 1000)

    captureTimer = window.setTimeout(() => {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop()
      }
    }, CAPTURE_DURATION_MS)

    statusMessage.value = "Recording system audio... keep playing sound!"
  } catch (error) {
    capturing.value = false
    stopCountdown()
    statusIsError.value = true
    statusMessage.value = "Loopback capture failed"
    detailsText.value = describeError(error)
    void buildDetails(devicesBefore)
    debugError("[DebugAudio] getDisplayMedia failed:", error)
    stopTracks()
  }
}

function play() {
  void playbackEl.value?.play()
}

function stopPlayback() {
  const el = playbackEl.value
  if (el) {
    el.pause()
    el.currentTime = 0
  }
}

onMounted(() => {
  void enumerateDevices()
})

onUnmounted(() => {
  cleanup()
  if (playbackUrl.value) {
    URL.revokeObjectURL(playbackUrl.value)
    playbackUrl.value = null
  }
})
</script>
