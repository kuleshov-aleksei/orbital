import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { apiService, type AppConfig, type AttachmentsConfig } from "@/services/api"

// Last config the server sent, so the app starts with the right features
// (text channels, attachments) when the server is unreachable.
const CONFIG_CACHE_KEY = "orbital_config_cache"

export const useConfigStore = defineStore("config", () => {
  // State
  const minUsers = ref(2)
  const maxUsers = ref(10)
  const defaultMaxUsers = ref(10)
  // Text channels need Meilisearch on the backend.
  const textChannelsEnabled = ref(false)
  // Attachments need S3 on the backend; null when disabled.
  const attachments = ref<AttachmentsConfig | null>(null)
  // Third-party GIF search provider (`klipy`/`giphy`); empty when disabled.
  const gifProvider = ref("")
  // The server can send email (verification, password reset).
  const emailEnabled = ref(false)
  const isLoaded = ref(false)
  const isLoading = ref(false)

  // Getters
  const roomConfig = computed(() => ({
    min_users: minUsers.value,
    max_users: maxUsers.value,
    default_max_users: defaultMaxUsers.value,
  }))

  function apply(config: AppConfig) {
    minUsers.value = config.room.min_users
    maxUsers.value = config.room.max_users
    defaultMaxUsers.value = config.room.default_max_users
    textChannelsEnabled.value = config.text_channels === true
    attachments.value = config.attachments ?? null
    gifProvider.value = config.gif_provider ?? ""
    emailEnabled.value = config.email === true
  }

  /** Applies the cached config; true when there was one. */
  function hydrateFromCache(): boolean {
    try {
      const raw = localStorage.getItem(CONFIG_CACHE_KEY)
      if (!raw) return false
      apply(JSON.parse(raw) as AppConfig)
      return true
    } catch {
      return false
    }
  }

  // Actions
  /** The in-flight config request, shared by every caller. */
  let loadPromise: Promise<void> | null = null

  async function loadConfig(): Promise<void> {
    if (isLoaded.value) return
    // Callers that raced the first request wait for it instead of returning
    // early with the defaults (the composer needs `gif_provider`).
    if (loadPromise) return loadPromise

    isLoading.value = true
    loadPromise = (async () => {
      try {
        const config = await apiService.getConfig()
        apply(config)
        isLoaded.value = true
        try {
          localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config))
        } catch {
          // storage full or unavailable: the next start just waits for the server
        }
      } catch (error) {
        console.error("Failed to load config:", error)
        // Keep the cached (or default) values; a reconnect retries.
      } finally {
        isLoading.value = false
      }
    })()
    try {
      await loadPromise
    } finally {
      loadPromise = null
    }
  }

  return {
    minUsers,
    maxUsers,
    defaultMaxUsers,
    textChannelsEnabled,
    attachments,
    gifProvider,
    emailEnabled,
    isLoaded,
    isLoading,
    roomConfig,
    loadConfig,
    hydrateFromCache,
  }
})
