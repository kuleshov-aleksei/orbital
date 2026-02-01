import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface UserSession {
  id: string
  nickname: string
}

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<UserSession | null>(null)
  const userId = computed(() => currentUser.value?.id || '')
  const nickname = computed(() => currentUser.value?.nickname || 'User')
  const isAuthenticated = computed(() => !!currentUser.value)

  function setUser(user: UserSession) {
    currentUser.value = user
    localStorage.setItem('orbital_user_id', user.id)
    localStorage.setItem('orbital_user_nickname', user.nickname)
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
    if (id && nickname) {
      const user = { id, nickname }
      currentUser.value = user
      return user
    }
    return null
  }

  function clearUser() {
    currentUser.value = null
    localStorage.removeItem('orbital_user_id')
    localStorage.removeItem('orbital_user_nickname')
  }

  return {
    currentUser,
    userId,
    nickname,
    isAuthenticated,
    setUser,
    updateNickname,
    loadUserFromStorage,
    clearUser
  }
})
