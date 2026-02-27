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
	ID            string       `json:"id"`
	Nickname      string       `json:"nickname"`
	OAuthNickname string       `json:"oauth_nickname,omitempty"` // Original OAuth nickname
	Status        string       `json:"status"`                   // online, away, dnd
	IsSpeaking    bool         `json:"is_speaking"`
	IsMuted       bool         `json:"is_muted"`
	IsDeafened    bool         `json:"is_deafened"`
	CreatedAt     time.Time    `json:"created_at"`
	LastSeen      time.Time    `json:"last_seen"`
	AuthProvider  AuthProvider `json:"auth_provider"`
	ProviderID    string       `json:"provider_id,omitempty"`
	Email         string       `json:"email,omitempty"`
	AvatarURL     string       `json:"avatar_url,omitempty"`
	IsGuest       bool         `json:"is_guest"`
	Role          string       `json:"role"` // guest, user, admin, super_admin
	PasswordHash  string       `json:"-"`    // Never exposed to frontend
}

// PublicUser represents a user with limited public information
// Used for global user list to avoid exposing sensitive data
type PublicUser struct {
	ID        string `json:"id"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Role      string `json:"role"`
	IsOnline  bool   `json:"is_online"`
}

// Room represents a voice room
type Room struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	OwnerID   string    `json:"owner_id"`
	MaxUsers  int       `json:"max_users"`
	UserCount int       `json:"user_count"`
	CreatedAt time.Time `json:"created_at"`
	Category  string    `json:"category"`
	SortOrder int       `json:"sort_order"`
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

// CreateRoomRequest represents a request to create a room
type CreateRoomRequest struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	MaxUsers int    `json:"max_users"`
}

// UpdateRoomRequest represents a request to update a room
type UpdateRoomRequest struct {
	Name     string `json:"name,omitempty"`
	Category string `json:"category,omitempty"`
	MaxUsers int    `json:"max_users,omitempty"`
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
	UserCount    int               `json:"user_count"`
	CreatedAt    time.Time         `json:"created_at"`
	Category     string            `json:"category"`
	CategoryName string            `json:"category_name"`
	SortOrder    int               `json:"sort_order"`
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
