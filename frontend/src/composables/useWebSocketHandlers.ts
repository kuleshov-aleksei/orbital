import { onMounted, onUnmounted, watch, ref } from "vue"
import {
  useRoomStore,
  useCategoryStore,
  useAppStore,
  useUserStore,
  useUsersStore,
  useSoundPackStore,
  useChatStore,
} from "@/stores"
import { wsService } from "@/services/websocket"
import type { ConnectionCallback, DisconnectionCallback } from "@/services/websocket"
import { apiService } from "@/services/api"
import { debugLog } from "@/utils/debug"
import { setupChatHandlers } from "./handlers/chat"
import { setupUserHandlers } from "./handlers/user"
import { setupRoomHandlers } from "./handlers/room"
import { setupSoundPackHandlers } from "./handlers/soundPack"

export function useWebSocketHandlers() {
  const roomStore = useRoomStore()
  const categoryStore = useCategoryStore()
  const appStore = useAppStore()
  const usersStore = useUsersStore()
  const userStore = useUserStore()
  const soundPackStore = useSoundPackStore()
  const chatStore = useChatStore()
  const hasConnected = ref(false)

  const cleanupFns: Array<() => void> = []

  const connectGlobalWebSocket = async () => {
    try {
      await wsService.connectGlobal()
    } catch (error) {
      console.error("Failed to connect global WebSocket:", error)
    }
  }

  const syncRoomsData = async () => {
    try {
      const rooms = await apiService.getRooms(true)
      roomStore.setRooms(rooms)
      debugLog("[WebSocket] Synced room data after global reconnect")
    } catch (error) {
      console.error("Failed to sync rooms data:", error)
    }
  }

  const GLOBAL_PING_INTERVAL = 20000
  let globalPingInterval: ReturnType<typeof setInterval> | null = null

  const sendGlobalPing = () => {
    if (wsService.isGlobalConnected()) {
      wsService.sendGlobalMessage("ping", {
        user_id: userStore.userId,
        timestamp: Date.now(),
      })
    }
  }

  const startGlobalPing = () => {
    if (globalPingInterval) {
      clearInterval(globalPingInterval)
    }
    globalPingInterval = setInterval(sendGlobalPing, GLOBAL_PING_INTERVAL)
    sendGlobalPing()
  }

  const stopGlobalPing = () => {
    if (globalPingInterval) {
      clearInterval(globalPingInterval)
      globalPingInterval = null
    }
  }

  const setupWebSocketListeners = () => {
    const onConnect: ConnectionCallback = () => {
      appStore.clearError()
    }
    wsService.onConnection(onConnect)
    cleanupFns.push(() => wsService.removeConnectionCallback(onConnect))

    const onDisconnect: DisconnectionCallback = (event) => {
      if (!event.wasClean) {
        appStore.setError("Connection lost. Attempting to reconnect...")
      }
    }
    wsService.onDisconnection(onDisconnect)
    cleanupFns.push(() => wsService.removeDisconnectionCallback(onDisconnect))
  }

  const setupGlobalWebSocketListeners = () => {
    const onGlobalConnected: ConnectionCallback = () => {
      debugLog("Global WebSocket connected")
      startGlobalPing()
      void usersStore.fetchAllUsers()
      void syncRoomsData()
    }
    wsService.onGlobalConnection(onGlobalConnected)
    cleanupFns.push(() => wsService.removeGlobalConnectionCallback(onGlobalConnected))

    const onGlobalDisconnected: DisconnectionCallback = (event) => {
      debugLog("Global WebSocket disconnected:", event)
      stopGlobalPing()
    }
    wsService.onGlobalDisconnection(onGlobalDisconnected)
    cleanupFns.push(() => wsService.removeGlobalDisconnectionCallback(onGlobalDisconnected))
  }

  const connectIfAuthenticated = () => {
    if (userStore.hasCompletedAuth && !hasConnected.value) {
      hasConnected.value = true
      void connectGlobalWebSocket()
    }
  }

  watch(
    () => userStore.token,
    async (newToken, oldToken) => {
      if (newToken && oldToken && newToken !== oldToken) {
        debugLog("Auth token changed, reconnecting global WebSocket")
        await wsService.disconnectGlobal()
        await connectGlobalWebSocket()
      }
    },
  )

  onMounted(() => {
    setupWebSocketListeners()
    setupGlobalWebSocketListeners()
    setupChatHandlers(chatStore, cleanupFns)
    setupUserHandlers(roomStore, usersStore, userStore, cleanupFns)
    setupRoomHandlers(roomStore, categoryStore, appStore, userStore, cleanupFns)
    setupSoundPackHandlers(roomStore, soundPackStore, cleanupFns)

    connectIfAuthenticated()

    if (wsService.isGlobalConnected()) {
      startGlobalPing()
      void usersStore.fetchAllUsers()
      void syncRoomsData()
    }
  })

  watch(
    () => userStore.hasCompletedAuth,
    (hasCompleted) => {
      if (hasCompleted) {
        connectIfAuthenticated()
      }
    },
  )

  onUnmounted(() => {
    stopGlobalPing()
    wsService.disconnect()
    hasConnected.value = false
    for (const cleanup of cleanupFns) {
      cleanup()
    }
    cleanupFns.length = 0
  })

  return {
    setupWebSocketListeners,
    setupGlobalWebSocketListeners,
    connectGlobalWebSocket,
  }
}
