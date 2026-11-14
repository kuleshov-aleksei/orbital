import { ref } from "vue"
import { apiService, type AuthResponse } from "@/services/api"
import { useUserStore, type UserSession } from "@/stores/user"
import { debugWarn } from "@/utils/debug"

/**
 * OAuth sign-in for the Android app (Capacitor).
 *
 * 1. `startAppOAuth` creates a PKCE-style verifier, asks the backend for the
 *    provider URL (`client=android`, `code_challenge`) and opens it in a Custom Tab.
 * 2. The backend's app callback redirects to `orbital://auth/callback?code=…&state=…`
 *    (`orbital-dev://` for the "Orbital Dev" build), which Android routes to the
 *    app (intent-filter in AndroidManifest.xml).
 * 3. `setupAppOAuth` catches the deep link, checks the state, and trades the code
 *    plus verifier for a session at `POST /api/auth/exchange`.
 *
 * The deep link only carries a one-time code: any app can register the scheme,
 * but the code is useless without the verifier that stays inside this app.
 * Capacitor plugins are imported lazily, so web/Electron bundles don't load them.
 */

const PENDING_KEY = "orbital_app_oauth_pending"
// Matches the backend's OAuth state TTL (oauthStateTTL).
const PENDING_TTL_MS = 5 * 60 * 1000

interface PendingAppOAuth {
  state: string
  verifier: string
  createdAt: number
}

/** Last sign-in failure, shown by AuthView. */
export const appOAuthError = ref("")

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function createVerifier(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

// Kept in localStorage, not memory: Android may kill the app while the Custom
// Tab is open, and the deep link then cold-starts it.
function savePending(pending: PendingAppOAuth): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // Without storage the callback is rejected and the user can retry.
  }
}

function takePending(): PendingAppOAuth | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    localStorage.removeItem(PENDING_KEY)
    if (!raw) return null
    const pending = JSON.parse(raw) as PendingAppOAuth
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) return null
    return pending
  } catch {
    return null
  }
}

/** The "Orbital Dev" build (app.orbital.dev) has its own deep link scheme. */
async function appClient(): Promise<"android" | "android-dev"> {
  const { App } = await import("@capacitor/app")
  const { id } = await App.getInfo()
  return id.endsWith(".dev") ? "android-dev" : "android"
}

export async function startAppOAuth(provider: "discord" | "google"): Promise<void> {
  appOAuthError.value = ""
  try {
    const [{ verifier, challenge }, client] = await Promise.all([createVerifier(), appClient()])
    const { url, state } = await apiService.getOAuthUrl(provider, client, challenge)
    savePending({ state, verifier, createdAt: Date.now() })
    const { Browser } = await import("@capacitor/browser")
    await Browser.open({ url })
  } catch (error) {
    debugWarn("[AppOAuth] start failed", error)
    appOAuthError.value = "Couldn't start sign-in. Please try again."
  }
}

function toUserSession(response: AuthResponse): UserSession {
  const provider = response.user.auth_provider
  return {
    id: response.user.id,
    nickname: response.user.nickname,
    authProvider:
      provider === "discord" || provider === "google" || provider === "password"
        ? provider
        : "password",
    isGuest: response.user.is_guest,
    role: response.user.role || "user",
    email: response.user.email,
    avatarUrl: response.user.avatar_url,
  }
}

async function handleCallbackUrl(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return
  }
  // Non-special schemes put "auth" in host and "/callback" in pathname.
  if (url.host !== "auth" || url.pathname !== "/callback") return

  const { Browser } = await import("@capacitor/browser")
  void Browser.close().catch(() => {})

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const pending = takePending()
  if (!code || !state || !pending || pending.state !== state) {
    appOAuthError.value = "Sign-in expired or was started elsewhere. Please try again."
    return
  }

  try {
    const response = await apiService.exchangeAppLoginCode(code, state, pending.verifier)
    appOAuthError.value = ""
    useUserStore().handleOAuthCallback(response.token, toUserSession(response), response.expires_at)
  } catch (error) {
    debugWarn("[AppOAuth] code exchange failed", error)
    appOAuthError.value = "Sign-in failed. Please try again."
  }
}

/**
 * Listens for the OAuth deep link. Call once at startup inside the Android app;
 * also handles the link that cold-started the app. Returns a cleanup function.
 */
export async function setupAppOAuth(): Promise<() => void> {
  const { App } = await import("@capacitor/app")
  const handle = await App.addListener("appUrlOpen", ({ url }) => void handleCallbackUrl(url))
  const launch = await App.getLaunchUrl()
  if (launch?.url) void handleCallbackUrl(launch.url)
  return () => void handle.remove()
}
