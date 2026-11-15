import type { PluginListenerHandle } from "@capacitor/core"
import { apiService } from "@/services/api"
import { isCapacitor } from "@/services/platform"
import { debugLog, debugWarn } from "@/utils/debug"

/**
 * Text channel push notifications in the Android app (Firebase Cloud
 * Messaging). The server decides everything: it pushes only when none of the
 * user's sessions is active (client_state, see services/websocket.ts), skips
 * muted channels and throttles chatter (backend websocket/textchat_push.go).
 * This module only registers the device, creates the notification channels
 * and opens the channel when a notification is tapped.
 * Every function is a no-op outside the Android app.
 */

/** Must match push.AndroidChannelID / push.MessagesChannelID in the backend. */
const MENTIONS_CHANNEL_ID = "mentions"
const MESSAGES_CHANNEL_ID = "messages"
/** Push data types that open a text channel when tapped. */
const OPENABLE_TYPES = new Set(["text_mention", "text_message"])
const TOKEN_KEY = "orbital_push_token"

type OpenHandler = (roomId: string, messageId: string | null) => void

let listenersReady: Promise<void> | null = null
let handles: PluginListenerHandle[] = []
let wantRegistered = false

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage is best effort; the next registration sends the token again.
  }
}

/**
 * Loads the plugin module. Never return or await the PushNotifications object
 * itself: Capacitor plugins are proxies that forward every property, including
 * `then`, to native code, so awaiting one hangs forever.
 */
function pushModule() {
  return import("@capacitor/push-notifications")
}

/** Logout must never wait on FCM or the network for long. */
const UNREGISTER_TIMEOUT_MS = 3000

/**
 * Installs the push listeners once (call at app start, before login, so a
 * tap that launched the app is not missed). onOpen gets the channel of a
 * tapped notification.
 */
export function setupPush(onOpen: OpenHandler): Promise<void> {
  if (!isCapacitor()) return Promise.resolve()
  if (listenersReady) return listenersReady
  listenersReady = (async () => {
    const { PushNotifications: push } = await pushModule()
    handles = await Promise.all([
      // Fires after register() and whenever FCM rotates the token.
      push.addListener("registration", ({ value }) => {
        storeToken(value)
        if (!wantRegistered) return
        apiService
          .registerPushDevice(value, "android")
          .then(() => debugLog("[Push] Device registered"))
          .catch((err) => debugWarn("[Push] Failed to register device", err))
      }),
      push.addListener("registrationError", (err) => debugWarn("[Push] Registration failed", err)),
      push.addListener("pushNotificationActionPerformed", ({ notification }) => {
        const data = (notification.data ?? {}) as Record<string, string | undefined>
        if (data.type && OPENABLE_TYPES.has(data.type) && data.room_id) {
          onOpen(data.room_id, data.message_id ?? null)
        }
      }),
    ])
  })().catch((err) => {
    listenersReady = null
    debugWarn("[Push] setup failed", err)
  })
  return listenersReady
}

/**
 * Asks for the notification permission (Android 13+) and registers this
 * device for the signed-in user. Safe to call on every login/app start.
 */
export async function registerPush(): Promise<void> {
  if (!isCapacitor()) return
  wantRegistered = true
  try {
    await listenersReady
    const { PushNotifications: push } = await pushModule()
    await push.createChannel({
      id: MENTIONS_CHANNEL_ID,
      name: "Mentions",
      description: "When someone mentions you in a text channel",
      importance: 4,
      visibility: 0,
      vibration: true,
    })
    await push.createChannel({
      id: MESSAGES_CHANNEL_ID,
      name: "New messages",
      description: "Other messages in text channels you haven't muted",
      importance: 3,
      visibility: 0,
      vibration: true,
    })
    let perm = await push.checkPermissions()
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await push.requestPermissions()
    }
    if (perm.receive !== "granted") {
      debugLog("[Push] Notification permission not granted")
      return
    }
    await push.register()
  } catch (err) {
    debugWarn("[Push] register failed", err)
  }
}

/**
 * Logout: stop pushes to this device for the user who is leaving. Resolves
 * within UNREGISTER_TIMEOUT_MS whatever the network or plugin does.
 */
export async function unregisterPush(): Promise<void> {
  if (!isCapacitor()) return
  wantRegistered = false
  const token = storedToken()
  storeToken(null)
  const work = (async () => {
    try {
      if (token) await apiService.unregisterPushDevice(token)
    } catch (err) {
      debugWarn("[Push] Failed to unregister device", err)
    }
    try {
      const { PushNotifications: push } = await pushModule()
      await push.unregister()
    } catch (err) {
      debugWarn("[Push] unregister failed", err)
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      debugWarn("[Push] unregister timed out")
      resolve()
    }, UNREGISTER_TIMEOUT_MS)
  })
  await Promise.race([work, timeout])
  clearTimeout(timer)
}

/** Test hook: forget listeners and state. */
export function resetPushForTests() {
  handles.forEach((h) => void h.remove())
  handles = []
  listenersReady = null
  wantRegistered = false
}
