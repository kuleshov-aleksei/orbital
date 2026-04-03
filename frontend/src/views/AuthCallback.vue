<template>
  <div class="callback-view fixed inset-0 bg-gray-900 flex items-center justify-center z-50">
    <div class="text-center">
      <div
        class="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse">
        <PhPlanet class="w-12 h-12 text-white" />
      </div>

      <h1 class="text-2xl font-bold text-white mb-2">
        {{ statusMessage }}
      </h1>

      <p v-if="error" class="text-red-400 mt-2">
        {{ error }}
      </p>

      <p v-else class="text-gray-400">Please wait while we complete your sign in...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { useUserStore, type AuthProvider } from "@/stores/user"
import { PhPlanet } from "@phosphor-icons/vue"
import { apiService, setAuthToken } from "@/services/api"

const router = useRouter()
const userStore = useUserStore()

const statusMessage = ref("Completing sign in...")
const error = ref("")

function parseAuthParams(): { token: string | null; expires: string | null } {
  const url = window.location.href

  if (url.startsWith("orbital://")) {
    const pathAndQuery = url.replace("orbital://", "")
    const [, queryString] = pathAndQuery.split("?")
    const urlParams = new URLSearchParams(queryString || "")
    return {
      token: urlParams.get("token"),
      expires: urlParams.get("expires"),
    }
  }

  const urlParams = new URLSearchParams(window.location.search)
  return {
    token: urlParams.get("token"),
    expires: urlParams.get("expires"),
  }
}

onMounted(async () => {
  try {
    const { token, expires } = parseAuthParams()

    console.log("[AuthCallback] Extracted token:", token ? token.substring(0, 20) + "..." : "null")
    console.log("[AuthCallback] Token expires:", expires)

    if (!token) {
      console.error("[AuthCallback] No token found in URL")
      error.value = "No authentication token received"
      statusMessage.value = "Authentication failed"
      setTimeout(() => {
        void router.push("/")
      }, 3000)
      return
    }

    setAuthToken(token)

    statusMessage.value = "Loading user data..."
    console.log("[AuthCallback] Fetching user data from API...")
    const user = await apiService.getCurrentUser()
    console.log("[AuthCallback] User data received:", user)

    const userSession = {
      id: user.id,
      nickname: user.nickname,
      authProvider: user.auth_provider as AuthProvider,
      isGuest: user.is_guest,
      role: user.role,
      email: user.email,
      avatarUrl: user.avatar_url,
    }

    userStore.handleOAuthCallback(token, userSession)

    statusMessage.value = "Welcome!"
    setTimeout(() => {
      void router.push("/")
    }, 500)
  } catch (err) {
    error.value = err instanceof Error ? err.message : "An unexpected error occurred"
    statusMessage.value = "Authentication failed"

    setAuthToken(null)

    setTimeout(() => {
      void router.push("/")
    }, 3000)
  }
})
</script>
