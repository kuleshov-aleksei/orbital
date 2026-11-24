import { defineStore } from "pinia"
import { ref, computed, watch } from "vue"
import {
  apiService,
  setAuthToken,
  clearAuthToken,
  setTokenExpiry,
  type ApiError,
  type AuthResponse,
} from "@/services/api"
import { setUserSoundPack } from "@/services/sounds"
import { unregisterPush } from "@/services/push"
import { clearMediaCache } from "@/services/attachments/mediaCache"
import { clearOfflineCache, setOfflineCacheUser } from "@/services/offlineCache"
import type { UserRole } from "@/types"

export type AuthProvider = "guest" | "discord" | "google" | "password"

export interface UserSession {
  id: string
  nickname: string
  authProvider: AuthProvider
  email?: string
  avatarUrl?: string
  isGuest: boolean
  role: UserRole
  /**
   * When the Terms of Service and Privacy Policy were accepted. `null`: the
   * server says not yet (the acceptance screen is shown). `undefined`: not
   * known yet (e.g. offline), which never blocks the app.
   */
  acceptedTermsAt?: string | null
  /**
   * Password accounts: whether the email was confirmed by a link.
   * `undefined`: not known (offline, other providers); never shows the banner.
   */
  emailVerified?: boolean
}

// Set when the user ticks the terms checkbox and leaves for an OAuth provider,
// so the acceptance is recorded once the redirect brings them back signed in.
const TERMS_PENDING_KEY = "orbital_terms_accept_pending"

function readTermsPending(): boolean {
  try {
    return sessionStorage.getItem(TERMS_PENDING_KEY) === "1"
  } catch {
    return false
  }
}

function writeTermsPending(pending: boolean) {
  try {
    if (pending) sessionStorage.setItem(TERMS_PENDING_KEY, "1")
    else sessionStorage.removeItem(TERMS_PENDING_KEY)
  } catch {
    // Storage unavailable: the acceptance screen asks after sign-in instead.
  }
}

export const useUserStore = defineStore("user", () => {
  const currentUser = ref<UserSession | null>(null)
  const hasCompletedAuth = ref(false)
  const token = ref<string | null>(null)
  const sessionExpired = ref(false)
  const nicknameUpdateStatus = ref<"idle" | "pending" | "success" | "error">("idle")
  const nicknameUpdateError = ref<string | null>(null)
  const avatarUpdateStatus = ref<"idle" | "pending" | "success" | "error">("idle")
  const avatarUpdateError = ref<string | null>(null)

  const userId = computed(() => currentUser.value?.id ?? "")
  const nickname = computed(() => currentUser.value?.nickname ?? "User")
  const isAuthenticated = computed(() => !!currentUser.value && !!token.value)
  const authProvider = computed(() => currentUser.value?.authProvider || "guest")
  const isLoggedIn = computed(() => authProvider.value !== "guest")
  const isGuest = computed(
    () => authProvider.value === "guest" || currentUser.value?.isGuest === true,
  )
  const email = computed(() => currentUser.value?.email)
  const avatarUrl = computed(() => currentUser.value?.avatarUrl)
  const role = computed(() => currentUser.value?.role || "guest")
  const isSuperAdmin = computed(() => role.value === "super_admin")
  const needsTermsAcceptance = computed(
    () => isAuthenticated.value && currentUser.value?.acceptedTermsAt === null,
  )

  // Offline snapshots (rooms, messages, outbox) belong to this account only.
  watch(userId, (id) => setOfflineCacheUser(id), { immediate: true, flush: "sync" })

  function setUser(user: UserSession, authToken?: string, expiresAt?: string) {
    // Validate user object
    if (!user.id || !user.nickname || !user.authProvider || typeof user.isGuest !== "boolean") {
      console.error("Invalid user object provided:", user)
      throw new Error("Invalid user object: missing required fields")
    }

    console.log("Setting user:", {
      id: user.id,
      nickname: user.nickname,
      authProvider: user.authProvider,
      isGuest: user.isGuest,
      role: user.role,
    })

    currentUser.value = user
    if (authToken) {
      token.value = authToken
      setAuthToken(authToken)
    }
    if (expiresAt) {
      setTokenExpiry(expiresAt)
    }
    localStorage.setItem("orbital_user_id", user.id)
    localStorage.setItem("orbital_user_nickname", user.nickname)
    localStorage.setItem("orbital_user_auth_provider", user.authProvider)
    localStorage.setItem("orbital_user_is_guest", String(user.isGuest))
    localStorage.setItem("orbital_user_role", user.role)
    if (user.email) {
      localStorage.setItem("orbital_user_email", user.email)
    }
    if (user.avatarUrl) {
      localStorage.setItem("orbital_user_avatar", user.avatarUrl)
    }
  }

  async function updateNickname(newNickname: string) {
    if (!currentUser.value || !currentUser.value.id) {
      console.error("Cannot update nickname: no current user or user ID missing")
      return
    }

    nicknameUpdateStatus.value = "pending"
    nicknameUpdateError.value = null

    try {
      // Update local state immediately for responsive UI
      currentUser.value.nickname = newNickname
      localStorage.setItem("orbital_user_nickname", newNickname)

      // Send update to server via WebSocket (real-time)
      const { wsService } = await import("@/services/websocket")
      console.log("Sending nickname change:", {
        userId: currentUser.value.id,
        newNickname,
      })
      wsService.changeNickname(currentUser.value.id, newNickname)

      nicknameUpdateStatus.value = "success"
    } catch (error) {
      console.error("Failed to update nickname:", error)
      nicknameUpdateError.value = "Failed to update nickname. Please try again."
      nicknameUpdateStatus.value = "error"

      // Revert local change on failure
      if (currentUser.value) {
        currentUser.value.nickname = localStorage.getItem("orbital_user_nickname") || "User"
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
      localStorage.setItem("orbital_user_nickname", newNickname)
    }
  }

  async function updateAvatar(file: File): Promise<void> {
    if (!currentUser.value || !currentUser.value.id) {
      console.error("Cannot update avatar: no current user or user ID missing")
      return
    }

    avatarUpdateStatus.value = "pending"
    avatarUpdateError.value = null

    try {
      const response = await apiService.uploadAvatar(file)
      currentUser.value.avatarUrl = response.avatar_url
      localStorage.setItem("orbital_user_avatar", response.avatar_url)
      avatarUpdateStatus.value = "success"
    } catch (error) {
      console.error("Failed to update avatar:", error)
      avatarUpdateError.value = "Failed to update avatar. Please try again."
      avatarUpdateStatus.value = "error"
      throw error
    }
  }

  async function loadUserFromStorage(): Promise<UserSession | null> {
    const storedToken = localStorage.getItem("orbital_auth_token")
    const id = localStorage.getItem("orbital_user_id")
    const nickname = localStorage.getItem("orbital_user_nickname")
    const authProvider = localStorage.getItem("orbital_user_auth_provider") as AuthProvider | null
    const isGuestStored = localStorage.getItem("orbital_user_is_guest")
    const hasCompletedAuthValue = localStorage.getItem("orbital_has_completed_auth")

    hasCompletedAuth.value = hasCompletedAuthValue === "true"

    if (storedToken && id && nickname && authProvider) {
      // Set token for API calls
      token.value = storedToken
      setAuthToken(storedToken)

      const user: UserSession = {
        id,
        nickname,
        authProvider,
        isGuest: isGuestStored === "true",
        role: (localStorage.getItem("orbital_user_role") as UserSession["role"]) || "guest",
        email: localStorage.getItem("orbital_user_email") || undefined,
        avatarUrl: localStorage.getItem("orbital_user_avatar") || undefined,
      }
      currentUser.value = user

      // Try to validate token by fetching current user
      try {
        const freshUser = await apiService.getCurrentUser()
        // Update user data from server (convert snake_case to camelCase)
        user.email = freshUser.email
        user.avatarUrl = freshUser.avatar_url
        user.nickname = freshUser.nickname
        user.role = freshUser.role
        user.acceptedTermsAt = freshUser.accepted_terms_at
        user.emailVerified = freshUser.email_verified
        localStorage.setItem("orbital_user_role", freshUser.role)

        // Load user's sound pack preference
        if (freshUser.sound_pack) {
          setUserSoundPack(freshUser.sound_pack)
        }

        currentUser.value = { ...user }
      } catch (error) {
        const status = (error as ApiError).status
        if (status === 401) {
          // The API interceptor already cleared state and flagged the session
          // as expired - just report failure to the caller.
          console.warn("Token validation failed (session expired)")
          return null
        }
        if (status === 403 || status === 404) {
          // Token is valid but the user is gone / forbidden.
          console.warn("Token validation failed, clearing auth state")
          clearUser()
          return null
        }
        // Transient failure (network error / 5xx): keep the stored session so a
        // brief backend hiccup doesn't log the user out. A real expiry is still
        // caught by the 401 interceptor on the next authenticated request.
        console.warn("Token validation unavailable, keeping stored session:", error)
        return user
      }

      return user
    }
    return null
  }

  function clearUser() {
    currentUser.value = null
    hasCompletedAuth.value = false
    token.value = null
    sessionExpired.value = false
    clearAuthToken()
    localStorage.removeItem("orbital_user_id")
    localStorage.removeItem("orbital_user_nickname")
    localStorage.removeItem("orbital_user_auth_provider")
    localStorage.removeItem("orbital_user_email")
    localStorage.removeItem("orbital_user_avatar")
    localStorage.removeItem("orbital_has_completed_auth")
    localStorage.removeItem("orbital_user_is_guest")
    localStorage.removeItem("orbital_user_role")
  }

  // Called by the API layer when a request is rejected with 401 and the token
  // could not be refreshed: drop all local auth state and surface the reason so
  // the AuthView can explain why the user landed back on the login screen.
  // Set while logout() runs: the server closes this device's sockets as part
  // of the logout, which must not read as "session expired".
  let loggingOut = false

  function handleSessionExpired() {
    if (loggingOut) return
    console.warn("Session expired, returning to authentication")
    clearUser()
    sessionExpired.value = true
  }

  /** Password account whose email isn't confirmed yet (shows the banner). */
  const needsEmailVerification = computed(
    () =>
      isAuthenticated.value &&
      currentUser.value?.authProvider === "password" &&
      currentUser.value?.emailVerified === false,
  )

  function setEmailVerified(value: boolean) {
    if (currentUser.value) currentUser.value = { ...currentUser.value, emailVerified: value }
  }

  /** Signs in on this device with the session a password reset returned. */
  function completePasswordReset(response: AuthResponse) {
    const user: UserSession = {
      id: response.user.id,
      nickname: response.user.nickname,
      authProvider: "password",
      isGuest: false,
      role: response.user.role || "user",
      email: response.user.email,
      avatarUrl: response.user.avatar_url,
      acceptedTermsAt: response.user.accepted_terms_at,
      emailVerified: response.user.email_verified,
    }
    sessionExpired.value = false
    setUser(user, response.token, response.expires_at)
    hasCompletedAuth.value = true
    localStorage.setItem("orbital_has_completed_auth", "true")
  }

  function setAcceptedTermsAt(value: string | null | undefined) {
    if (currentUser.value) currentUser.value = { ...currentUser.value, acceptedTermsAt: value }
  }

  /** Records acceptance of the Terms of Service and Privacy Policy. */
  async function acceptTerms() {
    const user = await apiService.acceptTerms()
    writeTermsPending(false)
    setAcceptedTermsAt(user.accepted_terms_at ?? new Date().toISOString())
  }

  // Sign-ins that don't return our user record (OAuth, QR) learn the
  // acceptance state here, and record the acceptance ticked before an OAuth
  // redirect.
  async function syncTermsAcceptance() {
    if (!currentUser.value || currentUser.value.acceptedTermsAt) {
      writeTermsPending(false)
      return
    }
    try {
      if (readTermsPending()) {
        await acceptTerms()
        return
      }
      if (currentUser.value.acceptedTermsAt === undefined) {
        const freshUser = await apiService.getCurrentUser()
        setAcceptedTermsAt(freshUser.accepted_terms_at)
      }
    } catch (error) {
      // Unknown stays unknown: the next startup's /auth/me check asks again.
      console.warn("Could not sync terms acceptance:", error)
    }
  }

  function loginWithProvider(provider: "discord" | "google", acceptedTerms = false) {
    writeTermsPending(acceptedTerms)
    // Redirect to OAuth provider
    if (provider === "discord") {
      apiService.initiateDiscordLogin()
    } else if (provider === "google") {
      apiService.initiateGoogleLogin()
    }
  }

  async function continueAsGuest(acceptedTerms = false) {
    try {
      const response = await apiService.guestLogin(acceptedTerms)
      const user: UserSession = {
        id: response.user.id,
        nickname: response.user.nickname,
        authProvider: "guest",
        isGuest: true,
        role: response.user.role || "guest",
        email: response.user.email,
        avatarUrl: response.user.avatar_url,
        acceptedTermsAt: response.user.accepted_terms_at,
        emailVerified: response.user.email_verified,
      }
      sessionExpired.value = false
      setUser(user, response.token, response.expires_at)
      hasCompletedAuth.value = true
      localStorage.setItem("orbital_has_completed_auth", "true")
    } catch (error) {
      console.error("Guest login failed:", error)
      throw error
    }
  }

  async function loginWithPassword(login: string, password: string) {
    try {
      const response = await apiService.loginPassword(login, password)
      const user: UserSession = {
        id: response.user.id,
        nickname: response.user.nickname,
        authProvider: "password",
        isGuest: false,
        role: response.user.role || "user",
        email: response.user.email,
        avatarUrl: response.user.avatar_url,
        acceptedTermsAt: response.user.accepted_terms_at,
        emailVerified: response.user.email_verified,
      }
      sessionExpired.value = false
      setUser(user, response.token, response.expires_at)
      hasCompletedAuth.value = true
      localStorage.setItem("orbital_has_completed_auth", "true")
    } catch (error) {
      console.error("Password login failed:", error)
      throw error
    }
  }

  async function register(
    email: string,
    nickname: string,
    password: string,
    acceptedTerms: boolean,
  ) {
    try {
      const response = await apiService.register(email, nickname, password, acceptedTerms)
      const user: UserSession = {
        id: response.user.id,
        nickname: response.user.nickname,
        authProvider: "password",
        isGuest: false,
        role: response.user.role || "user",
        email: response.user.email,
        avatarUrl: response.user.avatar_url,
        acceptedTermsAt: response.user.accepted_terms_at,
      }
      sessionExpired.value = false
      setUser(user, response.token, response.expires_at)
      hasCompletedAuth.value = true
      localStorage.setItem("orbital_has_completed_auth", "true")
    } catch (error) {
      console.error("Registration failed:", error)
      throw error
    }
  }

  async function logout() {
    loggingOut = true
    try {
      // While the session is still valid, so the server drops this device.
      await unregisterPush()
      try {
        // Ends this device's session only; other devices stay signed in.
        await apiService.logout()
      } catch {
        console.warn("Logout API call failed, clearing locally anyway")
      }
      // Cached chat media must not outlive the account on a shared device.
      await clearMediaCache()
      await clearOfflineCache()
      clearUser()
    } finally {
      loggingOut = false
    }
  }

  // Deletes the account, then clears this device like logout(). Throws (and
  // keeps the user signed in) when the server refuses, e.g. 403 on a wrong
  // confirmation. The server closes every socket with 4401 as part of it.
  async function deleteAccount(confirm: { password?: string; nickname?: string }) {
    loggingOut = true
    try {
      await apiService.deleteAccount(confirm)
      // The server already dropped the push token; this only unregisters FCM.
      await unregisterPush()
      await clearMediaCache()
      await clearOfflineCache()
      clearUser()
    } finally {
      loggingOut = false
    }
  }

  // Handle OAuth callback
  function handleOAuthCallback(tokenStr: string, userData: UserSession, expiresAt?: string) {
    sessionExpired.value = false
    setUser(userData, tokenStr, expiresAt)
    hasCompletedAuth.value = true
    localStorage.setItem("orbital_has_completed_auth", "true")
    void syncTermsAcceptance()
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
    role,
    isSuperAdmin,
    needsTermsAcceptance,
    acceptTerms,
    needsEmailVerification,
    setEmailVerified,
    completePasswordReset,
    hasCompletedAuth,
    sessionExpired,
    nicknameUpdateStatus,
    nicknameUpdateError,
    avatarUpdateStatus,
    avatarUpdateError,
    setUser,
    updateNickname,
    updateNicknameLocally,
    updateUserNickname,
    updateAvatar,
    loadUserFromStorage,
    clearUser,
    handleSessionExpired,
    loginWithProvider,
    continueAsGuest,
    loginWithPassword,
    register,
    logout,
    deleteAccount,
    handleOAuthCallback,
  }
})
