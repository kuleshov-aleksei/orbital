package models

import (
	"time"
)

// User represents a user in the system
type User struct {
	ID         string    `json:"id"`
	Nickname   string    `json:"nickname"`
	Status     string    `json:"status"` // online, away, dnd
	IsSpeaking bool      `json:"is_speaking"`
	IsMuted    bool      `json:"is_muted"`
	IsDeafened bool      `json:"is_deafened"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeen   time.Time `json:"last_seen"`
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
}

// RoomMember represents a user in a room
type RoomMember struct {
	RoomID     string    `json:"room_id"`
	UserID     string    `json:"user_id"`
	JoinedAt   time.Time `json:"joined_at"`
	Role       string    `json:"role"` // member, admin, owner
	IsSpeaking bool      `json:"is_speaking"`
	IsMuted    bool      `json:"is_muted"`
	IsDeafened bool      `json:"is_deafened"`
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
	ID         string    `json:"id"`
	Nickname   string    `json:"nickname"`
	Status     string    `json:"status"` // online, away, dnd
	IsSpeaking bool      `json:"is_speaking"`
	IsMuted    bool      `json:"is_muted"`
	IsDeafened bool      `json:"is_deafened"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeen   time.Time `json:"last_seen"`
	JoinedAt   time.Time `json:"joined_at"` // When user joined this room
	Role       string    `json:"role"`      // member, admin, owner
}

// SDPMessage represents WebRTC SDP offer/answer
type SDPMessage struct {
	UserID string                 `json:"user_id"`
	SDP    map[string]interface{} `json:"sdp"`
	Type   string                 `json:"type"` // offer, answer
}
