import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type AuthProvider = 'guest' | 'discord' | 'google'

export interface UserSession {
  id: string
  nickname: string
  authProvider: AuthProvider
  email?: string
  avatarUrl?: string
}

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<UserSession | null>(null)
  const hasCompletedAuth = ref(false)
  const userId = computed(() => currentUser.value?.id || '')
  const nickname = computed(() => currentUser.value?.nickname || 'User')
  const isAuthenticated = computed(() => !!currentUser.value)
  const authProvider = computed(() => currentUser.value?.authProvider || 'guest')
  const isLoggedIn = computed(() => authProvider.value !== 'guest')
  const isGuest = computed(() => authProvider.value === 'guest')
  const email = computed(() => currentUser.value?.email)
  const avatarUrl = computed(() => currentUser.value?.avatarUrl)

  function setUser(user: UserSession) {
    currentUser.value = user
    localStorage.setItem('orbital_user_id', user.id)
    localStorage.setItem('orbital_user_nickname', user.nickname)
    localStorage.setItem('orbital_auth_provider', user.authProvider)
    if (user.email) {
      localStorage.setItem('orbital_user_email', user.email)
    }
    if (user.avatarUrl) {
      localStorage.setItem('orbital_user_avatar', user.avatarUrl)
    }
  }

  function updateNickname(newNickname: string) {
    if (currentUser.value) {
      currentUser.value.nickname = newNickname
      localStorage.setItem('orbital_user_nickname', newNickname)
    }
  }

  function loadUserFromStorage(): UserSession | null {
    const id = localStorage.getItem('orbital_user_id')
    const nickname = localStorage.getItem('orbital_user_nickname')
    const authProvider = localStorage.getItem('orbital_auth_provider') as AuthProvider | null
    const hasCompletedAuthValue = localStorage.getItem('orbital_has_completed_auth')
    
    hasCompletedAuth.value = hasCompletedAuthValue === 'true'
    
    if (id && nickname && authProvider) {
      const user: UserSession = { 
        id, 
        nickname, 
        authProvider,
        email: localStorage.getItem('orbital_user_email') || undefined,
        avatarUrl: localStorage.getItem('orbital_user_avatar') || undefined
      }
      currentUser.value = user
      return user
    }
    return null
  }

  function clearUser() {
    currentUser.value = null
    hasCompletedAuth.value = false
    localStorage.removeItem('orbital_user_id')
    localStorage.removeItem('orbital_user_nickname')
    localStorage.removeItem('orbital_auth_provider')
    localStorage.removeItem('orbital_user_email')
    localStorage.removeItem('orbital_user_avatar')
    localStorage.removeItem('orbital_has_completed_auth')
  }

  async function loginWithProvider(provider: 'discord' | 'google') {
    // Backend integration placeholder
    // This will redirect to OAuth provider and handle callback
    console.log(`[Auth] Initiating login with ${provider}`)
    // TODO: Implement OAuth flow when backend is ready
  }

  async function continueAsGuest() {
    const id = generateUserId()
    const nickname = generateNickname(id)
    const user: UserSession = {
      id,
      nickname,
      authProvider: 'guest'
    }
    setUser(user)
    hasCompletedAuth.value = true
    localStorage.setItem('orbital_has_completed_auth', 'true')
  }

  async function logout() {
    // Backend integration placeholder
    console.log('[Auth] Logging out')
    // TODO: Call backend logout endpoint when ready
    clearUser()
  }

  return {
    currentUser,
    userId,
    nickname,
    email,
    avatarUrl,
    authProvider,
    isAuthenticated,
    isLoggedIn,
    isGuest,
    hasCompletedAuth,
    setUser,
    updateNickname,
    loadUserFromStorage,
    clearUser,
    loginWithProvider,
    continueAsGuest,
    logout
  }
})

function generateUserId(): string {
  return 'user_' + Math.random().toString(36).substring(2, 15)
}

function generateNickname(userId: string): string {
  return 'Guest-' + userId.substring(0, 5)
}
