import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { isElectron } from "@/services/electron"

export type ConnectionQuality = "sub-wave" | "excellent" | "good" | "fair" | "poor"
export type MobileView = "rooms" | "room"

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "not-available"

export const useAppStore = defineStore("app", () => {
  // State
  const isLoading = ref(false)
  const isConnecting = ref(false)
  const errorMessage = ref("")
  const isMobile = ref(false)
  const mobileView = ref<MobileView>("rooms")
  const mobileUserSidebarOpen = ref(false)
  const mobileSidebarOpen = ref(false)

  // Connection state
  const connectionPing = ref(0)
  const connectionQuality = ref<ConnectionQuality>("excellent")

  // Update state
  const updateState = ref<UpdateState>("idle")
  const updateError = ref<string | null>(null)
  const updateProgress = ref({
    percent: 0,
    transferred: 0,
    total: 0,
  })

  // Getters
  const hasError = computed(() => !!errorMessage.value)
  const isRoomView = computed(() => mobileView.value === "room")
  const isRoomsView = computed(() => mobileView.value === "rooms")

  // Actions
  function setLoading(loading: boolean) {
    isLoading.value = loading
  }

  function setConnecting(connecting: boolean) {
    isConnecting.value = connecting
  }

  function setError(message: string) {
    errorMessage.value = message
  }

  function clearError() {
    errorMessage.value = ""
  }

  function setMobile(mobile: boolean) {
    isMobile.value = isElectron() ? false : mobile
  }

  function checkMobile() {
    if (isElectron()) {
      isMobile.value = false
      return
    }
    isMobile.value = window.innerWidth < 1024 // lg breakpoint
  }

  function setMobileView(view: MobileView) {
    mobileView.value = view
  }

  function showRoomView() {
    mobileView.value = "room"
  }

  function showRoomsView() {
    mobileView.value = "rooms"
  }

  function toggleMobileUserSidebar() {
    mobileUserSidebarOpen.value = !mobileUserSidebarOpen.value
    mobileSidebarOpen.value = false
  }

  function closeMobileUserSidebar() {
    mobileUserSidebarOpen.value = false
  }

  function closeMobileSidebar() {
    mobileSidebarOpen.value = false
  }

  function closeAllMobileSidebars() {
    mobileSidebarOpen.value = false
    mobileUserSidebarOpen.value = false
  }

  function setConnectionPing(ping: number) {
    connectionPing.value = ping
  }

  function setConnectionQuality(quality: ConnectionQuality) {
    connectionQuality.value = quality
  }

  function updateConnectionStatus(ping: number, quality: ConnectionQuality) {
    connectionPing.value = ping
    connectionQuality.value = quality
  }

  function setUpdateState(state: UpdateState, error: string | null = null) {
    updateState.value = state
    updateError.value = error
  }

  function setUpdateProgress(percent: number, transferred: number, total: number) {
    updateProgress.value = { percent, transferred, total }
  }

  return {
    isLoading,
    isConnecting,
    errorMessage,
    isMobile,
    mobileView,
    mobileUserSidebarOpen,
    mobileSidebarOpen,
    connectionPing,
    connectionQuality,
    hasError,
    isRoomView,
    isRoomsView,
    updateState,
    updateError,
    updateProgress,
    setLoading,
    setConnecting,
    setError,
    clearError,
    setMobile,
    checkMobile,
    setMobileView,
    showRoomView,
    showRoomsView,
    toggleMobileUserSidebar,
    closeMobileUserSidebar,
    closeMobileSidebar,
    closeAllMobileSidebars,
    setConnectionPing,
    setConnectionQuality,
    updateConnectionStatus,
    setUpdateState,
    setUpdateProgress,
  }
})
