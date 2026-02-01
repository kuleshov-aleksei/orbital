import { ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores'

export function useMobileState() {
  const appStore = useAppStore()
  const isMobile = ref(false)

  const checkMobile = () => {
    appStore.checkMobile()
    isMobile.value = appStore.isMobile
  }

  const setMobileView = (view: 'rooms' | 'room') => {
    appStore.setMobileView(view)
  }

  const showRoomView = () => {
    appStore.showRoomView()
  }

  const showRoomsView = () => {
    appStore.showRoomsView()
  }

  const toggleMobileUserSidebar = () => {
    appStore.toggleMobileUserSidebar()
  }

  const closeMobileUserSidebar = () => {
    appStore.closeMobileUserSidebar()
  }

  const closeAllMobileSidebars = () => {
    appStore.closeAllMobileSidebars()
  }

  // Auto-initialize on mount
  onMounted(() => {
    checkMobile()
    window.addEventListener('resize', checkMobile)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', checkMobile)
  })

  return {
    isMobile,
    mobileView: appStore.mobileView,
    mobileUserSidebarOpen: appStore.mobileUserSidebarOpen,
    mobileSidebarOpen: appStore.mobileSidebarOpen,
    checkMobile,
    setMobileView,
    showRoomView,
    showRoomsView,
    toggleMobileUserSidebar,
    closeMobileUserSidebar,
    closeAllMobileSidebars
  }
}
