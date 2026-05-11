<template>
  <div
    id="app"
    :data-theme="themeStore.currentTheme"
    class="h-screen bg-theme-bg-primary text-theme-text-primary">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue"
import { useRouter } from "vue-router"
import { useAppStore, useRoomStore, useThemeStore, useUserStore } from "@/stores"
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts"
import { isElectron, onDeepLink, onOAuthToken } from "@/services/electron"
import { setAuthToken, apiService, getAuthToken } from "@/services/api"

const router = useRouter()
const appStore = useAppStore()
const roomStore = useRoomStore()
const themeStore = useThemeStore()
const userStore = useUserStore()

useKeyboardShortcuts()

const checkMobile = () => {
  appStore.checkMobile()
}

const handleBeforeUnload = (e: BeforeUnloadEvent) => {
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

  if (isElectron()) {
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
        userStore.handleOAuthCallback(data.token, {
          id: user.id,
          nickname: user.nickname,
          authProvider: user.auth_provider,
          isGuest: user.is_guest,
          role: user.role,
          email: user.email,
          avatarUrl: user.avatar_url,
        })
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
})
</script>
