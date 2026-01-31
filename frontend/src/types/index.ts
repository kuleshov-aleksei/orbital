// Room interface
export interface Room {
  id: string
  name: string
  userCount: number
  maxUsers: number
  category: string  // Category ID
  categoryName?: string  // Category name for display
  users?: RoomPreviewUser[]
}

// Room preview user interface
export interface RoomPreviewUser {
  id: string
  nickname: string
  role: string
  isMuted: boolean
  isDeafened: boolean
  isSpeaking: boolean
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

// RoomUser interface - user with room-specific information
export interface RoomUser extends User {
  createdAt: string
  lastSeen: string
  joinedAt: string
  role: 'member' | 'admin' | 'owner'
}

// WebSocket message types
export type WebSocketMessageType =
  | 'join_room'
  | 'leave_room'
  | 'ice_candidate'
  | 'sdp_offer'
  | 'sdp_answer'
  | 'speaking_status'
  | 'mute_status'
  | 'deafen_status'
  | 'screen_share_start'
  | 'screen_share_stop'
  | 'nickname_change'
  | 'category_created'
  | 'category_renamed'
  | 'category_deleted'
  | 'room_updated'
  | 'room_deleted'

export interface WebSocketMessage {
  type: WebSocketMessageType
  data: unknown
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

// Nickname change data
export interface NicknameChangeRequest {
  user_id: string
  nickname: string
}

// Category interface
export interface Category {
  id: string
  name: string
  createdAt: string
}

// Create category data
export interface CreateCategoryData {
  name: string
}

// Rename category data
export interface RenameCategoryData {
  name: string
}

// Delete category data
export interface DeleteCategoryData {
  deleteRooms: boolean
  targetCategoryId?: string
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

// Enhanced WebRTC Statistics types
export interface ConnectionStats {
  packetsLost: number
  jitter: number
  roundTripTime: number
  bandwidth: BandwidthStats
  audioLevel: number
  connectionState: string
  timestamp: Date
}

export interface StatsHistory {
  peerId: string
  stats: ConnectionStats[]
  maxHistorySize: number
}

export interface ConnectionQuality {
  quality: 'excellent' | 'good' | 'fair' | 'poor'
  score: number
  issues: string[]
}

// Debugging and monitoring types
export interface DebugInfo {
  peerId: string
  iceState: string
  connectionState: string
  signalingState: string
  iceGatheringState: string
  localCandidates: RTCIceCandidateInit[]
  remoteCandidates: RTCIceCandidateInit[]
  localDescription: RTCSessionDescriptionInit | null
  remoteDescription: RTCSessionDescriptionInit | null
}

export interface AudioLevelData {
  userId: string
  level: number // 0-127
  isSpeaking: boolean
  timestamp: Date
}

export interface NetworkPathInfo {
  localCandidate?: RTCIceCandidate
  remoteCandidate?: RTCIceCandidate
  connectionType: string
  transport: string
  localAddress?: string
  remoteAddress?: string
}

// Debug Dashboard Types
export interface ConnectionLog {
  id: string | number
  timestamp: Date
  level: 'info' | 'warning' | 'error'
  message: string
  userId?: string
}

export interface DebugSession {
  sessionId: string
  startTime: Date
  duration: number
  peerConnections: number
  totalConnections: number
  averageQuality: number
}

export interface ConnectionDiagnostic {
  userId: string
  timestamp: Date
  iceConnectionState: RTCIceConnectionState
  peerConnectionState: RTCPeerConnectionState
  signalingState: RTCSignalingState
  localCandidates: RTCIceCandidateInit[]
  remoteCandidates: RTCIceCandidateInit[]
  dataChannels: RTCDataChannel[]
  selectedCandidatePair?: RTCIceCandidatePair
  certificate?: RTCCertificate
}