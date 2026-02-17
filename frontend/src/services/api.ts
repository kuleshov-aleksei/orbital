import {
  Room,
  User,
  CreateRoomData,
  UpdateRoomData,
  Category,
  CreateCategoryData,
  RenameCategoryData,
  DeleteCategoryData,
  PublicUser,
} from "@/types"

const API_BASE = "/api"

// Token storage
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

// TURN server configuration types
export interface ICEServer {
  urls: string[]
  username?: string
  credential?: string
}

export interface TURNConfigResponse {
  ice_servers: ICEServer[]
  ttl: number
}

// Auth response types
export interface AuthResponse {
  token: string
  user: User
  expires_at: string
}

export interface AuthStatus {
  discord_enabled: boolean
  google_enabled: boolean
}

// Room configuration types
export interface RoomConfig {
  min_users: number
  max_users: number
  default_max_users: number
}

// General application configuration
export interface AppConfig {
  room: RoomConfig
}

// LiveKit token response types
export interface LiveKitTokenResponse {
  token: string
  room_url: string
}

// Generic API wrapper with error handling
export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    }

    // Add auth token if available
    const token = getAuthToken()
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers,
      ...options,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }

    return (await response.json()) as T
  } catch (error) {
    console.error(`API request failed to ${endpoint}:`, error)
    throw error
  }
}

// Room management API calls
export const apiService = {
  // Get all available rooms
  async getRooms(includePreview = false): Promise<Room[]> {
    const endpoint = includePreview ? "/rooms?preview=true" : "/rooms"
    return apiRequest<Room[]>(endpoint)
  },

  // Get specific room details
  async getRoom(roomId: string): Promise<Room> {
    return apiRequest<Room>(`/rooms/${roomId}`)
  },

  // Create a new room
  async createRoom(data: CreateRoomData): Promise<Room> {
    return apiRequest<Room>("/rooms", {
      method: "POST",
      body: JSON.stringify(data),
    })
  },

  // Update a room
  async updateRoom(roomId: string, data: UpdateRoomData): Promise<Room> {
    return apiRequest<Room>(`/rooms/${roomId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  },

  // Delete a room
  async deleteRoom(roomId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/rooms/${roomId}`, {
      method: "DELETE",
    })
  },

  // Join a room
  async joinRoom(roomId: string, userData: { user_id?: string; nickname?: string }): Promise<User> {
    return apiRequest<User>(`/rooms/${roomId}/join`, {
      method: "POST",
      body: JSON.stringify(userData),
    })
  },

  // Leave a room
  async leaveRoom(roomId: string, userId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/rooms/${roomId}/leave`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    })
  },

  // Get users in a room
  async getRoomUsers(roomId: string): Promise<User[]> {
    return apiRequest<User[]>(`/rooms/${roomId}/users`)
  },

  // Update room order for drag-and-drop
  async updateRoomOrder(orders: Record<string, number>): Promise<{ status: string }> {
    return apiRequest<{ status: string }>("/rooms/order", {
      method: "PUT",
      body: JSON.stringify({ orders }),
    })
  },

  // Health check
  async healthCheck(): Promise<{
    status: string
    service: string
    version: string
  }> {
    return apiRequest<{ status: string; service: string; version: string }>("/health")
  },

  // Get general application configuration
  async getConfig(): Promise<AppConfig> {
    return apiRequest<AppConfig>("/config")
  },

  // Category management
  async getCategories(): Promise<Category[]> {
    return apiRequest<Category[]>("/categories")
  },

  async createCategory(data: CreateCategoryData): Promise<Category> {
    return apiRequest<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(data),
    })
  },

  async renameCategory(categoryId: string, data: RenameCategoryData): Promise<Category> {
    return apiRequest<Category>(`/categories/${categoryId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  },

  async deleteCategory(categoryId: string, data: DeleteCategoryData): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/categories/${categoryId}`, {
      method: "DELETE",
      body: JSON.stringify(data),
    })
  },

  // Update category order for drag-and-drop
  async updateCategoryOrder(orders: Record<string, number>): Promise<{ status: string }> {
    return apiRequest<{ status: string }>("/categories/reorder", {
      method: "PUT",
      body: JSON.stringify({ orders }),
    })
  },

  // Get TURN server configuration for WebRTC
  async getTurnConfig(userId?: string): Promise<TURNConfigResponse> {
    const endpoint = userId ? `/turn-config?user_id=${userId}` : "/turn-config"
    return apiRequest<TURNConfigResponse>(endpoint)
  },

  // Auth API calls
  initiateDiscordLogin(): void {
    // Redirect to Discord OAuth endpoint
    window.location.href = `${API_BASE}/auth/discord/login`
  },

  initiateGoogleLogin(): void {
    // Redirect to Google OAuth endpoint
    window.location.href = `${API_BASE}/auth/google/login`
  },

  async guestLogin(): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>("/auth/guest", {
      method: "POST",
    })
    // Store token
    setAuthToken(response.token)
    return response
  },

  async logout(): Promise<{ status: string; message: string }> {
    const response = await apiRequest<{ status: string; message: string }>("/auth/logout", {
      method: "POST",
    })
    // Clear token
    clearAuthToken()
    return response
  },

  async getCurrentUser(): Promise<User> {
    return apiRequest<User>("/auth/me")
  },

  async getAuthStatus(): Promise<AuthStatus> {
    return apiRequest<AuthStatus>("/auth/status")
  },

  // Admin API calls
  async getUsers(): Promise<User[]> {
    return apiRequest<User[]>("/admin/users")
  },

  async getUserRole(userId: string): Promise<{ role: string }> {
    return apiRequest<{ role: string }>(`/admin/users/${userId}/role`)
  },

  async promoteUser(userId: string): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(`/admin/users/${userId}/promote`, {
      method: "POST",
    })
  },

  async demoteUser(userId: string): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(`/admin/users/${userId}/demote`, {
      method: "POST",
    })
  },

  // Get all users (public information only)
  async getAllUsers(): Promise<PublicUser[]> {
    return apiRequest<PublicUser[]>("/users")
  },

  // LiveKit token generation
  async getLiveKitToken(roomId: string): Promise<LiveKitTokenResponse> {
    return apiRequest<LiveKitTokenResponse>("/livekit/token", {
      method: "POST",
      body: JSON.stringify({ room_id: roomId }),
    })
  },
}

// Utility functions
export const generateUserId = (): string => {
  return Math.random().toString(36).substr(2, 12) + Date.now().toString(36)
}

export const generateNickname = (userId?: string): string => {
  if (userId) {
    return `User-${userId.substr(0, 6)}`
  }
  return `User-${Math.random().toString(36).substr(2, 6)}`
}
