import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PublicUser } from '@/types'
import { apiService } from '@/services/api'

export const useUsersStore = defineStore('users', () => {
  // State
  const allUsers = ref<PublicUser[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const userCount = computed(() => allUsers.value.length)
  
  const usersByRole = computed(() => {
    const grouped: Record<string, PublicUser[]> = {
      guest: [],
      user: [],
      admin: [],
      super_admin: []
    }
    
    allUsers.value.forEach(user => {
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
      // Add placeholder is_online status (always true for now)
      allUsers.value = users.map(user => ({
        ...user,
        is_online: true
      }))
    } catch (err) {
      console.error('Failed to fetch users:', err)
      error.value = 'Failed to load users'
    } finally {
      isLoading.value = false
    }
  }

  function addUser(user: PublicUser) {
    // Check if user already exists
    const existingIndex = allUsers.value.findIndex(u => u.id === user.id)
    if (existingIndex === -1) {
      allUsers.value.push({
        ...user,
        is_online: true
      })
    }
  }

  function updateUser(user: PublicUser) {
    const index = allUsers.value.findIndex(u => u.id === user.id)
    if (index !== -1) {
      // Preserve the is_online status if it exists
      const existingOnline = allUsers.value[index].is_online
      allUsers.value[index] = {
        ...user,
        is_online: existingOnline !== undefined ? existingOnline : true
      }
    } else {
      // If user doesn't exist, add them
      addUser(user)
    }
  }

  function removeUser(userId: string) {
    const index = allUsers.value.findIndex(u => u.id === userId)
    if (index !== -1) {
      // For now, we don't remove users from the list, just mark them as offline
      // This allows the sidebar to show all registered users
      allUsers.value[index].is_online = false
    }
  }

  function setUsers(users: PublicUser[]) {
    allUsers.value = users.map(user => ({
      ...user,
      is_online: true
    }))
  }

  function updateUserNickname(userId: string, nickname: string) {
    const user = allUsers.value.find(u => u.id === userId)
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
    usersByRole,
    // Actions
    fetchAllUsers,
    addUser,
    updateUser,
    removeUser,
    setUsers,
    updateUserNickname
  }
})
