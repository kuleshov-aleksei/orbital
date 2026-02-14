import { computed } from "vue"

/**
 * Detects if screen sharing is supported in the current browser environment.
 * Mobile browsers (iOS Safari, Android Chrome) do not support getDisplayMedia().
 */
export function useScreenShareSupport() {
  const isScreenShareSupported = computed(() => {
    // Check if getDisplayMedia API exists
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== "function"
    ) {
      return false
    }

    // Check for mobile user agents (iOS and Android)
    const userAgent = navigator.userAgent.toLowerCase()
    const isMobile =
      /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
        userAgent,
      )

    if (isMobile) {
      return false
    }

    // Desktop browsers with getDisplayMedia should work
    return true
  })

  /**
   * Detects if screen sharing audio is supported.
   * System audio capture via getDisplayMedia is only supported in Chrome and Edge.
   * Firefox and Safari do not support audio capture with screen sharing.
   */
  const isScreenShareAudioSupported = computed(() => {
    // Audio sharing is only supported in Chrome and Chromium-based browsers (Edge, Opera, Brave)
    const userAgent = navigator.userAgent.toLowerCase()

    // Check for Chrome/Chromium (but not Edge, which also uses Chrome in user agent)
    const isChrome = /chrome/.test(userAgent) && !/edge|edg/.test(userAgent)
    const isEdge = /edge|edg/.test(userAgent)
    const isOpera = /opr|opera/.test(userAgent)
    const isBrave = /brave/.test(userAgent)

    // Check for browsers that don't support audio
    const isFirefox = /firefox/.test(userAgent)
    const isSafari = /safari/.test(userAgent) && !/chrome/.test(userAgent)

    // Only Chrome and Chromium-based browsers support system audio capture
    // Note: Firefox and Safari don't support system audio capture
    void isFirefox
    void isSafari
    return isChrome || isEdge || isOpera || isBrave
  })

  return {
    isScreenShareSupported,
    isScreenShareAudioSupported,
  }
}
