import { onMounted, onUnmounted, watch, ref } from "vue"
import {
  useRoomStore,
  useCategoryStore,
  useAppStore,
  useUserStore,
  useUsersStore,
} from "@/stores"
import { wsService } from "@/services/websocket"
import type { User, Room, Category } from "@/types"

export function useWebSocketHandlers() {
  const roomStore = useRoomStore()
  const categoryStore = useCategoryStore()
  const appStore = useAppStore()
  const usersStore = useUsersStore()
  const userStore = useUserStore()
  const hasConnected = ref(false)

  const setupWebSocketListeners = () => {
    // Room users updates
    wsService.on("room_users", (message) => {
      const data = message.data as User[]
      roomStore.setCurrentRoomUsers(data)
    })

    // Nickname change updates
    wsService.on("nickname_change", (message) => {
      const data = message.data as { user_id: string; nickname: string }
      roomStore.updateCurrentRoomUser(data.user_id, {
        nickname: data.nickname,
      })
      roomStore.updateUserNickname(data.user_id, data.nickname)
    })

    // Connection/disconnection
    wsService.onConnection(() => {
      appStore.clearError()
    })

    wsService.onDisconnection((event) => {
      if (!event.wasClean) {
        appStore.setError("Connection lost. Attempting to reconnect...")
      }
    })
  }

  const setupGlobalWebSocketListeners = () => {
    // Room creation
    wsService.onGlobal("room_created", (message) => {
      const newRoom = message.data as Room
      console.log("Received room_created event:", newRoom)
      roomStore.addRoom(newRoom)
      console.log("Added new room to list:", newRoom.name)
    })

    // Nickname changes
    wsService.onGlobal("nickname_change", (message) => {
      const data = message.data as { user_id: string; nickname: string }
      roomStore.updateUserNickname(data.user_id, data.nickname)
    })

    // Room user joined
    wsService.onGlobal("room_user_joined", (message) => {
      const data = message.data as { room_id: string; user: User }
      roomStore.addUserToRoom(data.room_id, data.user)
    })

    // Room user left
    wsService.onGlobal("room_user_left", (message) => {
      const data = message.data as { room_id: string; user: User }
      roomStore.removeUserFromRoom(data.room_id, data.user.id)
    })

    // Category events
    wsService.onGlobal("category_created", (message) => {
      const newCategory = message.data as Category
      console.log("Received category_created event:", newCategory)
      categoryStore.addCategory(newCategory)
    })

    wsService.onGlobal("category_renamed", (message) => {
      const updatedCategory = message.data as Category
      console.log("Received category_renamed event:", updatedCategory)
      const oldCategory = categoryStore.getCategoryById(updatedCategory.id)
      if (oldCategory) {
        categoryStore.updateCategory(updatedCategory.id, {
          name: updatedCategory.name,
        })
        console.log(
          "Renamed category from",
          oldCategory.name,
          "to",
          updatedCategory.name,
        )
      }
    })

    wsService.onGlobal("category_deleted", (message) => {
      const data = message.data as {
        category_id: string
        deleted_rooms: boolean
        migrated_rooms: string[]
        target_category_id: string
      }
      console.log("Received category_deleted event:", data)
      const deletedCategory = categoryStore.getCategoryById(data.category_id)

      if (deletedCategory) {
        categoryStore.removeCategory(data.category_id)
        console.log("Deleted category:", deletedCategory.name)
      }
    })

    // Category order updated
    wsService.onGlobal("category_order_updated", (message) => {
      const data = message.data as { orders: Record<string, number> }
      console.log("Received category_order_updated event:", data)
      categoryStore.reorderCategories(data.orders)
      console.log("Updated category order")
    })

    // Room updates
    wsService.onGlobal("room_updated", (message) => {
      const data = message.data as {
        room_id: string
        room: Room
        old_category: string
      }
      console.log("Received room_updated event:", data)
      roomStore.updateRoom(data.room_id, data.room)
      console.log("Updated room:", data.room.name)
    })

    // Room deletion
    wsService.onGlobal("room_deleted", (message) => {
      const data = message.data as { room_id: string; category: string }
      console.log("Received room_deleted event:", data)
      roomStore.removeRoom(data.room_id)
      console.log("Deleted room:", data.room_id)

      // If the deleted room was active, leave it
      if (roomStore.activeRoomId === data.room_id) {
        roomStore.setActiveRoom(null)
        if (appStore.isMobile) {
          appStore.showRoomsView()
        }
      }
    })

    // Connection events
    wsService.onGlobalConnection(() => {
      console.log("Global WebSocket connected")
      // Start sending pings to keep connection alive and trigger periodic user list updates
      startGlobalPing()
      // Refetch users to get updated online status now that we're connected
      void usersStore.fetchAllUsers()
    })

    wsService.onGlobalDisconnection((event) => {
      console.log("Global WebSocket disconnected:", event)
      stopGlobalPing()
    })

    // Pong response (for latency tracking)
    wsService.onGlobal("pong", (message) => {
      const data = message.data as { timestamp: number }
      const latency = Date.now() - data.timestamp
      if (latency > 1000) {
        console.log(`Global WebSocket latency: ${latency}ms`)
      }
    })

    // User online/offline events for global presence
    wsService.onGlobal("user_online", (message) => {
      const data = message.data as {
        id: string
        nickname: string
        avatar_url?: string
        role: string
        is_online: boolean
      }
      console.log(
        "[WebSocket] User came online:",
        data.id,
        data.nickname,
        "Current users count:",
        usersStore.allUsers.length,
      )

      // Check if user already exists
      const existingUser = usersStore.allUsers.find((u) => u.id === data.id)
      if (existingUser) {
        console.log("[WebSocket] Updating existing user:", data.id)
        usersStore.updateOnlineStatus(data.id, true)
      } else {
        console.log("[WebSocket] Adding new user:", data.id)
        // Add new user with full data
        usersStore.addUser({
          id: data.id,
          nickname: data.nickname,
          avatar_url: data.avatar_url || "",
          role: data.role,
          is_online: true,
        })
      }
      console.log(
        "[WebSocket] After update, users count:",
        usersStore.allUsers.length,
      )
    })

    wsService.onGlobal("user_offline", (message) => {
      const data = message.data as { id: string }
      console.log("[WebSocket] User went offline:", data.id)
      usersStore.updateOnlineStatus(data.id, false)
    })

    // Full online users list (broadcast every 30 seconds)
    wsService.onGlobal("online_users", (message) => {
      const data = message.data as {
        users: Array<{
          id: string
          nickname: string
          avatar_url?: string
          role: string
          is_online: boolean
        }>
      }
      console.log(
        "[WebSocket] Received online users list:",
        data.users.length,
        "users",
      )

      // Update all users with their online status from the broadcast
      data.users.forEach((user) => {
        usersStore.updateUser({
          id: user.id,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          role: user.role,
          is_online: user.is_online,
        })
      })

      // Mark users not in the online list as offline
      const onlineUserIds = new Set(data.users.map((u) => u.id))
      usersStore.allUsers.forEach((user) => {
        if (user.is_online && !onlineUserIds.has(user.id)) {
          usersStore.updateOnlineStatus(user.id, false)
        }
      })
    })
  }

  const connectGlobalWebSocket = async () => {
    try {
      await wsService.connectGlobal()
    } catch (error) {
      console.error("Failed to connect global WebSocket:", error)
    }
  }

  // Watch for token changes to reconnect WebSocket with new auth
  watch(
    () => userStore.token,
    async (newToken, oldToken) => {
      // Only reconnect if:
      // 1. We have a new token
      // 2. We had an old token (not initial load)
      // 3. The tokens are actually different
      // This prevents reconnection when the same tab loads the token from localStorage
      if (newToken && oldToken && newToken !== oldToken) {
        console.log("Auth token changed, reconnecting global WebSocket")
        // Wait for disconnect to complete before reconnecting to avoid race conditions
        await wsService.disconnectGlobal()
        await connectGlobalWebSocket()
      }
    },
  )

  // Global ping interval (20 seconds - must be less than backend timeout of 30s)
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
    // Send initial ping immediately
    sendGlobalPing()
  }

  const stopGlobalPing = () => {
    if (globalPingInterval) {
      clearInterval(globalPingInterval)
      globalPingInterval = null
    }
  }

  // Connect to WebSocket only after auth is complete
  const connectIfAuthenticated = () => {
    if (userStore.hasCompletedAuth && !hasConnected.value) {
      console.log("[WebSocket] Auth completed, connecting WebSocket")
      hasConnected.value = true
      void connectGlobalWebSocket()
    }
  }

  // Auto-initialize on mount
  onMounted(() => {
    setupWebSocketListeners()
    setupGlobalWebSocketListeners()

    // Only connect if already authenticated
    connectIfAuthenticated()
  })

  // Watch for auth completion and connect when ready
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
    void wsService.disconnectGlobal()
    hasConnected.value = false
  })

  return {
    setupWebSocketListeners,
    setupGlobalWebSocketListeners,
    connectGlobalWebSocket,
  }
}
