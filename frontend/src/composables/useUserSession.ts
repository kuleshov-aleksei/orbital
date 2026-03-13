import { onMounted } from "vue"
import { useUserStore } from "@/stores"
import { generateUserId, generateNickname } from "@/services/api"

export function useUserSession() {
  const userStore = useUserStore()

  const initializeUser = async () => {
    // Try to load from localStorage first
    const existingUser = await userStore.loadUserFromStorage()

    if (!existingUser) {
      // Create new user if none exists
      const userId = generateUserId()
      const nickname = generateNickname(userId)

      userStore.setUser({
        id: userId,
        nickname,
        authProvider: "guest",
        isGuest: true,
        role: "guest"
      })
    }

    return userStore.userId
  }

  const getCurrentUserId = async (): Promise<string> => {
    if (!userStore.isAuthenticated) {
      return await initializeUser()
    }
    return userStore.userId
  }

  const updateNickname = async (nickname: string) => {
    await userStore.updateNickname(nickname)
  }

  // Auto-initialize on mount
  onMounted(() => {
    void initializeUser()
  })

  return {
    userId: userStore.userId,
    nickname: userStore.nickname,
    currentUser: userStore.currentUser,
    isAuthenticated: userStore.isAuthenticated,
    initializeUser,
    getCurrentUserId,
    updateNickname,
  }
}
