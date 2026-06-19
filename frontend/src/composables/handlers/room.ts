import { wsService } from "@/services/websocket"
import type { MessageCallback } from "@/services/websocket"
import { debugLog } from "@/utils/debug"
import type { Room, Category, User } from "@/types"

export function setupRoomHandlers(
  roomStore: {
    addRoom: (room: Room) => void
    removeRoom: (roomId: string) => void
    updateRoom: (roomId: string, room: Partial<Room>) => void
    removeUserFromRoom: (roomId: string, userId: string) => void
    addUserToRoom: (roomId: string, user: User) => void
    activeRoomId: string | null
    setActiveRoom: (roomId: string | null) => void
  },
  categoryStore: {
    addCategory: (category: Category) => void
    removeCategory: (categoryId: string) => void
    updateCategory: (categoryId: string, updates: Partial<Category>) => void
    getCategoryById: (categoryId: string) => Category | undefined
    reorderCategories: (orders: Record<string, number>) => void
  },
  appStore: {
    isMobile: boolean
    showRoomsView: () => void
  },
  userStore: { userId: string | null },
  cleanupFns: Array<() => void>,
): void {
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
  cleanupFns.push(() => wsService.off("room_user_left", onRoomUserLeft))

  const onRoomCreated: MessageCallback = (message) => {
    const newRoom = message.data as Room
    debugLog("Received room_created event:", newRoom)
    roomStore.addRoom(newRoom)
  }
  wsService.onGlobal("room_created", onRoomCreated)
  cleanupFns.push(() => wsService.offGlobal("room_created", onRoomCreated))

  const onRoomUserJoined: MessageCallback = (message) => {
    const data = message.data as { room_id: string; user: User }
    roomStore.addUserToRoom(data.room_id, data.user)
  }
  wsService.onGlobal("room_user_joined", onRoomUserJoined)
  cleanupFns.push(() => wsService.offGlobal("room_user_joined", onRoomUserJoined))

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
  cleanupFns.push(() => wsService.offGlobal("room_user_left", onGlobalRoomUserLeft))

  const onCategoryCreated: MessageCallback = (message) => {
    const newCategory = message.data as Category
    debugLog("Received category_created event:", newCategory)
    categoryStore.addCategory(newCategory)
  }
  wsService.onGlobal("category_created", onCategoryCreated)
  cleanupFns.push(() => wsService.offGlobal("category_created", onCategoryCreated))

  const onCategoryRenamed: MessageCallback = (message) => {
    const updatedCategory = message.data as Category
    debugLog("Received category_renamed event:", updatedCategory)
    const oldCategory = categoryStore.getCategoryById(updatedCategory.id)
    if (oldCategory) {
      categoryStore.updateCategory(updatedCategory.id, { name: updatedCategory.name })
      debugLog("Renamed category from", oldCategory.name, "to", updatedCategory.name)
    }
  }
  wsService.onGlobal("category_renamed", onCategoryRenamed)
  cleanupFns.push(() => wsService.offGlobal("category_renamed", onCategoryRenamed))

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
  cleanupFns.push(() => wsService.offGlobal("category_deleted", onCategoryDeleted))

  const onCategoryOrderUpdated: MessageCallback = (message) => {
    const data = message.data as { orders: Record<string, number> }
    debugLog("Received category_order_updated event:", data)
    categoryStore.reorderCategories(data.orders)
  }
  wsService.onGlobal("category_order_updated", onCategoryOrderUpdated)
  cleanupFns.push(() => wsService.offGlobal("category_order_updated", onCategoryOrderUpdated))

  const onRoomUpdated: MessageCallback = (message) => {
    const data = message.data as { room_id: string; room: Room; old_category: string }
    debugLog("Received room_updated event:", data)
    roomStore.updateRoom(data.room_id, data.room)
  }
  wsService.onGlobal("room_updated", onRoomUpdated)
  cleanupFns.push(() => wsService.offGlobal("room_updated", onRoomUpdated))

  const onRoomDeleted: MessageCallback = (message) => {
    const data = message.data as { room_id: string; category: string }
    debugLog("Received room_deleted event:", data)
    roomStore.removeRoom(data.room_id)
    if (roomStore.activeRoomId === data.room_id) {
      roomStore.setActiveRoom(null)
      if (appStore.isMobile) {
        appStore.showRoomsView()
      }
    }
  }
  wsService.onGlobal("room_deleted", onRoomDeleted)
  cleanupFns.push(() => wsService.offGlobal("room_deleted", onRoomDeleted))
}
