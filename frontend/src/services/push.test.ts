import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  registerPushDevice: vi.fn().mockResolvedValue(undefined),
  unregisterPushDevice: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/services/api", () => ({ apiService: api }))
const platform = vi.hoisted(() => ({ isCapacitor: vi.fn(() => true) }))
vi.mock("@/services/platform", () => platform)
vi.mock("@/utils/debug", () => ({ debugLog: vi.fn(), debugWarn: vi.fn() }))

type Listener = (event: unknown) => void
const native = vi.hoisted(() => {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    permission: "granted",
    PushNotifications: {
      addListener: vi.fn(async (name: string, fn: Listener) => {
        listeners.set(name, fn)
        return { remove: vi.fn() }
      }),
      createChannel: vi.fn().mockResolvedValue(undefined),
      checkPermissions: vi.fn(async () => ({ receive: native.permission })),
      requestPermissions: vi.fn(async () => ({ receive: native.permission })),
      register: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(undefined),
      // Like Capacitor's plugin proxy: every property, `then` included, is a
      // native call. Awaiting the plugin object itself must never happen.
      then: vi.fn(() => Promise.reject(new Error('"PushNotifications.then()" is not implemented'))),
    },
  }
})
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.PushNotifications }))

import { registerPush, resetPushForTests, setupPush, unregisterPush } from "./push"

const ROOM = "20261110145113MiTbtB"

function fire(name: string, event: unknown) {
  native.listeners.get(name)?.(event)
}

describe("push service", () => {
  beforeEach(() => {
    resetPushForTests()
    native.listeners.clear()
    native.permission = "granted"
    vi.clearAllMocks()
    platform.isCapacitor.mockReturnValue(true)
    localStorage.clear()
  })

  it("registers the device token with the backend after login", async () => {
    await setupPush(vi.fn())
    await registerPush()
    expect(native.PushNotifications.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mentions" }),
    )
    expect(native.PushNotifications.register).toHaveBeenCalled()
    fire("registration", { value: "fcm-token" })
    expect(api.registerPushDevice).toHaveBeenCalledWith("fcm-token", "android")
  })

  it("does not register without the notification permission", async () => {
    native.permission = "denied"
    await setupPush(vi.fn())
    await registerPush()
    expect(native.PushNotifications.register).not.toHaveBeenCalled()
  })

  it("opens the mentioned channel when a notification is tapped", async () => {
    const onOpen = vi.fn()
    await setupPush(onOpen)
    fire("pushNotificationActionPerformed", {
      actionId: "tap",
      notification: { data: { type: "text_mention", room_id: ROOM, message_id: "42" } },
    })
    expect(onOpen).toHaveBeenCalledWith(ROOM, "42")
    fire("pushNotificationActionPerformed", { actionId: "tap", notification: { data: {} } })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("unregisters the token on logout and ignores later token events", async () => {
    await setupPush(vi.fn())
    await registerPush()
    fire("registration", { value: "fcm-token" })
    await unregisterPush()
    expect(api.unregisterPushDevice).toHaveBeenCalledWith("fcm-token")
    expect(native.PushNotifications.unregister).toHaveBeenCalled()
    api.registerPushDevice.mockClear()
    fire("registration", { value: "fcm-token-2" })
    expect(api.registerPushDevice).not.toHaveBeenCalled()
  })

  it("never awaits the plugin proxy itself", async () => {
    await setupPush(vi.fn())
    await registerPush()
    await unregisterPush()
    expect(native.PushNotifications.then).not.toHaveBeenCalled()
  })

  it("lets logout continue when the plugin never answers", async () => {
    vi.useFakeTimers()
    try {
      await setupPush(vi.fn())
      native.PushNotifications.unregister.mockReturnValueOnce(new Promise(() => {}))
      const done = vi.fn()
      void unregisterPush().then(done)
      await vi.advanceTimersByTimeAsync(3000)
      expect(done).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("is a no-op outside the Android app", async () => {
    platform.isCapacitor.mockReturnValue(false)
    await setupPush(vi.fn())
    await registerPush()
    await unregisterPush()
    expect(native.PushNotifications.addListener).not.toHaveBeenCalled()
    expect(native.PushNotifications.register).not.toHaveBeenCalled()
  })
})
