import { onMounted, onUnmounted } from 'vue'
import { useRoomStore, useCategoryStore, useAppStore } from '@/stores'
import { wsService, type WebSocketMessage } from '@/services/websocket'
import type { User, Room, Category } from '@/types'

export function useWebSocketHandlers() {
  const roomStore = useRoomStore()
  const categoryStore = useCategoryStore()
  const appStore = useAppStore()

  const setupWebSocketListeners = () => {
    // Room users updates
    wsService.on('room_users', (message: WebSocketMessage<User[]>) => {
      roomStore.setCurrentRoomUsers(message.data)
    })

    // Speaking status updates
    wsService.on('speaking_status', (message: WebSocketMessage<{ user_id: string; is_speaking: boolean; is_muted?: boolean }>) => {
      const statusData = message.data
      roomStore.updateCurrentRoomUser(statusData.user_id, { 
        is_speaking: statusData.is_speaking,
        is_muted: statusData.is_muted
      })
      roomStore.updateUserStatus(statusData.user_id, {
        is_speaking: statusData.is_speaking,
        is_muted: statusData.is_muted
      })
    })

    // Mute status updates
    wsService.on('mute_status', (message: WebSocketMessage<{ user_id: string; is_muted: boolean }>) => {
      const statusData = message.data
      roomStore.updateCurrentRoomUser(statusData.user_id, { is_muted: statusData.is_muted })
      roomStore.updateUserStatus(statusData.user_id, { is_muted: statusData.is_muted })
    })

    // Deafen status updates
    wsService.on('deafen_status', (message: WebSocketMessage<{ user_id: string; is_deafened: boolean }>) => {
      const statusData = message.data
      console.log('Room deafen_status received:', statusData)
      roomStore.updateCurrentRoomUser(statusData.user_id, { is_deafened: statusData.is_deafened })
      roomStore.updateUserStatus(statusData.user_id, { is_deafened: statusData.is_deafened })
    })

    // Screen share start
    wsService.on('screen_share_start', (message: WebSocketMessage<{ user_id: string; quality: string }>) => {
      const shareData = message.data
      roomStore.updateCurrentRoomUser(shareData.user_id, { is_screen_sharing: true, screen_share_quality: shareData.quality })
      roomStore.updateUserStatus(shareData.user_id, { is_screen_sharing: true })
    })

    // Screen share stop
    wsService.on('screen_share_stop', (message: WebSocketMessage<{ user_id: string }>) => {
      const stopData = message.data
      roomStore.updateCurrentRoomUser(stopData.user_id, { is_screen_sharing: false })
      roomStore.updateUserStatus(stopData.user_id, { is_screen_sharing: false })
    })

    // Nickname change updates
    wsService.on('nickname_change', (message: WebSocketMessage<{ user_id: string; nickname: string }>) => {
      const nicknameData = message.data
      roomStore.updateCurrentRoomUser(nicknameData.user_id, { nickname: nicknameData.nickname })
      roomStore.updateUserNickname(nicknameData.user_id, nicknameData.nickname)
    })

    // Connection/disconnection
    wsService.onConnection(() => {
      appStore.clearError()
    })

    wsService.onDisconnection((event) => {
      if (!event.wasClean) {
        appStore.setError('Connection lost. Attempting to reconnect...')
      }
    })
  }

  const setupGlobalWebSocketListeners = () => {
    // Room creation
    wsService.onGlobal('room_created', (message: WebSocketMessage<Room>) => {
      const newRoom = message.data
      console.log('Received room_created event:', newRoom)
      roomStore.addRoom(newRoom)
      console.log('Added new room to list:', newRoom.name)
    })

    // Global status updates
    wsService.onGlobal('speaking_status', (message: WebSocketMessage<{ user_id: string; is_speaking: boolean; is_muted?: boolean }>) => {
      const statusData = message.data
      roomStore.updateUserStatus(statusData.user_id, {
        is_speaking: statusData.is_speaking,
        is_muted: statusData.is_muted
      })
    })

    wsService.onGlobal('mute_status', (message: WebSocketMessage<{ user_id: string; is_muted: boolean }>) => {
      const statusData = message.data
      roomStore.updateUserStatus(statusData.user_id, { is_muted: statusData.is_muted })
    })

    wsService.onGlobal('deafen_status', (message: WebSocketMessage<{ user_id: string; is_deafened: boolean }>) => {
      const statusData = message.data
      console.log('Global deafen_status received:', statusData)
      roomStore.updateUserStatus(statusData.user_id, { is_deafened: statusData.is_deafened })
    })

    // Screen share updates for sidebar
    wsService.onGlobal('screen_share_start', (message: WebSocketMessage<{ user_id: string; quality: string }>) => {
      const shareData = message.data
      roomStore.updateUserStatus(shareData.user_id, { is_screen_sharing: true })
    })

    wsService.onGlobal('screen_share_stop', (message: WebSocketMessage<{ user_id: string }>) => {
      const stopData = message.data
      roomStore.updateUserStatus(stopData.user_id, { is_screen_sharing: false })
    })

    // Nickname changes
    wsService.onGlobal('nickname_change', (message: WebSocketMessage<{ user_id: string; nickname: string }>) => {
      const nicknameData = message.data
      roomStore.updateUserNickname(nicknameData.user_id, nicknameData.nickname)
    })

    // Room user joined
    wsService.onGlobal('room_user_joined', (message: WebSocketMessage<{ room_id: string; user: User }>) => {
      const data = message.data
      roomStore.addUserToRoom(data.room_id, data.user)
    })

    // Room user left
    wsService.onGlobal('room_user_left', (message: WebSocketMessage<{ room_id: string; user: User }>) => {
      const data = message.data
      roomStore.removeUserFromRoom(data.room_id, data.user.id)
    })

    // Category events
    wsService.onGlobal('category_created', (message: WebSocketMessage<Category>) => {
      const newCategory = message.data
      console.log('Received category_created event:', newCategory)
      categoryStore.addCategory(newCategory)
    })

    wsService.onGlobal('category_renamed', (message: WebSocketMessage<Category>) => {
      const updatedCategory = message.data
      console.log('Received category_renamed event:', updatedCategory)
      const oldCategory = categoryStore.getCategoryById(updatedCategory.id)
      if (oldCategory) {
        categoryStore.updateCategory(updatedCategory.id, { name: updatedCategory.name })
        console.log('Renamed category from', oldCategory.name, 'to', updatedCategory.name)
      }
    })

    wsService.onGlobal('category_deleted', (message: WebSocketMessage<{ 
      category_id: string
      deleted_rooms: boolean
      migrated_rooms: string[]
      target_category_id: string 
    }>) => {
      const data = message.data
      console.log('Received category_deleted event:', data)
      const deletedCategory = categoryStore.getCategoryById(data.category_id)
      
      if (deletedCategory) {
        categoryStore.removeCategory(data.category_id)
        console.log('Deleted category:', deletedCategory.name)
      }
    })

    // Room updates
    wsService.onGlobal('room_updated', (message: WebSocketMessage<{ room_id: string; room: Room; old_category: string }>) => {
      const data = message.data
      console.log('Received room_updated event:', data)
      roomStore.updateRoom(data.room_id, data.room)
      console.log('Updated room:', data.room.name)
    })

    // Room deletion
    wsService.onGlobal('room_deleted', (message: WebSocketMessage<{ room_id: string; category: string }>) => {
      const data = message.data
      console.log('Received room_deleted event:', data)
      roomStore.removeRoom(data.room_id)
      console.log('Deleted room:', data.room_id)
      
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
      console.log('Global WebSocket connected')
    })

    wsService.onGlobalDisconnection((event) => {
      console.log('Global WebSocket disconnected:', event)
    })
  }

  const connectGlobalWebSocket = async () => {
    try {
      await wsService.connectGlobal()
    } catch (error) {
      console.error('Failed to connect global WebSocket:', error)
    }
  }

  // Auto-initialize on mount
  onMounted(() => {
    setupWebSocketListeners()
    setupGlobalWebSocketListeners()
    void connectGlobalWebSocket()
  })

  onUnmounted(() => {
    wsService.disconnect()
    wsService.disconnectGlobal()
  })

  return {
    setupWebSocketListeners,
    setupGlobalWebSocketListeners,
    connectGlobalWebSocket
  }
}
