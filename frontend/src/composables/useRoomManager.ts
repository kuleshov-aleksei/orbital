import {
  useRoomStore,
  useUserStore,
  useAppStore,
  useCallStore,
  usePermissionsStore,
  useTextChatStore,
} from "@/stores"
import { Permission } from "@/types/permissions"
import { wsService } from "@/services/websocket"
import { apiService, generateNickname, isNetworkError, type ApiError } from "@/services/api"
import { collectSystemInfo } from "@/services/systemInfo"
import type { CreateRoomData, UpdateRoomData, RoomType } from "@/types"
import { loadWorld } from "@/world/WorldData"

// Room ping interval (20 seconds - must be less than backend timeout of 30s)
const ROOM_PING_INTERVAL = 20000
let roomPingInterval: ReturnType<typeof setInterval> | null = null

// Switching rooms (leave + join + socket) gives up after this long, so the
// "Preparing your experience" overlay can't block the app on a dead network.
const ROOM_SWITCH_DEADLINE_MS = 20_000
// Bumped by every switch; a join that finishes after it was superseded or
// timed out must not make its room active.
let roomSwitchId = 0

export function useRoomManager() {
  const roomStore = useRoomStore()
  const userStore = useUserStore()
  const appStore = useAppStore()
  const callStore = useCallStore()
  const permissionsStore = usePermissionsStore()
  const textChatStore = useTextChatStore()

  const NO_JOIN_PERMISSION = "You don't have permission to join this room."

  // Send ping to room WebSocket to keep connection alive
  const sendRoomPing = () => {
    if (wsService.isConnected()) {
      wsService.sendMessage("ping", {
        user_id: userStore.userId,
        timestamp: Date.now(),
      })
    }
  }

  // Start room ping interval
  const startRoomPing = () => {
    if (roomPingInterval) {
      clearInterval(roomPingInterval)
    }
    roomPingInterval = setInterval(sendRoomPing, ROOM_PING_INTERVAL)
    // Send initial ping immediately
    sendRoomPing()
  }

  // Stop room ping interval
  const stopRoomPing = () => {
    if (roomPingInterval) {
      clearInterval(roomPingInterval)
      roomPingInterval = null
    }
  }

  const loadRooms = async () => {
    // With a cached room list on screen, refresh quietly: an unreachable
    // server shows the connection pill, not a blocking overlay.
    const hasCached = roomStore.rooms.length > 0
    try {
      if (!hasCached) appStore.setLoading(true)
      appStore.clearError()
      const rooms = await apiService.getRooms(true)
      roomStore.setRooms(rooms, true)
    } catch (error) {
      console.error("Failed to load rooms:", error)
      if (!(hasCached && isNetworkError(error))) {
        appStore.setError("Failed to load rooms. Please refresh the page.")
      }
    } finally {
      appStore.setLoading(false)
    }
  }

  const joinRoom = async (roomId: string, isStale: () => boolean = () => false) => {
    const userId = userStore.userId

    if (!userId) {
      console.error("Cannot join room: no user ID available")
      appStore.setError("Please authenticate before joining a room")
      return
    }

    // Disconnect existing connection if any
    wsService.disconnect()

    try {
      await apiService.joinRoom(roomId, {
        user_id: userId,
        nickname: userStore.nickname || generateNickname(userId),
      })

      // Collect device info for session analytics (non-fatal: the call still joins on failure)
      let deviceInfo: string | undefined
      try {
        const systemInfo = await collectSystemInfo()
        deviceInfo = JSON.stringify(systemInfo)
      } catch (error) {
        console.error("Failed to collect system info:", error)
      }

      // Connect to WebSocket for new room
      await wsService.connect(roomId, userId, deviceInfo)
      if (isStale()) throw new Error("Room switch abandoned")
      roomStore.setActiveRoom(roomId)

      // Start sending pings to keep room WebSocket connection alive
      startRoomPing()
    } catch (error) {
      console.error("Failed to join room:", error)
      // A socket that never opened (or belongs to an abandoned switch) must
      // not keep retrying join_room behind the user's back.
      if (!roomStore.activeRoomId) wsService.disconnect()
      throw error
    }
  }

  const leaveCurrentRoom = async () => {
    const roomId = roomStore.activeRoomId
    const userId = userStore.userId

    if (!roomId || !userId) return

    try {
      // Stop room ping interval before disconnecting
      stopRoomPing()

      try {
        await apiService.leaveRoom(roomId, userId)
      } catch (error) {
        // Offline: leave locally anyway. The server drops the membership when
        // the room socket closes.
        if (!isNetworkError(error)) throw error
        console.warn("Leave request failed (network), leaving locally:", error)
      }
      wsService.sendMessage("leave_room", { user_id: userId })
      wsService.disconnect()
      roomStore.setCurrentRoomUsers([])
    } catch (error) {
      console.error("Failed to leave current room:", error)
      throw error
    }
  }

  /** Returns whether the room was joined (or already active). */
  const handleRoomSelected = async (roomId: string): Promise<boolean> => {
    // Text channels open next to the call: no join, no leaving voice.
    const selected = roomStore.rooms.find((r) => r.id === roomId)
    if (selected?.type === "text") {
      void textChatStore.openChannel(roomId)
      return true
    }
    // Picking a voice room closes the text channel view.
    textChatStore.closeChannel()

    if (roomStore.activeRoomId === roomId) {
      // Clicking the room again while voice is down retries the connection.
      if (callStore.voiceConnectionFailed) callStore.requestVoiceRetry()
      return true
    }

    // Eagerly start world data fetch for spatial_audio rooms
    const pendingRoom = roomStore.rooms.find((r) => r.id === roomId)
    if (pendingRoom?.type === "spatial_audio" && pendingRoom.world) {
      loadWorld(pendingRoom.world).catch(() => {})
    }

    // Check before leaving the current room, so a locked room doesn't kick you
    // out of the one you're in. The backend re-checks on join.
    if (permissionsStore.loaded && !permissionsStore.can(Permission.Connect, { roomId })) {
      appStore.setError(NO_JOIN_PERMISSION)
      return false
    }

    const switchId = ++roomSwitchId
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      appStore.setLoading(true)
      appStore.clearError()

      // If already in a room, leave it first using handleLeaveRoom
      // This ensures proper cleanup including setting activeRoomId to null
      if (roomStore.activeRoomId) {
        await handleLeaveRoom()
        // Even if leaving failed, the old room must not stay active: the
        // call view would keep its LiveKit session for the wrong room.
        if (roomStore.activeRoomId) {
          stopRoomPing()
          wsService.disconnect()
          roomStore.setActiveRoom(null)
          callStore.resetCallState()
        }
        // Small delay to ensure cleanup is complete before joining new room
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      const join = joinRoom(roomId, () => switchId !== roomSwitchId)
      join.catch(() => {}) // may settle after the deadline; reported below
      await Promise.race([
        join,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("Room switch timed out")),
            ROOM_SWITCH_DEADLINE_MS,
          )
        }),
      ])
      return true
    } catch (error) {
      console.error("Failed to switch room:", error)
      if (switchId === roomSwitchId) roomSwitchId++ // abandon the join in flight
      const status = (error as ApiError).status
      appStore.setError(
        status === 403
          ? NO_JOIN_PERMISSION
          : status === 404
            ? "This room is no longer available."
            : isNetworkError(error) || (error as Error).message === "Room switch timed out"
              ? "Can't reach the server. Check your connection and try again."
              : "Failed to switch room. Please try again.",
      )
      return false
    } finally {
      clearTimeout(deadline)
      appStore.setLoading(false)
    }
  }

  const handleLeaveRoom = async () => {
    try {
      await leaveCurrentRoom()
      roomStore.setActiveRoom(null)
      callStore.resetCallState()

      // On mobile, return to room list view
      if (appStore.isMobile) {
        appStore.showRoomsView()
      }
    } catch (error) {
      console.error("Failed to leave room:", error)
      appStore.setError("Failed to leave room.")
    }
  }

  const handleRoomSelectedMobile = async (roomId: string) => {
    if (await handleRoomSelected(roomId)) {
      appStore.showRoomView()
    }
  }

  const createRoom = async (
    roomName: string,
    category: string,
    maxUsers: number,
    roomType: string,
    world?: string,
  ) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      const roomData: CreateRoomData = {
        name: roomName,
        category,
        max_users: maxUsers,
        type: roomType as RoomType,
        world: roomType === "spatial_audio" ? world : undefined,
      }

      await apiService.createRoom(roomData)
    } catch (error) {
      console.error("Failed to create room:", error)
      appStore.setError("Failed to create room. Please try again.")
      throw error
    } finally {
      appStore.setLoading(false)
    }
  }

  const updateRoom = async (roomId: string, name: string, maxUsers: number, world?: string) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      const updates: UpdateRoomData = { name, max_users: maxUsers, world }
      await apiService.updateRoom(roomId, updates)
    } catch (error) {
      console.error("Failed to update room:", error)
      appStore.setError("Failed to update room. Please try again.")
      throw error
    } finally {
      appStore.setLoading(false)
    }
  }

  const moveRoomToCategory = async (roomId: string, targetCategoryId: string) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      await apiService.updateRoom(roomId, { category: targetCategoryId })
    } catch (error) {
      console.error("Failed to move room:", error)
      appStore.setError("Failed to move room. Please try again.")
      throw error
    } finally {
      appStore.setLoading(false)
    }
  }

  const deleteRoom = async (roomId: string) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      await apiService.deleteRoom(roomId)
      roomStore.removeRoom(roomId)

      // If the deleted room was active, handle cleanup
      if (roomStore.activeRoomId === roomId) {
        roomStore.setActiveRoom(null)
        roomStore.setCurrentRoomUsers([])
        if (appStore.isMobile) {
          appStore.showRoomsView()
        }
      }
    } catch (error) {
      console.error("Failed to delete room:", error)
      appStore.setError("Failed to delete room. Please try again.")
      throw error
    } finally {
      appStore.setLoading(false)
    }
  }

  return {
    loadRooms,
    joinRoom,
    leaveCurrentRoom,
    handleRoomSelected,
    handleLeaveRoom,
    handleRoomSelectedMobile,
    createRoom,
    updateRoom,
    moveRoomToCategory,
    deleteRoom,
  }
}
