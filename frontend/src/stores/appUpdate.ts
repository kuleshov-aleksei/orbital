import { defineStore } from "pinia"
import { computed, ref } from "vue"
import { apiService, type LatestRelease } from "@/services/api"
import { appVersion, compareVersions } from "@/services/appVersion"
import { isCapacitor } from "@/services/platform"
import { stage as stageOta } from "@/services/ota"
import { useOtaStore } from "@/stores/ota"
import { debugLog } from "@/utils/debug"

const DISMISSED_KEY = "orbital_update_dismissed_version"

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function writeDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version)
  } catch {
    // Private mode / blocked storage: the prompt just comes back next launch.
  }
}

/**
 * Android app updates (docs/notes/ANDROID_UPDATES.md). A release built for this
 * APK's shell arrives over the air (services/ota.ts, stores/ota.ts) and never
 * shows the APK prompt. Otherwise the app offers the APK link, which opens in
 * the system browser, and Android's installer takes over.
 * - `updateAvailable`: a newer release exists → dismissible AppUpdatePrompt.
 * - `required`: this build is below the admin-set minimum (from the release
 *   info, or a 426 / WS 4426 from the backend) → blocking AppOutdatedScreen.
 */
export const useAppUpdateStore = defineStore("appUpdate", () => {
  const currentVersion = appVersion()
  const latestVersion = ref<string | null>(null)
  const downloadUrl = ref<string | null>(null)
  const minVersion = ref<string | null>(null)
  /** Refused by the backend; cleared by a check that finds the build allowed again. */
  const refused = ref(false)
  const dismissedVersion = ref<string | null>(readDismissed())
  const checking = ref(false)

  const belowMinimum = computed(
    () => !!minVersion.value && compareVersions(currentVersion, minVersion.value) === -1,
  )
  const required = computed(() => refused.value || belowMinimum.value)

  const otaStore = useOtaStore()

  const updateAvailable = computed(
    () =>
      !required.value &&
      !!latestVersion.value &&
      !!downloadUrl.value &&
      latestVersion.value !== dismissedVersion.value &&
      // Already downloaded over the air: OtaReadyToast offers it instead.
      latestVersion.value !== otaStore.readyVersion &&
      compareVersions(currentVersion, latestVersion.value) === -1,
  )

  function applyRelease(release: LatestRelease): void {
    latestVersion.value = release.version || null
    downloadUrl.value = release.android_url || null
    minVersion.value = release.android_min_version || null
    // A fresh answer decides; a stale 426 must not keep the app locked
    // after the admin lowers or clears the minimum.
    refused.value = false
  }

  /** The backend refused this build (426 / WS close 4426). */
  function markRefused(min: string | null = null): void {
    if (min) minVersion.value = min
    refused.value = true
    // Fetch the download link for the blocking screen.
    if (!downloadUrl.value) void check()
  }

  /** Fetches the latest release. Android only; failures are silent (next trigger retries). */
  async function check(): Promise<void> {
    if (!isCapacitor() || checking.value) return
    checking.value = true
    try {
      const release = await apiService.getLatestRelease()
      // Try the over-the-air bundle before deciding on the APK prompt.
      if (release.android_ota_manifest_url && release.version !== currentVersion) {
        const res = await stageOta(release.android_ota_manifest_url)
        if (res.result === "staged" && res.version) otaStore.setReady(res.version)
      }
      applyRelease(release)
      // Below the minimum but the new bundle is here: switch to it right away.
      if (required.value && otaStore.readyVersion) void otaStore.apply()
    } catch (err) {
      debugLog("[AppUpdate] release check failed", err)
    } finally {
      checking.value = false
    }
  }

  /** "Later": hide the prompt until a newer version than this one comes out. */
  function dismiss(): void {
    if (!latestVersion.value) return
    dismissedVersion.value = latestVersion.value
    writeDismissed(latestVersion.value)
  }

  return {
    currentVersion,
    latestVersion,
    downloadUrl,
    minVersion,
    dismissedVersion,
    checking,
    required,
    updateAvailable,
    applyRelease,
    markRefused,
    check,
    dismiss,
  }
})
