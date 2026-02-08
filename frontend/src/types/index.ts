// Room interface
export interface Room {
  id: string
  name: string
  user_count: number
  max_users: number
  category: string  // Category ID
  category_name?: string  // Category name for display
  sort_order: number  // Order within category for drag-and-drop
  users?: RoomPreviewUser[]
}

// Room preview user interface
export interface RoomPreviewUser {
  id: string
  nickname: string
  role: string
  is_muted: boolean
  is_deafened: boolean
  is_speaking: boolean
  is_screen_sharing?: boolean
}

// PublicUser interface - limited user data for global user list
export interface PublicUser {
  id: string
  nickname: string
  avatar_url?: string
  role: 'guest' | 'user' | 'admin' | 'super_admin'
  is_online: boolean
}

// Screen sharing quality options
export type ScreenShareQuality =
  | 'source'
  | '1080p60'
  | '1080p30'
  | '720p30'
  | '360p30'
  | 'text'

// User interface - uses snake_case to match Go backend JSON
export interface User {
  id: string
  nickname: string
  oauth_nickname?: string
  is_speaking?: boolean
  is_muted?: boolean
  is_deafened?: boolean
  is_screen_sharing?: boolean
  screen_share_quality?: ScreenShareQuality
  status: 'online' | 'away' | 'dnd'
  auth_provider: 'guest' | 'discord' | 'google'
  is_guest: boolean
  email?: string
  avatar_url?: string
  created_at?: string
  last_seen?: string
  role: 'guest' | 'user' | 'admin' | 'super_admin'
}

// RoomUser interface - user with room-specific information
export interface RoomUser extends User {
  created_at?: string
  last_seen?: string
  joined_at?: string
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
  | 'ping'
  | 'pong'

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
  max_users: number
}

// Room update data
export interface UpdateRoomData {
  name?: string
  category?: string
  max_users?: number
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
  created_at: string
  sort_order: number
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
  delete_rooms: boolean
  target_category_id?: string
}

// Health check response
export interface HealthResponse {
  status: string
  service: string
  version: string
}

// Screen sharing data for WebSocket messages
export interface ScreenShareData {
  user_id: string
  quality: ScreenShareQuality
  has_audio: boolean
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
  user_id: string
  level: number // 0-127
  is_speaking: boolean
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

export interface ICEConnectionType {
  type: 'host' | 'srflx' | 'relay' | 'unknown'
  usingTURN: boolean
  relayProtocol?: 'udp' | 'tcp' | 'tls'
  localType: string
  remoteType: string
}