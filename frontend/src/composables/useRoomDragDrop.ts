import { ref } from "vue"
import { apiService } from "@/services/api"
import { useRoomStore } from "@/stores"
import type { Room } from "@/types"

export function useRoomDragDrop() {
  const roomStore = useRoomStore()
  const draggedRoom = ref<Room | null>(null)
  const dragSourceCategory = ref<string | null>(null)
  const activeDropZone = ref<{
    categoryId: string
    position: number | "before-first" | "after-last"
  } | null>(null)

  const handleDragStart = (event: DragEvent, room: Room, categoryId: string) => {
    draggedRoom.value = room
    dragSourceCategory.value = categoryId

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", room.id)
      const target = event.target as HTMLElement
      if (target) event.dataTransfer.setDragImage(target, 0, 0)
    }
  }

  const handleDragEnd = () => {
    draggedRoom.value = null
    dragSourceCategory.value = null
    activeDropZone.value = null
  }

  const handleDropZoneDragOver = (
    event: DragEvent,
    categoryId: string,
    position: number | "before-first" | "after-last",
  ) => {
    event.preventDefault()
    if (!draggedRoom.value) return
    activeDropZone.value = { categoryId, position }
    event.dataTransfer!.dropEffect = "move"
  }

  const handleCategoryDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
  }

  const reorderWithinCategory = async (
    categoryId: string,
    sourceRoom: Room,
    targetIndex: number,
  ) => {
    const rooms = roomStore.rooms
    const categoryRooms = rooms
      .filter((r) => r.category === categoryId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

    const sourceIndex = categoryRooms.findIndex((r) => r.id === sourceRoom.id)
    if (sourceIndex === -1) return

    if (sourceIndex === targetIndex || sourceIndex === targetIndex - 1) return

    const [movedRoom] = categoryRooms.splice(sourceIndex, 1)
    let adjustedTargetIndex = targetIndex
    if (sourceIndex < targetIndex) adjustedTargetIndex = targetIndex - 1
    categoryRooms.splice(adjustedTargetIndex, 0, movedRoom)

    const updates: Record<string, number> = {}
    categoryRooms.forEach((room, index) => {
      updates[room.id] = index + 1
    })
    roomStore.reorderRooms(updates)
    await apiService.updateRoomOrder(updates)
  }

  const moveRoomToCategory = async (room: Room, targetCategoryId: string) => {
    const targetRooms = roomStore.rooms.filter((r) => r.category === targetCategoryId)
    const maxSortOrder = targetRooms.reduce((max, r) => Math.max(max, r.sort_order || 0), 0)

    await apiService.updateRoom(room.id, { category: targetCategoryId })

    const updates: Record<string, number> = {
      [room.id]: maxSortOrder + 1,
    }
    roomStore.moveRoomToCategory(room.id, targetCategoryId)
    roomStore.reorderRooms(updates)
    await apiService.updateRoomOrder(updates)

    return { roomId: room.id, targetCategoryId }
  }

  const moveRoomToCategoryAtPosition = async (
    room: Room,
    targetCategoryId: string,
    targetIndex: number,
  ) => {
    const targetRooms = roomStore.rooms
      .filter((r) => r.category === targetCategoryId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

    await apiService.updateRoom(room.id, { category: targetCategoryId })

    const roomCopy = { ...room, category: targetCategoryId }
    targetRooms.splice(targetIndex, 0, roomCopy)

    const updates: Record<string, number> = {}
    targetRooms.forEach((r, index) => {
      updates[r.id] = index + 1
    })
    roomStore.moveRoomToCategory(room.id, targetCategoryId)
    roomStore.reorderRooms(updates)
    await apiService.updateRoomOrder(updates)

    return { roomId: room.id, targetCategoryId }
  }

  const handleDropZoneDrop = async (event: DragEvent, categoryId: string, targetIndex: number) => {
    event.preventDefault()
    event.stopPropagation()

    if (!draggedRoom.value) {
      handleDragEnd()
      return { roomId: "", targetCategoryId: "" }
    }

    const sourceRoom = draggedRoom.value
    const isSameCategory = sourceRoom.category === categoryId

    try {
      if (isSameCategory) {
        await reorderWithinCategory(categoryId, sourceRoom, targetIndex)
        return null
      } else {
        return await moveRoomToCategoryAtPosition(sourceRoom, categoryId, targetIndex)
      }
    } catch (error) {
      console.error("Failed to update room order:", error)
      return null
    } finally {
      handleDragEnd()
    }
  }

  const handleCategoryDrop = async (event: DragEvent, categoryId: string) => {
    event.preventDefault()
    event.stopPropagation()

    if (!draggedRoom.value || draggedRoom.value.category === categoryId) {
      handleDragEnd()
      return null
    }

    try {
      return await moveRoomToCategory(draggedRoom.value, categoryId)
    } catch (error) {
      console.error("Failed to move room to category:", error)
      return null
    } finally {
      handleDragEnd()
    }
  }

  return {
    draggedRoom,
    activeDropZone,
    handleDragStart,
    handleDragEnd,
    handleDropZoneDragOver,
    handleCategoryDragOver,
    handleDropZoneDrop,
    handleCategoryDrop,
  }
}
