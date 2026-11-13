import type { CapacitorConfig } from "@capacitor/cli"

// Android app shell. The web bundle is built by vite.config.mobile.ts into
// ../mobile/dist and shipped inside the APK (native and web always match).
// The native project lives in ../mobile/android (see AGENTS.md "Mobile").
//
// Origin inside the WebView is https://localhost (http://localhost for dev builds
// against a plain-HTTP backend); the backend always allows both (config.IsAppOrigin).
const devServerUrl = process.env.CAP_SERVER_URL
// `make build-android-dev` points the app at a plain-HTTP backend (Headscale/LAN IP).
// From an https://localhost page those http:// / ws:// calls are mixed content, and
// current WebViews block mixed WebSockets and images even with allowMixedContent.
// So dev builds serve the app from http://localhost instead: no mixed content, and
// localhost still counts as a secure context (getUserMedia works). Production stays https.
const httpBackend = (process.env.VITE_BACKEND_URL ?? "").startsWith("http://")

const config: CapacitorConfig = {
  appId: "app.orbital",
  appName: "The Orbital",
  webDir: "../mobile/dist",
  backgroundColor: "#1e1f22",
  android: {
    path: "../mobile/android",
  },
  server: {
    androidScheme: httpBackend ? "http" : "https",
    // `make dev-android` sets CAP_SERVER_URL for live reload; release builds never do.
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  plugins: {
    // Edge-to-edge. "css" also injects --safe-area-inset-* variables, which old
    // Android WebViews (< Chromium 140) don't expose through env(); style.css reads both.
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "DARK",
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#1e1f22",
    },
    PushNotifications: {
      // Foreground pushes are handled in-app (badge + sound), not as system banners.
      presentationOptions: [],
    },
  },
}

export default config
