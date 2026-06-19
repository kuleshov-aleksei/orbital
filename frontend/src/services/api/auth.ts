import { apiRequest, setAuthToken, clearAuthToken, API_BASE } from "./client"
import type { AuthResponse, AuthStatus } from "./client"
import type { User } from "@/types"
import { isElectron, openExternal, oauthAuthenticate } from "@/services/electron"

export function getOAuthUrl(
  provider: "discord" | "google",
  isElectronApp = false,
): Promise<{ url: string; state: string }> {
  const endpoint = isElectronApp ? `/auth/${provider}/url?electron=true` : `/auth/${provider}/url`
  return apiRequest<{ url: string; state: string }>(endpoint)
}

export async function initiateOAuthLogin(provider: "discord" | "google"): Promise<void> {
  if (isElectron()) {
    await oauthAuthenticate()
    const { url } = await getOAuthUrl(provider, true)
    await openExternal(url)
  } else {
    window.location.href = `${API_BASE}/auth/${provider}/login`
  }
}

export function initiateDiscordLogin(): void {
  void initiateOAuthLogin("discord")
}

export function initiateGoogleLogin(): void {
  void initiateOAuthLogin("google")
}

export async function guestLogin(): Promise<AuthResponse> {
  const response = await apiRequest<AuthResponse>("/auth/guest", {
    method: "POST",
  })
  setAuthToken(response.token)
  return response
}

export async function register(
  email: string,
  nickname: string,
  password: string,
): Promise<AuthResponse> {
  const request = { email, nickname, password }
  const response = await apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(request),
  })
  setAuthToken(response.token)
  return response
}

export async function loginPassword(login: string, password: string): Promise<AuthResponse> {
  const request = { login, password }
  const response = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(request),
  })
  setAuthToken(response.token)
  return response
}

export async function logout(): Promise<{ status: string; message: string }> {
  const response = await apiRequest<{ status: string; message: string }>("/auth/logout", {
    method: "POST",
  })
  clearAuthToken()
  return response
}

export function getCurrentUser(): Promise<User> {
  return apiRequest<User>("/auth/me")
}

export function getAuthStatus(): Promise<AuthStatus> {
  return apiRequest<AuthStatus>("/auth/status")
}
