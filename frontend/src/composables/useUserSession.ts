import { onMounted } from 'vue'
import { useUserStore } from '@/stores'
import { generateUserId, generateNickname } from '@/services/api'

export function useUserSession() {
  const userStore = useUserStore()

  const initializeUser = () => {
    // Try to load from localStorage first
    const existingUser = userStore.loadUserFromStorage()
    
    if (!existingUser) {
      // Create new user if none exists
      const userId = generateUserId()
      const nickname = generateNickname(userId)
      userStore.setUser({ id: userId, nickname })
    }
    
    return userStore.userId
  }

  const getCurrentUserId = (): string => {
    if (!userStore.isAuthenticated) {
      return initializeUser()
    }
    return userStore.userId
  }

  const updateNickname = (nickname: string) => {
    userStore.updateNickname(nickname)
  }

  // Auto-initialize on mount
  onMounted(() => {
    initializeUser()
  })

  return {
    userId: userStore.userId,
    nickname: userStore.nickname,
    currentUser: userStore.currentUser,
    isAuthenticated: userStore.isAuthenticated,
    initializeUser,
    getCurrentUserId,
    updateNickname
  }
}
