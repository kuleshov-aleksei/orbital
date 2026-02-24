import { defineStore } from "pinia"
import { ref, computed } from "vue"

export type ConnectionQuality = "excellent" | "good" | "fair" | "poor"
export type MobileView = "rooms" | "room"

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
    isMobile.value = mobile
  }

  function checkMobile() {
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
  }
})
