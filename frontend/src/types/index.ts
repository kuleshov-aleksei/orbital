// Room interface
export interface Room {
  id: string
  name: string
  userCount: number
  maxUsers: number
  category: string
}

// User interface
export interface User {
  id: string
  nickname: string
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
  status: 'online' | 'away' | 'dnd'
}

// WebSocket message types
export interface WebSocketMessage {
  type: 'join_room' | 'leave_room' | 'ice_candidate' | 'sdp_offer' | 'sdp_answer' | 'speaking_status' | 'screen_share_start' | 'screen_share_stop'
  data: any
}

// API response types
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// Room creation data
export interface CreateRoomData {
  name: string
  category: string
  maxUsers: number
}

// Join room data
export interface JoinRoomRequest {
  user_id?: string
  nickname?: string
}

// Health check response
export interface HealthResponse {
  status: string
  service: string
  version: string
}