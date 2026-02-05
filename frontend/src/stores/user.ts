import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService, setAuthToken, clearAuthToken } from '@/services/api'

export type AuthProvider = 'guest' | 'discord' | 'google'

export interface UserSession {
  id: string
  nickname: string
  authProvider: AuthProvider
  email?: string
  avatarUrl?: string
  isGuest: boolean
}

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<UserSession | null>(null)
  const hasCompletedAuth = ref(false)
  const token = ref<string | null>(null)
  const nicknameUpdateStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  const nicknameUpdateError = ref<string | null>(null)
  
  const userId = computed(() => currentUser.value?.id ?? '')
  const nickname = computed(() => currentUser.value?.nickname ?? 'User')
  const isAuthenticated = computed(() => !!currentUser.value && !!token.value)
  const authProvider = computed(() => currentUser.value?.authProvider || 'guest')
  const isLoggedIn = computed(() => authProvider.value !== 'guest')
  const isGuest = computed(() => authProvider.value === 'guest' || currentUser.value?.isGuest === true)
  const email = computed(() => currentUser.value?.email)
  const avatarUrl = computed(() => currentUser.value?.avatarUrl)

  function setUser(user: UserSession, authToken?: string) {
    // Validate user object
    if (!user.id || !user.nickname || !user.authProvider || typeof user.isGuest !== 'boolean') {
      console.error('Invalid user object provided:', user)
      throw new Error('Invalid user object: missing required fields')
    }

    console.log('Setting user:', { id: user.id, nickname: user.nickname, authProvider: user.authProvider, isGuest: user.isGuest })
    
    currentUser.value = user
    if (authToken) {
      token.value = authToken
      setAuthToken(authToken)
    }
    localStorage.setItem('orbital_user_id', user.id)
    localStorage.setItem('orbital_user_nickname', user.nickname)
    localStorage.setItem('orbital_user_auth_provider', user.authProvider)
    localStorage.setItem('orbital_user_is_guest', String(user.isGuest))
    if (user.email) {
      localStorage.setItem('orbital_user_email', user.email)
    }
    if (user.avatarUrl) {
      localStorage.setItem('orbital_user_avatar', user.avatarUrl)
    }
  }

  async function updateNickname(newNickname: string) {
    if (!currentUser.value || !currentUser.value.id) {
      console.error('Cannot update nickname: no current user or user ID missing')
      return
    }
    
    nicknameUpdateStatus.value = 'pending'
    nicknameUpdateError.value = null

    try {
      // Update local state immediately for responsive UI
      currentUser.value.nickname = newNickname
      localStorage.setItem('orbital_user_nickname', newNickname)

      // Send update to server via WebSocket (real-time)
      const { wsService } = await import('@/services/websocket')
      console.log('Sending nickname change:', { userId: currentUser.value.id, newNickname })
      wsService.changeNickname(currentUser.value.id, newNickname)
      
      nicknameUpdateStatus.value = 'success'
    } catch (error) {
      console.error('Failed to update nickname:', error)
      nicknameUpdateError.value = 'Failed to update nickname. Please try again.'
      nicknameUpdateStatus.value = 'error'
      
      // Revert local change on failure
      if (currentUser.value) {
        currentUser.value.nickname = localStorage.getItem('orbital_user_nickname') || 'User'
      }
      throw error
    }
  }

  // Handle nickname updates from other users (received via WebSocket)
  function updateUserNickname(userId: string, nickname: string) {
    // This would be called by WebSocket handlers when other users change their nicknames
    // For now, this is mainly used by RoomStore for updating user lists
    // Could emit an event or use a shared user state store in the future
    console.log(`User ${userId} updated nickname to ${nickname}`)
  }

  function updateNicknameLocally(newNickname: string) {
    if (currentUser.value) {
      currentUser.value.nickname = newNickname
      localStorage.setItem('orbital_user_nickname', newNickname)
    }
  }

  async function loadUserFromStorage(): Promise<UserSession | null> {
    const storedToken = localStorage.getItem('orbital_auth_token')
    const id = localStorage.getItem('orbital_user_id')
    const nickname = localStorage.getItem('orbital_user_nickname')
    const authProvider = localStorage.getItem('orbital_user_auth_provider') as AuthProvider | null
    const isGuestStored = localStorage.getItem('orbital_user_is_guest')
    const hasCompletedAuthValue = localStorage.getItem('orbital_has_completed_auth')
    
    hasCompletedAuth.value = hasCompletedAuthValue === 'true'
    
    if (storedToken && id && nickname && authProvider) {
      // Set token for API calls
      token.value = storedToken
      setAuthToken(storedToken)
      
      const user: UserSession = { 
        id, 
        nickname, 
        authProvider,
        isGuest: isGuestStored === 'true',
        email: localStorage.getItem('orbital_user_email') || undefined,
        avatarUrl: localStorage.getItem('orbital_user_avatar') || undefined
      }
      currentUser.value = user
      
      // Try to validate token by fetching current user
      try {
        const freshUser = await apiService.getCurrentUser()
        // Update user data from server (convert snake_case to camelCase)
        user.email = freshUser.email
        user.avatarUrl = freshUser.avatar_url
        user.nickname = freshUser.nickname
        currentUser.value = { ...user }
      } catch {
        // Token might be expired, clear everything
        console.warn('Token validation failed, clearing auth state')
        clearUser()
        return null
      }
      
      return user
    }
    return null
  }

  function clearUser() {
    currentUser.value = null
    hasCompletedAuth.value = false
    token.value = null
    clearAuthToken()
    localStorage.removeItem('orbital_user_id')
    localStorage.removeItem('orbital_user_nickname')
    localStorage.removeItem('orbital_user_auth_provider')
    localStorage.removeItem('orbital_user_email')
    localStorage.removeItem('orbital_user_avatar')
    localStorage.removeItem('orbital_has_completed_auth')
    localStorage.removeItem('orbital_user_is_guest')
  }

  function loginWithProvider(provider: 'discord' | 'google') {
    // Redirect to OAuth provider
    if (provider === 'discord') {
      apiService.initiateDiscordLogin()
    } else if (provider === 'google') {
      apiService.initiateGoogleLogin()
    }
  }

  async function continueAsGuest() {
    try {
      const response = await apiService.guestLogin()
      const user: UserSession = {
        id: response.user.id,
        nickname: response.user.nickname,
        authProvider: 'guest',
        isGuest: true,
        email: response.user.email,
        avatarUrl: response.user.avatar_url
      }
      setUser(user, response.token)
      hasCompletedAuth.value = true
      localStorage.setItem('orbital_has_completed_auth', 'true')
    } catch (error) {
      console.error('Guest login failed:', error)
      throw error
    }
  }

  async function logout() {
    try {
      await apiService.logout()
    } catch {
      console.warn('Logout API call failed, clearing locally anyway')
    }
    clearUser()
  }

  // Handle OAuth callback
  function handleOAuthCallback(tokenStr: string, userData: UserSession) {
    setUser(userData, tokenStr)
    hasCompletedAuth.value = true
    localStorage.setItem('orbital_has_completed_auth', 'true')
  }

  return {
    currentUser,
    token,
    userId,
    nickname,
    email,
    avatarUrl,
    authProvider,
    isAuthenticated,
    isLoggedIn,
    isGuest,
    hasCompletedAuth,
    nicknameUpdateStatus,
    nicknameUpdateError,
    setUser,
    updateNickname,
    updateNicknameLocally,
    updateUserNickname,
    loadUserFromStorage,
    clearUser,
    loginWithProvider,
    continueAsGuest,
    logout,
    handleOAuthCallback
  }
})
