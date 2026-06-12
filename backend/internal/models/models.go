package models

import (
	"time"
)

// AuthProvider represents the authentication provider type
type AuthProvider string

const (
	AuthProviderGuest    AuthProvider = "guest"
	AuthProviderDiscord  AuthProvider = "discord"
	AuthProviderGoogle   AuthProvider = "google"
	AuthProviderPassword AuthProvider = "password"
)

// Role constants for user roles
const (
	RoleGuest      = "guest"
	RoleUser       = "user"
	RoleAdmin      = "admin"
	RoleSuperAdmin = "super_admin"
)

// User represents a user in the system
type User struct {
	ID               string       `json:"id"`
	Nickname         string       `json:"nickname"`
	OriginalNickname string       `json:"original_nickname,omitempty"` // Immutable login key
	Status           string       `json:"status"`                      // online, away, dnd
	IsSpeaking       bool         `json:"is_speaking"`
	IsMuted          bool         `json:"is_muted"`
	IsDeafened       bool         `json:"is_deafened"`
	SoundPack        string       `json:"sound_pack"` // Sound pack preference
	CreatedAt        time.Time    `json:"created_at"`
	LastSeen         time.Time    `json:"last_seen"`
	AuthProvider     AuthProvider `json:"auth_provider"`
	ProviderID       string       `json:"provider_id,omitempty"`
	Email            string       `json:"email,omitempty"`
	AvatarURL        string       `json:"avatar_url,omitempty"`
	IsGuest          bool         `json:"is_guest"`
	Role             string       `json:"role"` // guest, user, admin, super_admin
	PasswordHash     string       `json:"-"`    // Never exposed to frontend
}

// PublicUser represents a user with limited public information
// Used for global user list to avoid exposing sensitive data
type PublicUser struct {
	ID        string `json:"id"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Role      string `json:"role"`
	IsOnline  bool   `json:"is_online"`
	SoundPack string `json:"sound_pack,omitempty"`
}

// Room represents a voice room
type Room struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	OwnerID   string    `json:"owner_id"`
	MaxUsers  int       `json:"max_users"`
	Type      string    `json:"type"`
	UserCount int       `json:"user_count"`
	CreatedAt time.Time `json:"created_at"`
	Category  string    `json:"category"`
	SortOrder int       `json:"sort_order"`
	World     string    `json:"world"`
}

// RoomMember represents a user in a room
type RoomMember struct {
	RoomID             string    `json:"room_id"`
	UserID             string    `json:"user_id"`
	JoinedAt           time.Time `json:"joined_at"`
	Role               string    `json:"role"` // member, admin, owner
	IsSpeaking         bool      `json:"is_speaking"`
	IsMuted            bool      `json:"is_muted"`
	IsDeafened         bool      `json:"is_deafened"`
	IsScreenSharing    bool      `json:"is_screen_sharing"`
	ScreenShareQuality string    `json:"screen_share_quality"`
	LastPingTime       time.Time `json:"-"` // Not exposed to frontend, used for timeout detection
}

// WebSocketMessage represents a WebSocket message
type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// UserAudioState represents a user's audio state (mute/deafen) for a specific room
type UserAudioState struct {
	UserID     string `json:"user_id"`
	RoomID     string `json:"room_id"`
	IsMuted    bool   `json:"is_muted"`
	IsDeafened bool   `json:"is_deafened"`
}

// UpdateAudioStateRequest represents a request to update audio state
type UpdateAudioStateRequest struct {
	RoomID     string `json:"room_id"`
	IsMuted    bool   `json:"is_muted"`
	IsDeafened bool   `json:"is_deafened"`
}

// CreateRoomRequest represents a request to create a room
type CreateRoomRequest struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	MaxUsers int    `json:"max_users"`
	Type     string `json:"type"`
	World    string `json:"world,omitempty"`
}

// UpdateRoomRequest represents a request to update a room
type UpdateRoomRequest struct {
	Name     string `json:"name,omitempty"`
	Category string `json:"category,omitempty"`
	MaxUsers int    `json:"max_users,omitempty"`
	Type     string `json:"type,omitempty"`
	World    string `json:"world,omitempty"`
}

// JoinRoomRequest represents a request to join a room
type JoinRoomRequest struct {
	RoomID   string `json:"room_id"`
	UserID   string `json:"user_id"`
	Nickname string `json:"nickname"`
}

// ICECandidate represents WebRTC ICE candidate
type ICECandidate struct {
	UserID    string                 `json:"user_id"`
	Candidate map[string]interface{} `json:"candidate"`
}

// RoomUser represents a user in a room with member-specific information
type RoomUser struct {
	ID                 string    `json:"id"`
	Nickname           string    `json:"nickname"`
	Status             string    `json:"status"` // online, away, dnd
	IsSpeaking         bool      `json:"is_speaking"`
	IsMuted            bool      `json:"is_muted"`
	IsDeafened         bool      `json:"is_deafened"`
	IsScreenSharing    bool      `json:"is_screen_sharing"`
	ScreenShareQuality string    `json:"screen_share_quality,omitempty"`
	SoundPack          string    `json:"sound_pack,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
	LastSeen           time.Time `json:"last_seen"`
	JoinedAt           time.Time `json:"joined_at"` // When user joined this room
	Role               string    `json:"role"`      // member, admin, owner
}

// SDPMessage represents WebRTC SDP offer/answer
type SDPMessage struct {
	UserID string                 `json:"user_id"`
	SDP    map[string]interface{} `json:"sdp"`
	Type   string                 `json:"type"` // offer, answer
}

// RoomPreview represents a room with limited user information for preview
type RoomPreview struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	OwnerID      string            `json:"owner_id"`
	MaxUsers     int               `json:"max_users"`
	Type         string            `json:"type"`
	UserCount    int               `json:"user_count"`
	CreatedAt    time.Time         `json:"created_at"`
	Category     string            `json:"category"`
	CategoryName string            `json:"category_name"`
	SortOrder    int               `json:"sort_order"`
	World        string            `json:"world"`
	Users        []RoomPreviewUser `json:"users"`
}

// RoomPreviewUser represents limited user information for room preview
type RoomPreviewUser struct {
	ID              string `json:"id"`
	Nickname        string `json:"nickname"`
	Role            string `json:"role"`
	IsMuted         bool   `json:"is_muted"`
	IsDeafened      bool   `json:"is_deafened"`
	IsSpeaking      bool   `json:"is_speaking"`
	IsScreenSharing bool   `json:"is_screen_sharing"`
	SoundPack       string `json:"sound_pack,omitempty"`
}

// NicknameChangeRequest represents a request to change a user's nickname
type NicknameChangeRequest struct {
	UserID   string `json:"user_id"`
	Nickname string `json:"nickname"`
}

// Category represents a room category
type Category struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	SortOrder int       `json:"sort_order"`
}

// CreateCategoryRequest represents a request to create a new category
type CreateCategoryRequest struct {
	Name string `json:"name"`
}

// RenameCategoryRequest represents a request to rename a category
type RenameCategoryRequest struct {
	Name string `json:"name"`
}

// DeleteCategoryRequest represents a request to delete a category
type DeleteCategoryRequest struct {
	DeleteRooms      bool   `json:"delete_rooms"`
	TargetCategoryID string `json:"target_category_id,omitempty"`
}

// JWTClaims represents the claims stored in a JWT token
type JWTClaims struct {
	UserID       string       `json:"user_id"`
	Nickname     string       `json:"nickname"`
	AuthProvider AuthProvider `json:"auth_provider"`
	Email        string       `json:"email,omitempty"`
	AvatarURL    string       `json:"avatar_url,omitempty"`
	IsGuest      bool         `json:"is_guest"`
	Role         string       `json:"role"`
}

// AuthResponse represents the response after successful authentication
type AuthResponse struct {
	Token     string    `json:"token"`
	User      User      `json:"user"`
	ExpiresAt time.Time `json:"expires_at"`
}

// OAuthUserInfo represents user information from OAuth providers
type OAuthUserInfo struct {
	ID        string       `json:"id"`
	Nickname  string       `json:"nickname"`
	Email     string       `json:"email,omitempty"`
	AvatarURL string       `json:"avatar_url,omitempty"`
	Provider  AuthProvider `json:"provider"`
}

// RegisterRequest represents a request to register a new user with password
type RegisterRequest struct {
	Email    string `json:"email"`
	Nickname string `json:"nickname"`
	Password string `json:"password"`
}

// LoginRequest represents a request to login with email or nickname and password
type LoginRequest struct {
	Login    string `json:"login"` // Can be email or nickname
	Password string `json:"password"`
}

// LoginResponse represents the response after successful password login
type LoginResponse struct {
	Token     string    `json:"token"`
	User      User      `json:"user"`
	ExpiresAt time.Time `json:"expires_at"`
}

// DebugLog represents a debug log entry
type DebugLog struct {
	ID          int64     `json:"id"`
	UserID      string    `json:"user_id"`
	Username    string    `json:"username"`
	Version     string    `json:"version"`
	CreatedAt   time.Time `json:"created_at"`
	LogFilename string    `json:"log_filename"`
}

// DebugLogUploadRequest represents a request to upload debug logs
type DebugLogUploadRequest struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Version  string `json:"version"`
	Logs     string `json:"logs"`
}

// UpdateSoundPackRequest represents a request to update user's sound pack preference
type UpdateSoundPackRequest struct {
	SoundPack string `json:"sound_pack"`
}

// ChatMessage represents a chat message in a room
type ChatMessage struct {
	ID       string    `json:"id"`
	SenderID string    `json:"sender_id"`
	Content  string    `json:"content"`
	SentAt   time.Time `json:"sent_at"`
}

// SendChatMessageRequest represents a request to send a chat message
type SendChatMessageRequest struct {
	Content string `json:"content"`
}

// Stats models for remote stats collection (admin feature)

// TrackStatsData contains stats for a single track
type TrackStatsData struct {
	Jitter       float64 `json:"jitter"`
	PacketLoss   float64 `json:"packet_loss"`
	Bitrate      float64 `json:"bitrate"`
	BytesReceived int64  `json:"bytes_received"`
	Timestamp    int64   `json:"timestamp"`
	Codec        string  `json:"codec,omitempty"`
	Resolution   string  `json:"resolution,omitempty"`
	FPS          float64 `json:"fps,omitempty"`
}

// ICEPairInfo describes an ICE candidate pair
type ICEPairInfo struct {
	LocalCandidateType  string `json:"local_candidate_type"`
	RemoteCandidateType string `json:"remote_candidate_type"`
	Selected            bool   `json:"selected"`
}

// ConnectionStatsData contains all connection stats for a client
type ConnectionStatsData struct {
	RTT              float64         `json:"rtt"`
	Audio            *TrackStatsData `json:"audio,omitempty"`
	Video            *TrackStatsData `json:"video,omitempty"`
	ScreenShare      *TrackStatsData `json:"screen_share,omitempty"`
	ScreenShareAudio *TrackStatsData `json:"screen_share_audio,omitempty"`
	LocalVideo       *TrackStatsData `json:"local_video,omitempty"`
	ICEPairs         []ICEPairInfo   `json:"ice_candidate_pairs,omitempty"`
}

// ClientStatsReport is sent from client to server
type ClientStatsReport struct {
	RoomID          string             `json:"room_id"`
	UserID          string             `json:"user_id"`
	Timestamp       int64              `json:"timestamp"`
	ConnectionStats ConnectionStatsData `json:"connection_stats"`
}

// StatsControlCommand is sent from server to client to enable/disable reporting
type StatsControlCommand struct {
	RoomID     string `json:"room_id"`
	Action     string `json:"action"` // "enable" or "disable"
	IntervalMs int    `json:"interval_ms,omitempty"`
}

// RoomStatsMessage is sent from server to admin with aggregated stats
type RoomStatsMessage struct {
	RoomID       string                            `json:"room_id"`
	Participants map[string]ParticipantStatsData   `json:"participants"`
}

// ParticipantStatsData holds current and recent stats for one participant
type ParticipantStatsData struct {
	LastReport ClientStatsReport   `json:"last_report"`
	History    []ClientStatsReport `json:"history"`
}

// StatsStatus represents the current state of stats collection for a room
type StatsStatus struct {
	RoomID  string `json:"room_id"`
	Enabled bool   `json:"enabled"`
}
