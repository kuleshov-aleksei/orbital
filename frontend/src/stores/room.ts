import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { Room, User } from "@/types"

export const useRoomStore = defineStore("room", () => {
  // State
  const rooms = ref<Room[]>([])
  const activeRoomId = ref<string | null>(null)
  const currentRoomUsers = ref<User[]>([])
  const remoteStreamVolumes = ref<Map<string, number>>(new Map())

  // Getters
  const activeRoom = computed(() => rooms.value.find((r) => r.id === activeRoomId.value) || null)

  const activeRoomName = computed(() => activeRoom.value?.name || "Voice Room")

  const isInRoom = computed(() => !!activeRoomId.value)

  const getRoomById = computed(() => (roomId: string) => rooms.value.find((r) => r.id === roomId))

  const getUserVolume = computed(
    () => (userId: string) => remoteStreamVolumes.value.get(userId) ?? 80,
  )

  // Actions
  function setRooms(newRooms: Room[]) {
    rooms.value = newRooms
  }

  function addRoom(room: Room) {
    const existingIndex = rooms.value.findIndex((r) => r.id === room.id)
    if (existingIndex === -1) {
      rooms.value.unshift(room)
    }
  }

  function updateRoom(roomId: string, updates: Partial<Room>) {
    const index = rooms.value.findIndex((r) => r.id === roomId)
    if (index !== -1) {
      rooms.value[index] = { ...rooms.value[index], ...updates }
    }
  }

  function removeRoom(roomId: string) {
    const index = rooms.value.findIndex((r) => r.id === roomId)
    if (index !== -1) {
      rooms.value.splice(index, 1)
    }
  }

  function setActiveRoom(roomId: string | null) {
    activeRoomId.value = roomId
    if (!roomId) {
      currentRoomUsers.value = []
    }
  }

  function setCurrentRoomUsers(users: User[]) {
    currentRoomUsers.value = users
  }

  function updateUserStatus(
    userId: string,
    status: {
      is_speaking?: boolean
      is_muted?: boolean
      is_deafened?: boolean
      is_screen_sharing?: boolean
    },
  ) {
    console.log("[RoomStore] updateUserStatus called:", { userId, status })
    // Update rooms array for sidebar display
    // Use slice() to create new array references for Vue reactivity
    let hasChanges = false
    let userFound = false
    const updatedRooms = rooms.value.map((room) => {
      if (room.users) {
        const userIndex = room.users.findIndex((u) => u.id === userId)
        if (userIndex !== -1) {
          userFound = true
          const user = room.users[userIndex]
          const updatedUser = { ...user }
          if (status.is_speaking !== undefined) updatedUser.is_speaking = status.is_speaking
          if (status.is_muted !== undefined) updatedUser.is_muted = status.is_muted
          if (status.is_deafened !== undefined) updatedUser.is_deafened = status.is_deafened
          if (status.is_screen_sharing !== undefined)
            updatedUser.is_screen_sharing = status.is_screen_sharing

          // Check if anything actually changed
          if (
            updatedUser.is_speaking !== user.is_speaking ||
            updatedUser.is_muted !== user.is_muted ||
            updatedUser.is_deafened !== user.is_deafened ||
            updatedUser.is_screen_sharing !== user.is_screen_sharing
          ) {
            hasChanges = true
          }

          // Create new users array with updated user
          const updatedUsers = room.users.slice()
          updatedUsers[userIndex] = updatedUser

          return { ...room, users: updatedUsers }
        }
      }
      return room
    })

    // Only update if there were actual changes
    if (hasChanges) {
      console.log("[RoomStore] Updating rooms with changes for user:", userId)
      rooms.value = updatedRooms
    } else if (!userFound) {
      console.log(
        "[RoomStore] User not found in any room:",
        userId,
        "Available user IDs:",
        rooms.value.flatMap((r) => r.users?.map((u) => u.id) || []),
      )
    }

    // Also update current room users if applicable
    updateCurrentRoomUser(userId, status)
  }

  function updateUserNickname(userId: string, nickname: string) {
    rooms.value.forEach((room, roomIndex) => {
      if (room.users) {
        const userIndex = room.users.findIndex((u) => u.id === userId)
        if (userIndex !== -1) {
          const user = room.users[userIndex]
          rooms.value[roomIndex].users[userIndex] = { ...user, nickname }
        }
      }
    })
  }

  function addUserToRoom(roomId: string, user: User) {
    const room = rooms.value.find((r) => r.id === roomId)
    if (room) {
      if (!room.users) room.users = []
      const existingUserIndex = room.users.findIndex((u) => u.id === user.id)
      if (existingUserIndex === -1) {
        room.users.push(user)
        room.user_count = room.users.length
      }
    }
  }

  function removeUserFromRoom(roomId: string, userId: string) {
    const room = rooms.value.find((r) => r.id === roomId)
    if (room && room.users) {
      const userIndex = room.users.findIndex((u) => u.id === userId)
      if (userIndex !== -1) {
        room.users.splice(userIndex, 1)
        room.user_count = room.users.length
      }
    }
  }

  function setUserVolume(userId: string, volume: number) {
    // Clamp volume to valid range
    const clampedVolume = Math.max(0, Math.min(100, volume))
    remoteStreamVolumes.value.set(userId, clampedVolume)

    // Log for debugging
    console.log(`Volume updated: User ${userId} → ${clampedVolume}%`)
  }

  function clearUserVolume(userId: string) {
    remoteStreamVolumes.value.delete(userId)
  }

  function updateCurrentRoomUser(userId: string, updates: Partial<User>) {
    const userIndex = currentRoomUsers.value.findIndex((u) => u.id === userId)
    if (userIndex !== -1) {
      currentRoomUsers.value[userIndex] = {
        ...currentRoomUsers.value[userIndex],
        ...updates,
      }
    }
  }

  function reorderRooms(roomOrders: Record<string, number>) {
    // Update sort_order for each room
    rooms.value = rooms.value.map((room) => {
      if (roomOrders[room.id] !== undefined) {
        return { ...room, sort_order: roomOrders[room.id] }
      }
      return room
    })
  }

  function moveRoomToCategory(roomId: string, targetCategoryId: string) {
    const index = rooms.value.findIndex((r) => r.id === roomId)
    if (index !== -1) {
      const room = rooms.value[index]
      const oldCategory = room.category

      // Find the highest sort_order in the target category
      const maxSortOrder = rooms.value
        .filter((r) => r.category === targetCategoryId)
        .reduce((max, r) => Math.max(max, r.sort_order || 0), 0)

      rooms.value[index] = {
        ...room,
        category: targetCategoryId,
        sort_order: maxSortOrder + 1,
      }

      return { room, oldCategory }
    }
    return null
  }

  return {
    rooms,
    activeRoomId,
    currentRoomUsers,
    remoteStreamVolumes,
    activeRoom,
    activeRoomName,
    isInRoom,
    getRoomById,
    setRooms,
    addRoom,
    updateRoom,
    removeRoom,
    setActiveRoom,
    setCurrentRoomUsers,
    updateUserStatus,
    updateUserNickname,
    addUserToRoom,
    removeUserFromRoom,
    setUserVolume,
    clearUserVolume,
    getUserVolume,
    updateCurrentRoomUser,
    reorderRooms,
    moveRoomToCategory,
  }
})
