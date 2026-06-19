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
import type {
  ConnectionCallback,
  DisconnectionCallback,
  MessageCallback,
} from "@/services/websocket"
import { apiService } from "@/services/api"
import { debugLog } from "@/utils/debug"
import type { User, Room, Category, PublicUser, ChatMessage } from "@/types"

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

  const onCleanup = (fn: () => void) => {
    cleanupFns.push(fn)
  }

  const setupWebSocketListeners = () => {
    const onRoomUsers: MessageCallback = (message) => {
      const data = message.data as User[]
      roomStore.setCurrentRoomUsers(data)
    }
    wsService.on("room_users", onRoomUsers)
    onCleanup(() => wsService.off("room_users", onRoomUsers))

    const onChatHistory: MessageCallback = (message) => {
      const data = message.data as { room_id: string; messages: ChatMessage[] }
      chatStore.setMessages(data.room_id, data.messages)
      chatStore.setActiveRoom(data.room_id)
    }
    wsService.on("chat_history", onChatHistory)
    onCleanup(() => wsService.off("chat_history", onChatHistory))

    const onNewMessage: MessageCallback = (message) => {
      const data = message.data as { room_id: string; message: ChatMessage }
      chatStore.addMessage(data.room_id, data.message)
    }
    wsService.on("new_message", onNewMessage)
    onCleanup(() => wsService.off("new_message", onNewMessage))

    const onNicknameChange: MessageCallback = (message) => {
      const data = message.data as { user_id: string; nickname: string }
      roomStore.updateCurrentRoomUser(data.user_id, {
        nickname: data.nickname,
      })
      roomStore.updateUserNickname(data.user_id, data.nickname)
    }
    wsService.on("nickname_change", onNicknameChange)
    onCleanup(() => wsService.off("nickname_change", onNicknameChange))

    const onRoomUserLeft: MessageCallback = (message) => {
      const data = message.data as { room_id: string; user: User }
      roomStore.removeUserFromRoom(data.room_id, data.user.id)

      if (data.user.id === userStore.userId && roomStore.activeRoomId === data.room_id) {
        debugLog("[WebSocket] Current user was kicked from room, cleaning up...")
        roomStore.setActiveRoom(null)
        if (appStore.isMobile) {
          appStore.showRoomsView()
        }
      }
    }
    wsService.on("room_user_left", onRoomUserLeft)
    onCleanup(() => wsService.off("room_user_left", onRoomUserLeft))

    const onConnect: ConnectionCallback = () => {
      appStore.clearError()
    }
    wsService.onConnection(onConnect)
    onCleanup(() => wsService.removeConnectionCallback(onConnect))

    const onDisconnect: DisconnectionCallback = (event) => {
      if (!event.wasClean) {
        appStore.setError("Connection lost. Attempting to reconnect...")
      }
    }
    wsService.onDisconnection(onDisconnect)
    onCleanup(() => wsService.removeDisconnectionCallback(onDisconnect))
  }

  const setupGlobalWebSocketListeners = () => {
    const onRoomCreated: MessageCallback = (message) => {
      const newRoom = message.data as Room
      debugLog("Received room_created event:", newRoom)
      roomStore.addRoom(newRoom)
      debugLog("Added new room to list:", newRoom.name)
    }
    wsService.onGlobal("room_created", onRoomCreated)
    onCleanup(() => wsService.offGlobal("room_created", onRoomCreated))

    const onGlobalNicknameChange: MessageCallback = (message) => {
      const data = message.data as { user_id: string; nickname: string }
      roomStore.updateUserNickname(data.user_id, data.nickname)
      usersStore.updateUserNickname(data.user_id, data.nickname)
    }
    wsService.onGlobal("nickname_change", onGlobalNicknameChange)
    onCleanup(() => wsService.offGlobal("nickname_change", onGlobalNicknameChange))

    const onRoomUserJoined: MessageCallback = (message) => {
      const data = message.data as { room_id: string; user: User }
      roomStore.addUserToRoom(data.room_id, data.user)
    }
    wsService.onGlobal("room_user_joined", onRoomUserJoined)
    onCleanup(() => wsService.offGlobal("room_user_joined", onRoomUserJoined))

    const onGlobalRoomUserLeft: MessageCallback = (message) => {
      const data = message.data as { room_id: string; user: User }
      roomStore.removeUserFromRoom(data.room_id, data.user.id)

      if (data.user.id === userStore.userId && roomStore.activeRoomId === data.room_id) {
        debugLog("[WebSocket] Current user was kicked from room, cleaning up...")
        roomStore.setActiveRoom(null)
        if (appStore.isMobile) {
          appStore.showRoomsView()
        }
      }
    }
    wsService.onGlobal("room_user_left", onGlobalRoomUserLeft)
    onCleanup(() => wsService.offGlobal("room_user_left", onGlobalRoomUserLeft))

    const onCategoryCreated: MessageCallback = (message) => {
      const newCategory = message.data as Category
      debugLog("Received category_created event:", newCategory)
      categoryStore.addCategory(newCategory)
    }
    wsService.onGlobal("category_created", onCategoryCreated)
    onCleanup(() => wsService.offGlobal("category_created", onCategoryCreated))

    const onCategoryRenamed: MessageCallback = (message) => {
      const updatedCategory = message.data as Category
      debugLog("Received category_renamed event:", updatedCategory)
      const oldCategory = categoryStore.getCategoryById(updatedCategory.id)
      if (oldCategory) {
        categoryStore.updateCategory(updatedCategory.id, {
          name: updatedCategory.name,
        })
        debugLog("Renamed category from", oldCategory.name, "to", updatedCategory.name)
      }
    }
    wsService.onGlobal("category_renamed", onCategoryRenamed)
    onCleanup(() => wsService.offGlobal("category_renamed", onCategoryRenamed))

    const onCategoryDeleted: MessageCallback = (message) => {
      const data = message.data as {
        category_id: string
        deleted_rooms: boolean
        migrated_rooms: string[]
        target_category_id: string
      }
      debugLog("Received category_deleted event:", data)
      const deletedCategory = categoryStore.getCategoryById(data.category_id)
      if (deletedCategory) {
        categoryStore.removeCategory(data.category_id)
        debugLog("Deleted category:", deletedCategory.name)
      }
    }
    wsService.onGlobal("category_deleted", onCategoryDeleted)
    onCleanup(() => wsService.offGlobal("category_deleted", onCategoryDeleted))

    const onCategoryOrderUpdated: MessageCallback = (message) => {
      const data = message.data as { orders: Record<string, number> }
      debugLog("Received category_order_updated event:", data)
      categoryStore.reorderCategories(data.orders)
      debugLog("Updated category order")
    }
    wsService.onGlobal("category_order_updated", onCategoryOrderUpdated)
    onCleanup(() => wsService.offGlobal("category_order_updated", onCategoryOrderUpdated))

    const onRoomUpdated: MessageCallback = (message) => {
      const data = message.data as {
        room_id: string
        room: Room
        old_category: string
      }
      debugLog("Received room_updated event:", data)
      roomStore.updateRoom(data.room_id, data.room)
      debugLog("Updated room:", data.room.name)
    }
    wsService.onGlobal("room_updated", onRoomUpdated)
    onCleanup(() => wsService.offGlobal("room_updated", onRoomUpdated))

    const onRoomDeleted: MessageCallback = (message) => {
      const data = message.data as { room_id: string; category: string }
      debugLog("Received room_deleted event:", data)
      roomStore.removeRoom(data.room_id)
      debugLog("Deleted room:", data.room_id)

      if (roomStore.activeRoomId === data.room_id) {
        roomStore.setActiveRoom(null)
        if (appStore.isMobile) {
          appStore.showRoomsView()
        }
      }
    }
    wsService.onGlobal("room_deleted", onRoomDeleted)
    onCleanup(() => wsService.offGlobal("room_deleted", onRoomDeleted))

    const onGlobalConnected: ConnectionCallback = () => {
      debugLog("Global WebSocket connected")
      startGlobalPing()
      void usersStore.fetchAllUsers()
      void syncRoomsData()
    }
    wsService.onGlobalConnection(onGlobalConnected)
    onCleanup(() => wsService.removeGlobalConnectionCallback(onGlobalConnected))

    const onGlobalDisconnected: DisconnectionCallback = (event) => {
      debugLog("Global WebSocket disconnected:", event)
      stopGlobalPing()
    }
    wsService.onGlobalDisconnection(onGlobalDisconnected)
    onCleanup(() => wsService.removeGlobalDisconnectionCallback(onGlobalDisconnected))

    const onPong: MessageCallback = (message) => {
      const data = message.data as { timestamp: number }
      const latency = Date.now() - data.timestamp
      if (latency > 1000) {
        debugLog(`Global WebSocket latency: ${latency}ms`)
      }
    }
    wsService.onGlobal("pong", onPong)
    onCleanup(() => wsService.offGlobal("pong", onPong))

    const onUserOnline: MessageCallback = (message) => {
      const data = message.data as {
        id: string
        nickname: string
        avatar_url?: string
        role: string
        is_online: boolean
      }
      debugLog(
        "[WebSocket] User came online:",
        data.id,
        data.nickname,
        "Current users count:",
        usersStore.allUsers.length,
      )

      const existingUser = usersStore.allUsers.find((u) => u.id === data.id)
      if (existingUser) {
        usersStore.updateOnlineStatus(data.id, true)
      } else {
        usersStore.addUser({
          id: data.id,
          nickname: data.nickname,
          avatar_url: data.avatar_url || "",
          role: data.role as PublicUser["role"],
          is_online: true,
        })
      }
    }
    wsService.onGlobal("user_online", onUserOnline)
    onCleanup(() => wsService.offGlobal("user_online", onUserOnline))

    const onUserOffline: MessageCallback = (message) => {
      const data = message.data as { id: string }
      usersStore.updateOnlineStatus(data.id, false)
    }
    wsService.onGlobal("user_offline", onUserOffline)
    onCleanup(() => wsService.offGlobal("user_offline", onUserOffline))

    const onOnlineUsers: MessageCallback = (message) => {
      const data = message.data as {
        users: Array<{
          id: string
          nickname: string
          avatar_url?: string
          role: string
          is_online: boolean
        }>
      }

      data.users.forEach((user) => {
        usersStore.updateUser({
          id: user.id,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          role: user.role as PublicUser["role"],
          is_online: user.is_online,
        })
      })

      const onlineUserIds = new Set(data.users.map((u) => u.id))
      usersStore.allUsers.forEach((user) => {
        if (user.is_online && !onlineUserIds.has(user.id)) {
          usersStore.updateOnlineStatus(user.id, false)
        }
      })
    }
    wsService.onGlobal("online_users", onOnlineUsers)
    onCleanup(() => wsService.offGlobal("online_users", onOnlineUsers))

    const onAudioStates: MessageCallback = (message) => {
      const data = message.data as {
        states: Array<{
          user_id: string
          room_id: string
          is_muted: boolean
          is_deafened: boolean
        }>
      }
      debugLog("[WebSocket] Received audio_states:", data.states.length, "users")
      data.states.forEach((state) => {
        userStore.updateGlobalUserAudioState(state.user_id, {
          room_id: state.room_id,
          is_muted: state.is_muted,
          is_deafened: state.is_deafened,
        })
      })
    }
    wsService.onGlobal("audio_states", onAudioStates)
    onCleanup(() => wsService.offGlobal("audio_states", onAudioStates))

    const onUserAudioState: MessageCallback = (message) => {
      const data = message.data as {
        user_id: string
        room_id: string
        is_muted: boolean
        is_deafened: boolean
      }
      debugLog(
        "[WebSocket] User audio state changed:",
        data.user_id,
        "room:",
        data.room_id,
        "muted:",
        data.is_muted,
        "deafened:",
        data.is_deafened,
      )
      userStore.updateGlobalUserAudioState(data.user_id, {
        room_id: data.room_id,
        is_muted: data.is_muted,
        is_deafened: data.is_deafened,
      })
    }
    wsService.onGlobal("user_audio_state", onUserAudioState)
    onCleanup(() => wsService.offGlobal("user_audio_state", onUserAudioState))

    const onSoundPackChange: MessageCallback = (message) => {
      const data = message.data as {
        user_id: string
        sound_pack: string
      }
      debugLog("[WebSocket] User sound pack changed:", data.user_id, "sound_pack:", data.sound_pack)
      roomStore.updateUserSoundPack(data.user_id, data.sound_pack)
      soundPackStore.setUserPack(data.user_id, data.sound_pack)
    }
    wsService.onGlobal("sound_pack_change", onSoundPackChange)
    onCleanup(() => wsService.offGlobal("sound_pack_change", onSoundPackChange))
  }

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
        debugLog("Auth token changed, reconnecting global WebSocket")
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

    // If global WS is already connected (e.g. re-mount after admin panel),
    // manually trigger the connection handler to start ping and sync data
    if (wsService.isGlobalConnected()) {
      startGlobalPing()
      void usersStore.fetchAllUsers()
      void syncRoomsData()
    }
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
