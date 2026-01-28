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

// WebRTC related types
export interface IceCandidateData {
  user_id: string
  candidate: RTCIceCandidateInit
}

export interface SDPData {
  user_id: string
  sdp: RTCSessionDescriptionInit
}

export interface PeerConnectionInfo {
  userId: string
  connection: RTCPeerConnection
  audioElement?: HTMLAudioElement
  isConnected: boolean
}

export interface AudioStreamState {
  userId: string
  stream: MediaStream | null
  volume: number
  isMuted: boolean
  audioLevel: number
  connectionState: string
}

export interface WebRTCStats {
  packetsLost: number
  jitter: number
  roundTripTime: number
  bandwidth: {
    upload: number
    download: number
  }
  audioLevel: number
  connectionState: string
  timestamp: Date
}

export interface BandwidthStats {
  upload: number
  download: number
}