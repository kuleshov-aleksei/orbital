import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { PublicUser } from "@/types"
import { apiService } from "@/services/api"

export const useUsersStore = defineStore("users", () => {
  // State
  const allUsers = ref<PublicUser[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const lastOnlineUpdate = ref<number>(0)

  // Getters
  const userCount = computed(() => allUsers.value.length)

  // Sorted users: online users first, then offline users
  const sortedUsers = computed(() => {
    return [...allUsers.value].sort((a, b) => {
      // Online users come first (true > false, so we invert for descending order)
      if (a.is_online && !b.is_online) return -1
      if (!a.is_online && b.is_online) return 1
      // If both have same online status, sort by nickname
      return a.nickname.localeCompare(b.nickname)
    })
  })

  const usersByRole = computed(() => {
    const grouped: Record<string, PublicUser[]> = {
      guest: [],
      user: [],
      admin: [],
      super_admin: [],
    }

    sortedUsers.value.forEach((user) => {
      if (grouped[user.role]) {
        grouped[user.role].push(user)
      }
    })

    return grouped
  })

  // Actions
  async function fetchAllUsers() {
    if (isLoading.value) return

    isLoading.value = true
    error.value = null

    try {
      const users = await apiService.getAllUsers()
      const now = Date.now()
      const hasRecentWebSocketUpdate = now - lastOnlineUpdate.value < 5000 // 5 seconds

      // Create a map of existing users to preserve their online status
      const existingUsersMap = new Map(allUsers.value.map((u) => [u.id, u]))

      // Merge new users with existing ones, preserving online status from WebSocket
      // If we received WebSocket update in last 5 seconds, trust it over API
      allUsers.value = users.map((user) => {
        const existing = existingUsersMap.get(user.id)
        const apiOnlineStatus = user.is_online

        // If we have recent WebSocket data, prioritize it over API
        // Otherwise, use API status or existing status
        let isOnline: boolean
        if (hasRecentWebSocketUpdate && existing) {
          isOnline = existing.is_online
        } else {
          isOnline = existing?.is_online ?? apiOnlineStatus ?? false
        }

        return {
          ...user,
          is_online: isOnline,
        }
      })
    } catch (err) {
      console.error("Failed to fetch users:", err)
      error.value = "Failed to load users"
    } finally {
      isLoading.value = false
    }
  }

  function updateOnlineStatus(userId: string, isOnline: boolean) {
    const index = allUsers.value.findIndex((u) => u.id === userId)
    if (index !== -1) {
      // Use splice to ensure reactivity in Vue 3
      allUsers.value.splice(index, 1, {
        ...allUsers.value[index],
        is_online: isOnline,
      })
      lastOnlineUpdate.value = Date.now()
    }
  }

  function updateOnlineUsersList(onlineUserIds: string[]) {
    allUsers.value = allUsers.value.map((user) => ({
      ...user,
      is_online: onlineUserIds.includes(user.id),
    }))
    lastOnlineUpdate.value = Date.now()
  }

  function addUser(user: PublicUser) {
    // Check if user already exists
    const existingIndex = allUsers.value.findIndex((u) => u.id === user.id)
    if (existingIndex === -1) {
      // New user - add with online status
      allUsers.value.push(user)
    } else {
      // User exists - update online status
      allUsers.value[existingIndex].is_online = true
    }
  }

  function updateUser(user: PublicUser) {
    const index = allUsers.value.findIndex((u) => u.id === user.id)
    if (index !== -1) {
      // Update existing user, preserving is_online if not provided
      // Use splice to ensure reactivity in Vue 3
      const currentOnline = allUsers.value[index].is_online
      allUsers.value.splice(index, 1, {
        ...user,
        is_online: user.is_online !== undefined ? user.is_online : currentOnline,
      })
    } else {
      // If user doesn't exist, add them
      addUser(user)
    }
  }

  function removeUser(userId: string) {
    const index = allUsers.value.findIndex((u) => u.id === userId)
    if (index !== -1) {
      // Mark user as offline instead of removing
      allUsers.value[index].is_online = false
    }
  }

  function setUsers(users: PublicUser[]) {
    // Merge with existing users to preserve any users not in the connected list
    const userMap = new Map(allUsers.value.map((u) => [u.id, u]))

    // Mark all existing users as offline first
    userMap.forEach((user) => {
      user.is_online = false
    })

    // Update with connected users (they come with is_online: true)
    users.forEach((user) => {
      userMap.set(user.id, user)
    })

    allUsers.value = Array.from(userMap.values())
  }

  function updateUserNickname(userId: string, nickname: string) {
    const user = allUsers.value.find((u) => u.id === userId)
    if (user) {
      user.nickname = nickname
    }
  }

  return {
    // State
    allUsers,
    isLoading,
    error,
    // Getters
    userCount,
    sortedUsers,
    usersByRole,
    // Actions
    fetchAllUsers,
    addUser,
    updateUser,
    removeUser,
    setUsers,
    updateUserNickname,
    updateOnlineStatus,
    updateOnlineUsersList,
  }
})
