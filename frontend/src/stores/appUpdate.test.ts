import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { LatestRelease } from "@/services/api"

const api = vi.hoisted(() => ({ getLatestRelease: vi.fn() }))
vi.mock("@/services/api", () => ({ apiService: api }))
vi.mock("@/services/platform", () => ({ isCapacitor: () => true }))
vi.mock("@/services/appVersion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/appVersion")>()),
  appVersion: () => "1.5.0",
}))
const otaStage = vi.hoisted(() => vi.fn())
vi.mock("@/services/ota", () => ({
  stage: otaStage,
  otaSupported: () => true,
  confirmBoot: vi.fn(),
  pendingVersion: vi.fn(async () => null),
  onReady: vi.fn(),
  apply: vi.fn(async () => false),
}))

import { useAppUpdateStore } from "./appUpdate"

function release(overrides: Partial<LatestRelease> = {}): LatestRelease {
  return {
    version: "1.6.0",
    windows_url: "https://updates.example/Orbital-Setup-1.6.0.exe",
    linux_url: "https://updates.example/Orbital-1.6.0.AppImage",
    android_url: "https://updates.example/Orbital-1.6.0.apk",
    android_min_version: "",
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  api.getLatestRelease.mockReset()
})

describe("app update store", () => {
  it("offers a newer release until it is dismissed", async () => {
    api.getLatestRelease.mockResolvedValue(release())
    const store = useAppUpdateStore()
    await store.check()
    expect(store.updateAvailable).toBe(true)
    expect(store.required).toBe(false)

    store.dismiss()
    expect(store.updateAvailable).toBe(false)
    // Dismissal is remembered across launches...
    setActivePinia(createPinia())
    const relaunched = useAppUpdateStore()
    await relaunched.check()
    expect(relaunched.updateAvailable).toBe(false)

    // ...until a newer version comes out.
    api.getLatestRelease.mockResolvedValue(release({ version: "1.7.0", android_url: "x.apk" }))
    await relaunched.check()
    expect(relaunched.updateAvailable).toBe(true)
  })

  it("does not offer the same or an older version", async () => {
    api.getLatestRelease.mockResolvedValue(release({ version: "1.5.0" }))
    const store = useAppUpdateStore()
    await store.check()
    expect(store.updateAvailable).toBe(false)
  })

  it("requires an update below the minimum, and lets go when it is lowered", async () => {
    api.getLatestRelease.mockResolvedValue(release({ android_min_version: "1.6.0" }))
    const store = useAppUpdateStore()
    await store.check()
    expect(store.required).toBe(true)
    expect(store.updateAvailable).toBe(false) // the blocking screen replaces the prompt

    api.getLatestRelease.mockResolvedValue(release({ android_min_version: "1.5.0" }))
    await store.check()
    expect(store.required).toBe(false)
  })

  it("blocks when the backend refuses the build, until a check clears it", async () => {
    api.getLatestRelease.mockResolvedValue(release())
    const store = useAppUpdateStore()
    store.markRefused("1.6.0")
    expect(store.required).toBe(true)
    expect(store.minVersion).toBe("1.6.0")
    // markRefused fetches the download link for the blocking screen.
    await vi.waitFor(() => expect(store.downloadUrl).toBe(release().android_url))
    expect(store.required).toBe(false) // the fresh release info has no minimum
  })

  it("keeps the last state when the check fails", async () => {
    api.getLatestRelease.mockResolvedValueOnce(release({ android_min_version: "1.6.0" }))
    const store = useAppUpdateStore()
    await store.check()
    api.getLatestRelease.mockRejectedValueOnce(new Error("offline"))
    await store.check()
    expect(store.required).toBe(true)
  })

  it("retries a broken OTA download instead of offering the APK", async () => {
    api.getLatestRelease.mockResolvedValue(
      release({ android_ota_manifest_url: "https://updates.example/ota-android.json" }),
    )
    // A download or write error must not turn into a full APK reinstall prompt.
    otaStage.mockResolvedValueOnce({ result: "failed" })
    const store = useAppUpdateStore()
    await store.check()
    expect(store.updateAvailable).toBe(false)

    // The next check retries: staged → the OTA toast offers it, still no APK prompt.
    otaStage.mockResolvedValueOnce({ result: "staged", version: "1.6.0" })
    await store.check()
    expect(store.updateAvailable).toBe(false)

    // A release that needs a newer APK does prompt.
    setActivePinia(createPinia())
    otaStage.mockResolvedValueOnce({ result: "native", version: "1.6.0" })
    const relaunched = useAppUpdateStore()
    await relaunched.check()
    expect(relaunched.updateAvailable).toBe(true)
  })
})
