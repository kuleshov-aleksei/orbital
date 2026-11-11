import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { apiService, type AttachmentsConfig } from "@/services/api"

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

  // Actions
  async function loadConfig() {
    if (isLoading.value || isLoaded.value) {
      return
    }

    isLoading.value = true
    try {
      const config = await apiService.getConfig()
      minUsers.value = config.room.min_users
      maxUsers.value = config.room.max_users
      defaultMaxUsers.value = config.room.default_max_users
      textChannelsEnabled.value = config.text_channels === true
      attachments.value = config.attachments ?? null
      isLoaded.value = true
    } catch (error) {
      console.error("Failed to load config:", error)
      // Keep default values on error
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
  }
})
