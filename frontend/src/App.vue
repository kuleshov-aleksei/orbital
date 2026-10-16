<template>
  <div
    id="app"
    :data-theme="themeStore.currentTheme"
    class="h-dvh bg-theme-bg-primary text-theme-text-primary">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue"
import { useRouter } from "vue-router"
import { useAppStore, useRoomStore, useThemeStore, useUserStore } from "@/stores"
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts"
import { useThumbarButtons, useWebSocketHandlers } from "@/composables"
import { isElectron, onDeepLink, onOAuthToken, setupMainProcessLogRelay } from "@/services/electron"
import {
  setAuthToken,
  apiService,
  getAuthToken,
  isTokenExpired,
  tokenNeedsRefresh,
  setOnSessionExpired,
} from "@/services/api"

const router = useRouter()
const appStore = useAppStore()
const roomStore = useRoomStore()
const themeStore = useThemeStore()
const userStore = useUserStore()

useKeyboardShortcuts()
useThumbarButtons()
useWebSocketHandlers()

const SESSION_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
let sessionRefreshInterval: ReturnType<typeof setInterval> | null = null

// Keep an active session alive: slide the JWT forward while it is still valid,
// or drop to the auth view once it has truly expired.
const refreshSessionIfNeeded = async () => {
  if (!getAuthToken()) return
  if (isTokenExpired()) {
    userStore.handleSessionExpired()
    return
  }
  if (tokenNeedsRefresh()) {
    try {
      await apiService.refreshToken()
      console.log("[Auth] Session token refreshed")
    } catch (error) {
      console.warn("[Auth] Session refresh failed:", error)
    }
  }
}

const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") void refreshSessionIfNeeded()
}
const handleWindowFocus = () => void refreshSessionIfNeeded()
const handleOnline = () => void refreshSessionIfNeeded()

const checkMobile = () => {
  appStore.checkMobile()
}

const handleBeforeUnload = (e: BeforeUnloadEvent) => {
  if (isElectron()) return

  if (roomStore.isInRoom) {
    e.preventDefault()
    e.returnValue = ""
    return
  }
}

const cleanupOnUnload = () => {
  const roomId = roomStore.activeRoomId
  const userId = userStore.userId

  if (!roomId || !userId) return

  const token = getAuthToken()
  if (token) {
    const data = JSON.stringify({ user_id: userId })
    navigator.sendBeacon(`/api/rooms/${roomId}/leave`, data)
  }

  const ws = window.location.protocol === "https:" ? "wss:" : "ws:"
  const wsUrl = `${ws}//${window.location.host}/ws/${roomId}`
  const wsLeave = new WebSocket(wsUrl)
  wsLeave.onopen = () => {
    const msg = JSON.stringify({ type: "leave_room", data: { user_id: userId } })
    wsLeave.send(msg)
    wsLeave.close()
  }
}

watch(
  () => themeStore.currentTheme,
  (newTheme) => {
    document.body.dataset.theme = newTheme
  },
  { immediate: true },
)

watch(
  () => appStore.isMobile,
  (isMobile) => {
    if (isMobile && roomStore.activeRoomId && appStore.mobileView === "rooms") {
      appStore.showRoomView()
    }
  },
)

onMounted(() => {
  checkMobile()
  window.addEventListener("resize", checkMobile)
  window.addEventListener("beforeunload", handleBeforeUnload)
  window.addEventListener("unload", cleanupOnUnload)
  roomStore.loadUserVolumes()

  // Route 401-driven session loss through the user store so the AuthView
  // reappears with an explanation.
  setOnSessionExpired(() => userStore.handleSessionExpired())

  // Proactive session lifecycle: refresh before expiry, or surface the auth
  // view when the token already lapsed (long sleep / idle / backgrounded tab).
  void refreshSessionIfNeeded()
  document.addEventListener("visibilitychange", handleVisibilityChange)
  window.addEventListener("focus", handleWindowFocus)
  window.addEventListener("online", handleOnline)
  sessionRefreshInterval = setInterval(
    () => void refreshSessionIfNeeded(),
    SESSION_REFRESH_INTERVAL_MS,
  )

  if (isElectron()) {
    setupMainProcessLogRelay()

    onDeepLink((url: string) => {
      console.log("[App] Deep link received:", url.substring(0, 30) + "...")
      if (url.startsWith("orbital://auth/callback")) {
        router.push(url.replace("orbital://", "/"))
      }
    })

    onOAuthToken(async (data: { token: string; expires: string }) => {
      console.log("[App] OAuth token received:", data.token.substring(0, 20) + "...")
      try {
        setAuthToken(data.token)
        const user = await apiService.getCurrentUser()
        userStore.handleOAuthCallback(
          data.token,
          {
            id: user.id,
            nickname: user.nickname,
            authProvider: user.auth_provider,
            isGuest: user.is_guest,
            role: user.role,
            email: user.email,
            avatarUrl: user.avatar_url,
          },
          data.expires,
        )
        console.log("[App] OAuth login successful!")
      } catch (error) {
        console.error("[App] OAuth login failed:", error)
      }
    })
  }
})

onUnmounted(() => {
  window.removeEventListener("resize", checkMobile)
  window.removeEventListener("beforeunload", handleBeforeUnload)
  window.removeEventListener("unload", cleanupOnUnload)
  document.removeEventListener("visibilitychange", handleVisibilityChange)
  window.removeEventListener("focus", handleWindowFocus)
  window.removeEventListener("online", handleOnline)
  if (sessionRefreshInterval) {
    clearInterval(sessionRefreshInterval)
    sessionRefreshInterval = null
  }
  setOnSessionExpired(null)
})
</script>
