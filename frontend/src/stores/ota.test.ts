import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"

const otaMock = vi.hoisted(() => ({
  otaSupported: vi.fn(() => true),
  confirmBoot: vi.fn(async () => {}),
  pendingVersion: vi.fn(async (): Promise<string | null> => null),
  onReady: vi.fn(),
  apply: vi.fn(async () => true),
}))
vi.mock("@/services/ota", () => otaMock)

import { useOtaStore } from "./ota"
import { useRoomStore } from "./room"

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  useOtaStore().stop()
  vi.useRealTimers()
})

describe("ota store", () => {
  it("confirms the boot and picks up a bundle downloaded earlier", async () => {
    otaMock.pendingVersion.mockResolvedValueOnce("1.9.0")
    const ota = useOtaStore()
    await ota.start()
    expect(otaMock.confirmBoot).toHaveBeenCalled()
    expect(ota.readyVersion).toBe("1.9.0")
  })

  it("does nothing on shells without OTA", async () => {
    otaMock.otaSupported.mockReturnValueOnce(false)
    await useOtaStore().start()
    expect(otaMock.confirmBoot).not.toHaveBeenCalled()
  })

  it("never applies during a call", async () => {
    const ota = useOtaStore()
    ota.setReady("1.9.0")
    useRoomStore().setActiveRoom("20261110145113MiTbtB")
    expect(await ota.apply()).toBe(false)
    expect(otaMock.apply).not.toHaveBeenCalled()
  })

  it("applies by itself after 30 idle minutes, but not in a call", async () => {
    const ota = useOtaStore()
    await ota.start()
    ota.setReady("1.9.0")

    useRoomStore().setActiveRoom("20261110145113MiTbtB")
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000)
    expect(otaMock.apply).not.toHaveBeenCalled()

    useRoomStore().setActiveRoom(null)
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(otaMock.apply).toHaveBeenCalledTimes(1)
  })

  it("dismiss hides the toast for that version only", () => {
    const ota = useOtaStore()
    ota.setReady("1.9.0")
    ota.dismiss()
    expect(ota.dismissedVersion).toBe("1.9.0")
    ota.setReady("1.9.1")
    expect(ota.readyVersion).not.toBe(ota.dismissedVersion)
  })
})
