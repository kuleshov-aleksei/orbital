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
  async function loadConfig() {
    if (isLoading.value || isLoaded.value) {
      return
    }

    isLoading.value = true
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
  }

  return {
    minUsers,
    maxUsers,
    defaultMaxUsers,
    textChannelsEnabled,
    attachments,
    isLoaded,
    isLoading,
    roomConfig,
    loadConfig,
    hydrateFromCache,
  }
})
