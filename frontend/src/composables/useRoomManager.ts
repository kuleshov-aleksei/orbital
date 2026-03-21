import { useRoomStore, useUserStore, useAppStore, useCallStore } from "@/stores"
import { wsService } from "@/services/websocket"
import { apiService, generateNickname } from "@/services/api"
import type { CreateRoomData, UpdateRoomData } from "@/types"

// Room ping interval (20 seconds - must be less than backend timeout of 30s)
const ROOM_PING_INTERVAL = 20000
let roomPingInterval: ReturnType<typeof setInterval> | null = null

export function useRoomManager() {
  const roomStore = useRoomStore()
  const userStore = useUserStore()
  const appStore = useAppStore()
  const callStore = useCallStore()

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
    try {
      appStore.setLoading(true)
      appStore.clearError()
      const rooms = await apiService.getRooms(true)
      roomStore.setRooms(rooms)
    } catch (error) {
      console.error("Failed to load rooms:", error)
      appStore.setError("Failed to load rooms. Please refresh the page.")
    } finally {
      appStore.setLoading(false)
    }
  }

  const joinRoom = async (roomId: string) => {
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

      // Connect to WebSocket for new room
      await wsService.connect(roomId, userId)
      roomStore.setActiveRoom(roomId)

      // Start sending pings to keep room WebSocket connection alive
      startRoomPing()
    } catch (error) {
      console.error("Failed to join room:", error)
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

      await apiService.leaveRoom(roomId, userId)
      wsService.sendMessage("leave_room", { user_id: userId })
      wsService.disconnect()
      roomStore.setCurrentRoomUsers([])
    } catch (error) {
      console.error("Failed to leave current room:", error)
      throw error
    }
  }

  const handleRoomSelected = async (roomId: string) => {
    if (roomStore.activeRoomId === roomId) {
      return
    }

    try {
      appStore.setLoading(true)
      appStore.clearError()

      // If already in a room, leave it first using handleLeaveRoom
      // This ensures proper cleanup including setting activeRoomId to null
      if (roomStore.activeRoomId) {
        await handleLeaveRoom()
        // Small delay to ensure cleanup is complete before joining new room
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      await joinRoom(roomId)
    } catch (error) {
      console.error("Failed to switch room:", error)
      appStore.setError("Failed to switch room. Please try again.")
    } finally {
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
    await handleRoomSelected(roomId)
    appStore.showRoomView()
  }

  const createRoom = async (roomName: string, category: string, maxUsers: number) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      const roomData: CreateRoomData = {
        name: roomName,
        category,
        max_users: maxUsers,
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

  const updateRoom = async (roomId: string, name: string, maxUsers: number) => {
    try {
      appStore.setLoading(true)
      appStore.clearError()

      const updates: UpdateRoomData = { name, max_users: maxUsers }
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
    rooms: roomStore.rooms,
    activeRoomId: roomStore.activeRoomId,
    currentRoomUsers: roomStore.currentRoomUsers,
    remoteStreamVolumes: roomStore.remoteStreamVolumes,
    activeRoomName: roomStore.activeRoomName,
    isInRoom: roomStore.isInRoom,
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
