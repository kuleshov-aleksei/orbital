package service

import (
	"log"
	"sync"
	"time"

	"github.com/orbital/internal/models"
)

// RoomService manages rooms and users
type RoomService struct {
	rooms   map[string]*models.Room
	members map[string]map[string]*models.RoomMember // room_id -> user_id -> member
	users   map[string]*models.User
	mu      sync.RWMutex
}

// NewRoomService creates a new RoomService
func NewRoomService() *RoomService {
	return &RoomService{
		rooms:   make(map[string]*models.Room),
		members: make(map[string]map[string]*models.RoomMember),
		users:   make(map[string]*models.User),
	}
}

// Reset clears all rooms/users.
// Intended for test environments only.
func (rs *RoomService) Reset() {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	rs.rooms = make(map[string]*models.Room)
	rs.members = make(map[string]map[string]*models.RoomMember)
	rs.users = make(map[string]*models.User)
}

// CreateRoom creates a new room
func (rs *RoomService) CreateRoom(name, category string, maxUsers int) (*models.Room, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	roomID := generateID()
	room := &models.Room{
		ID:        roomID,
		Name:      name,
		OwnerID:   "", // Will be set when first user joins
		MaxUsers:  maxUsers,
		CreatedAt: time.Now(),
		Category:  category,
	}

	rs.rooms[roomID] = room
	rs.members[roomID] = make(map[string]*models.RoomMember)

	log.Printf("Created room: %s (%s)", roomID, name)
	return room, nil
}

// GetRooms returns all available rooms
func (rs *RoomService) GetRooms() []models.Room {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	rooms := make([]models.Room, 0, len(rs.rooms))
	for _, room := range rs.rooms {
		roomCopy := *room // Create copy
		roomCopy.UserCount = rs.getRoomUserCount(room.ID)
		rooms = append(rooms, roomCopy)
	}

	return rooms
}

// GetRoomsWithPreview returns all rooms with preview user information
func (rs *RoomService) GetRoomsWithPreview() []models.RoomPreview {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	rooms := make([]models.RoomPreview, 0, len(rs.rooms))
	for _, room := range rs.rooms {
		preview := models.RoomPreview{
			ID:        room.ID,
			Name:      room.Name,
			OwnerID:   room.OwnerID,
			MaxUsers:  room.MaxUsers,
			UserCount: rs.getRoomUserCount(room.ID),
			CreatedAt: room.CreatedAt,
			Category:  room.Category,
			Users:     rs.getRoomPreviewUsers(room.ID),
		}
		rooms = append(rooms, preview)
	}

	return rooms
}

// getRoomPreviewUsers returns limited user information for room preview
func (rs *RoomService) getRoomPreviewUsers(roomID string) []models.RoomPreviewUser {
	var users []models.RoomPreviewUser

	if members, exists := rs.members[roomID]; exists {
		for userID, member := range members {
			if user, exists := rs.users[userID]; exists {
				previewUser := models.RoomPreviewUser{
					ID:       user.ID,
					Nickname: user.Nickname,
					Role:     member.Role,
				}
				users = append(users, previewUser)
			}
		}
	}

	return users
}

// GetRoom returns a specific room
func (rs *RoomService) GetRoom(roomID string) (*models.Room, bool) {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	room, exists := rs.rooms[roomID]
	if !exists {
		return nil, false
	}

	// Copy room and add user count
	roomCopy := *room
	roomCopy.UserCount = rs.getRoomUserCount(roomID)
	return &roomCopy, true
}

// JoinRoom adds a user to a room
func (rs *RoomService) JoinRoom(roomID, userID, nickname string) (*models.User, *models.RoomPreviewUser, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	// Check if room exists
	room, exists := rs.rooms[roomID]
	if !exists {
		return nil, nil, &RoomError{Message: "Room not found"}
	}

	// Check if room is full
	if rs.getRoomUserCount(roomID) >= room.MaxUsers {
		return nil, nil, &RoomError{Message: "Room is full"}
	}

	// Create user if not exists
	user, userExists := rs.users[userID]
	if !userExists {
		user = &models.User{
			ID:        userID,
			Nickname:  nickname,
			Status:    "online",
			CreatedAt: time.Now(),
			LastSeen:  time.Now(),
		}
		rs.users[userID] = user
	}

	// Add user to room
	member := &models.RoomMember{
		RoomID:     roomID,
		UserID:     userID,
		JoinedAt:   time.Now(),
		Role:       "member",
		IsSpeaking: false,
		IsMuted:    false,
	}

	if rs.members[roomID] == nil {
		rs.members[roomID] = make(map[string]*models.RoomMember)
	}

	// Set owner if this is the first user
	if len(rs.members[roomID]) == 0 {
		member.Role = "owner"
		room.OwnerID = userID
	}

	rs.members[roomID][userID] = member
	user.LastSeen = time.Now()

	log.Printf("User %s joined room %s", userID, roomID)
	return user, &models.RoomPreviewUser{
		ID:       user.ID,
		Nickname: user.Nickname,
		Role:     member.Role,
	}, nil
}

// LeaveRoom removes a user from a room
func (rs *RoomService) LeaveRoom(roomID, userID string) *models.RoomPreviewUser {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	var leftUser *models.RoomPreviewUser

	if user, exists := rs.users[userID]; exists {
		user.LastSeen = time.Now()
		leftUser = &models.RoomPreviewUser{
			ID:       user.ID,
			Nickname: user.Nickname,
			Role:     "member",
		}
	}

	if rs.members[roomID] != nil {
		if member, exists := rs.members[roomID][userID]; exists {
			leftUser.Role = member.Role
		}
		delete(rs.members[roomID], userID)
	}

	log.Printf("User %s left room %s", userID, roomID)
	return leftUser
}

// GetRoomUsers returns all users in a room with member-specific information
func (rs *RoomService) GetRoomUsers(roomID string) []models.RoomUser {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	var users []models.RoomUser

	if members, exists := rs.members[roomID]; exists {
		for userID := range members {
			if user, exists := rs.users[userID]; exists {
				roomUser := models.RoomUser{
					ID:        user.ID,
					Nickname:  user.Nickname,
					Status:    user.Status,
					CreatedAt: user.CreatedAt,
					LastSeen:  user.LastSeen,
				}

				// Add member-specific info
				if member := members[userID]; member != nil {
					roomUser.IsSpeaking = member.IsSpeaking
					roomUser.IsMuted = member.IsMuted
					roomUser.IsDeafened = member.IsDeafened
					roomUser.JoinedAt = member.JoinedAt
					roomUser.Role = member.Role
				}

				users = append(users, roomUser)
			}
		}
	}

	return users
}

// UpdateUserSpeakingStatus updates user's speaking status in a room
func (rs *RoomService) UpdateUserSpeakingStatus(roomID, userID string, isSpeaking bool) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if rs.members[roomID] != nil {
		if member, exists := rs.members[roomID][userID]; exists {
			member.IsSpeaking = isSpeaking
		}
	}

	if user, exists := rs.users[userID]; exists {
		user.IsSpeaking = isSpeaking
		user.LastSeen = time.Now()
	}
}

// UpdateUserMuteStatus updates user's mute status
func (rs *RoomService) UpdateUserMuteStatus(roomID, userID string, isMuted bool) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if rs.members[roomID] != nil {
		if member, exists := rs.members[roomID][userID]; exists {
			member.IsMuted = isMuted
		}
	}

	if user, exists := rs.users[userID]; exists {
		user.IsMuted = isMuted
		user.LastSeen = time.Now()
	}
}

// Helper methods
func (rs *RoomService) getRoomUserCount(roomID string) int {
	if members, exists := rs.members[roomID]; exists {
		return len(members)
	}
	return 0
}

// Add UserCount field to Room struct for responses
type RoomWithUserCount struct {
	models.Room
	UserCount int `json:"user_count"`
}

// Custom error type
type RoomError struct {
	Message string
}

func (e *RoomError) Error() string {
	return e.Message
}

// Simple ID generator
func generateID() string {
	return time.Now().Format("20060102150405") + randomString(6)
}

func randomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
	}
	return string(b)
}
