import { onBeforeUnmount } from "vue"
import type { PluginListenerHandle } from "@capacitor/core"
import { isCapacitor } from "@/services/platform"
import { useAppStore } from "@/stores/app"
import { debugWarn } from "@/utils/debug"

/**
 * Android shell integration: system bar styling, hardware back button, app
 * resume and the OAuth deep link. Call once from App.vue; a no-op outside the
 * Android app.
 */
export function useNativeShell(options: { onResume?: () => void } = {}) {
  if (!isCapacitor()) return

  const appStore = useAppStore()
  const handles: PluginListenerHandle[] = []
  let disposed = false
  let stopAppOAuth: (() => void) | null = null

  async function setup() {
    // System bars (edge-to-edge, dark icons) are configured in capacitor.config.ts.
    const [{ App }, { SplashScreen }] = await Promise.all([
      import("@capacitor/app"),
      import("@capacitor/splash-screen"),
    ])
    void SplashScreen.hide()

    const listeners = await Promise.all([
      // Back: close drawers, then leave the room view, then send the app to the
      // background. Never exit: that would drop an active call.
      App.addListener("backButton", () => {
        if (appStore.mobileUserSidebarOpen || appStore.mobileSidebarOpen) {
          appStore.closeAllMobileSidebars()
        } else if (appStore.mobileView === "room") {
          appStore.showRoomsView()
        } else {
          void App.minimizeApp()
        }
      }),
      App.addListener("resume", () => options.onResume?.()),
    ])

    if (disposed) {
      listeners.forEach((h) => void h.remove())
    } else {
      handles.push(...listeners)
    }

    // OAuth sign-in comes back through a deep link (services/oauthApp.ts).
    const { setupAppOAuth } = await import("@/services/oauthApp")
    const stopOAuth = await setupAppOAuth()
    if (disposed) stopOAuth()
    else stopAppOAuth = stopOAuth
  }

  void setup().catch((err) => debugWarn("[NativeShell] setup failed", err))

  onBeforeUnmount(() => {
    disposed = true
    handles.forEach((h) => void h.remove())
    stopAppOAuth?.()
  })
}
