import type { User } from "@/types"
import { debugError } from "@/utils/debug"

export const API_BASE = typeof __BACKEND_URL__ !== "undefined" ? `${__BACKEND_URL__}/api` : "/api"

export const BACKEND_BASE = typeof __BACKEND_URL__ !== "undefined" ? __BACKEND_URL__ : ""

export function resolveUrl(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.startsWith("http://") ||
    relativePath.startsWith("https://") ||
    relativePath.startsWith("data:")
  ) {
    return relativePath
  }
  if (relativePath.startsWith("//")) {
    return `https:${relativePath}`
  }
  if (relativePath.startsWith("/")) {
    return BACKEND_BASE ? `${BACKEND_BASE}${relativePath}` : relativePath
  }
  return relativePath
}

let currentToken: string | null = null

export function setAuthToken(token: string | null) {
  currentToken = token
  if (token) {
    localStorage.setItem("orbital_auth_token", token)
  } else {
    localStorage.removeItem("orbital_auth_token")
  }
}

export function getAuthToken(): string | null {
  if (!currentToken) {
    currentToken = localStorage.getItem("orbital_auth_token")
  }
  return currentToken
}

export function clearAuthToken() {
  currentToken = null
  localStorage.removeItem("orbital_auth_token")
}

export interface ICEServer {
  urls: string[]
  username?: string
  credential?: string
}

export interface TURNConfigResponse {
  ice_servers: ICEServer[]
  ttl: number
}

export interface AuthResponse {
  token: string
  user: User
  expires_at: string
}

export interface AuthStatus {
  discord_enabled: boolean
  google_enabled: boolean
  password_enabled: boolean
}

export interface RoomConfig {
  min_users: number
  max_users: number
  default_max_users: number
}

export interface AppConfig {
  room: RoomConfig
}

export interface LiveKitTokenResponse {
  token: string
  room_url: string
}

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    }

    const token = getAuthToken()
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers,
      ...options,
    })

    if (!response.ok) {
      if (response.status === 413) {
        throw new Error("File too large. Maximum size is 30MB.")
      }
      const errorText = await response.text()
      throw new Error(errorText || `Upload failed (${response.status})`)
    }

    return (await response.json()) as T
  } catch (error) {
    debugError(`API request failed to ${endpoint}:`, error)
    throw error
  }
}

export const generateUserId = (): string => {
  return Math.random().toString(36).substr(2, 12) + Date.now().toString(36)
}

export const generateNickname = (userId?: string): string => {
  if (userId) {
    return `User-${userId.substr(0, 6)}`
  }
  return `User-${Math.random().toString(36).substr(2, 6)}`
}
