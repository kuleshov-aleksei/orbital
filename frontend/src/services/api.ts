import { Room, User, CreateRoomData } from '@/types'

const API_BASE = 'http://localhost:8080/api'

// Generic API wrapper with error handling
async function apiRequest<T>(
  endpoint: string, 
  options: RequestInit = {}
): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }

    return await response.json()
  } catch (error) {
    console.error(`API request failed to ${endpoint}:`, error)
    throw error
  }
}

// Room management API calls
export const apiService = {
  // Get all available rooms
  async getRooms(): Promise<Room[]> {
    return apiRequest<Room[]>('/rooms')
  },

  // Get specific room details
  async getRoom(roomId: string): Promise<Room> {
    return apiRequest<Room>(`/rooms/${roomId}`)
  },

  // Create a new room
  async createRoom(data: CreateRoomData): Promise<Room> {
    return apiRequest<Room>('/rooms', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // Join a room
  async joinRoom(roomId: string, userData: { user_id?: string; nickname?: string }): Promise<User> {
    return apiRequest<User>(`/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify(userData),
    })
  },

  // Leave a room
  async leaveRoom(roomId: string, userId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/rooms/${roomId}/leave`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    })
  },

  // Get users in a room
  async getRoomUsers(roomId: string): Promise<User[]> {
    return apiRequest<User[]>(`/rooms/${roomId}/users`)
  },

  // Health check
  async healthCheck(): Promise<{ status: string; service: string; version: string }> {
    return apiRequest<{ status: string; service: string; version: string }>('/health')
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