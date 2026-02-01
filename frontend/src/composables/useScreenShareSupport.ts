import { computed } from 'vue'

/**
 * Detects if screen sharing is supported in the current browser environment.
 * Mobile browsers (iOS Safari, Android Chrome) do not support getDisplayMedia().
 */
export function useScreenShareSupport() {
  const isScreenShareSupported = computed(() => {
    // Check if getDisplayMedia API exists
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      return false
    }

    // Check for mobile user agents (iOS and Android)
    const userAgent = navigator.userAgent.toLowerCase()
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent)
    
    if (isMobile) {
      return false
    }

    // Desktop browsers with getDisplayMedia should work
    return true
  })

  return {
    isScreenShareSupported
  }
}
