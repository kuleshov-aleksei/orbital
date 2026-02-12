package service

import (
	"log"
	"sync"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

// RoomService manages rooms and users
type RoomService struct {
	rooms           map[string]*models.Room
	members         map[string]map[string]*models.RoomMember // room_id -> user_id -> member (ephemeral)
	users           map[string]*models.User
	categoryService *CategoryService
	roomRepo        *repository.RoomRepository
	userRepo        *repository.UserRepository
	mu              sync.RWMutex
}

// NewRoomService creates a new RoomService
func NewRoomService(roomRepo *repository.RoomRepository, userRepo *repository.UserRepository) *RoomService {
	return &RoomService{
		rooms:    make(map[string]*models.Room),
		members:  make(map[string]map[string]*models.RoomMember),
		users:    make(map[string]*models.User),
		roomRepo: roomRepo,
		userRepo: userRepo,
	}
}

// SetCategoryService sets the category service for resolving category names
func (rs *RoomService) SetCategoryService(cs *CategoryService) {
	rs.categoryService = cs
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

// LoadFromDB loads all rooms and users from the database into memory
func (rs *RoomService) LoadFromDB() error {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	// Clear existing data
	rs.rooms = make(map[string]*models.Room)
	rs.members = make(map[string]map[string]*models.RoomMember)
	rs.users = make(map[string]*models.User)

	// Load users from database
	if rs.userRepo != nil {
		users, err := rs.userRepo.GetAll()
		if err != nil {
			return err
		}
		for _, user := range users {
			rs.users[user.ID] = user
		}
		log.Printf("Loaded %d users from database", len(users))
	}

	// Load rooms from database
	if rs.roomRepo != nil {
		rooms, err := rs.roomRepo.GetAll()
		if err != nil {
			return err
		}
		for _, room := range rooms {
			rs.rooms[room.ID] = room
			rs.members[room.ID] = make(map[string]*models.RoomMember)
		}
		log.Printf("Loaded %d rooms from database", len(rooms))
	}

	return nil
}

// CreateRoom creates a new room
func (rs *RoomService) CreateRoom(name, category string, maxUsers int) (*models.Room, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	roomID := generateID()

	// Calculate next sort order for this category
	maxSortOrder := 0
	for _, r := range rs.rooms {
		if r.Category == category && r.SortOrder > maxSortOrder {
			maxSortOrder = r.SortOrder
		}
	}

	room := &models.Room{
		ID:        roomID,
		Name:      name,
		OwnerID:   "", // Will be set when first user joins
		MaxUsers:  maxUsers,
		CreatedAt: time.Now(),
		Category:  category,
		SortOrder: maxSortOrder + 1,
	}

	// Save to database first
	if rs.roomRepo != nil {
		if err := rs.roomRepo.Create(room); err != nil {
			return nil, err
		}
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
			SortOrder: room.SortOrder,
			Users:     rs.getRoomPreviewUsers(room.ID),
		}

		// Resolve category name if category service is available
		if rs.categoryService != nil {
			if category, exists := rs.categoryService.GetCategory(room.Category); exists {
				preview.CategoryName = category.Name
			}
		}

		rooms = append(rooms, preview)
	}

	return rooms
}

// getRoomPreviewUsers returns limited user information for room preview
func (rs *RoomService) getRoomPreviewUsers(roomID string) []models.RoomPreviewUser {
	users := make([]models.RoomPreviewUser, 0)

	if members, exists := rs.members[roomID]; exists {
		for userID, member := range members {
			if user, exists := rs.users[userID]; exists {
				previewUser := models.RoomPreviewUser{
					ID:              user.ID,
					Nickname:        user.Nickname,
					Role:            member.Role,
					IsMuted:         member.IsMuted,
					IsDeafened:      member.IsDeafened,
					IsSpeaking:      member.IsSpeaking,
					IsScreenSharing: member.IsScreenSharing,
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

	// Create user if not exists, or update nickname if different
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

		// Save new user to database
		if rs.userRepo != nil {
			if err := rs.userRepo.Create(user); err != nil {
				// Log error but don't fail the join
				log.Printf("Failed to save user to database: %v", err)
			}
		}
	} else if user.Nickname != nickname {
		// Update nickname if it's different
		user.Nickname = nickname
		user.LastSeen = time.Now()

		// Update user in database
		if rs.userRepo != nil {
			if err := rs.userRepo.Update(user); err != nil {
				log.Printf("Failed to update user in database: %v", err)
			}
		}
	}

	// Check if member already exists to preserve their state
	var member *models.RoomMember
	if rs.members[roomID] != nil {
		member = rs.members[roomID][userID]
	}

	if member == nil {
		now := time.Now()
		// Create new member only if doesn't exist
		member = &models.RoomMember{
			RoomID:       roomID,
			UserID:       userID,
			JoinedAt:     now,
			Role:         "member",
			IsSpeaking:   false,
			IsMuted:      false,
			IsDeafened:   false,
			LastPingTime: now,
		}

		if rs.members[roomID] == nil {
			rs.members[roomID] = make(map[string]*models.RoomMember)
		}

		// Set owner if this is the first user
		if len(rs.members[roomID]) == 0 {
			member.Role = "owner"
			room.OwnerID = userID

			// Update room owner in database
			if rs.roomRepo != nil {
				if err := rs.roomRepo.Update(room); err != nil {
					log.Printf("Failed to update room owner in database: %v", err)
				}
			}
		}

		rs.members[roomID][userID] = member
	}

	// Update last seen timestamp
	user.LastSeen = time.Now()
	user.LastSeen = time.Now()

	log.Printf("User %s joined room %s", userID, roomID)
	return user, &models.RoomPreviewUser{
		ID:              user.ID,
		Nickname:        user.Nickname,
		Role:            member.Role,
		IsMuted:         member.IsMuted,
		IsDeafened:      member.IsDeafened,
		IsSpeaking:      member.IsSpeaking,
		IsScreenSharing: member.IsScreenSharing,
	}, nil
}

// LeaveRoom removes a user from a room
func (rs *RoomService) LeaveRoom(roomID, userID string) *models.RoomPreviewUser {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	var leftUser *models.RoomPreviewUser

	var member *models.RoomMember
	if rs.members[roomID] != nil {
		if m, exists := rs.members[roomID][userID]; exists {
			member = m
		}
	}

	if user, exists := rs.users[userID]; exists {
		user.LastSeen = time.Now()
		leftUser = &models.RoomPreviewUser{
			ID:              user.ID,
			Nickname:        user.Nickname,
			Role:            "member",
			IsMuted:         false,
			IsDeafened:      false,
			IsSpeaking:      false,
			IsScreenSharing: false,
		}
		if member != nil {
			leftUser.Role = member.Role
			leftUser.IsMuted = member.IsMuted
			leftUser.IsDeafened = member.IsDeafened
			leftUser.IsSpeaking = member.IsSpeaking
			leftUser.IsScreenSharing = member.IsScreenSharing
		}
	}

	if rs.members[roomID] != nil {
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
					roomUser.IsScreenSharing = member.IsScreenSharing
					roomUser.ScreenShareQuality = member.ScreenShareQuality
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

// UpdateUserDeafenStatus updates user's deafen status
func (rs *RoomService) UpdateUserDeafenStatus(roomID, userID string, isDeafened bool) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if rs.members[roomID] != nil {
		if member, exists := rs.members[roomID][userID]; exists {
			member.IsDeafened = isDeafened
		}
	}

	if user, exists := rs.users[userID]; exists {
		user.IsDeafened = isDeafened
		user.LastSeen = time.Now()
	}
}

// UpdateUserScreenShareStatus updates user's screen sharing status
func (rs *RoomService) UpdateUserScreenShareStatus(roomID, userID string, isSharing bool, quality string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if rs.members[roomID] != nil {
		if member, exists := rs.members[roomID][userID]; exists {
			member.IsScreenSharing = isSharing
			member.ScreenShareQuality = quality
		}
	}

	if user, exists := rs.users[userID]; exists {
		user.LastSeen = time.Now()
	}
}

// UpdateUserNickname updates user's nickname
func (rs *RoomService) UpdateUserNickname(roomID, userID, nickname string) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if user, exists := rs.users[userID]; exists {
		user.Nickname = nickname
		user.LastSeen = time.Now()

		// Update in database
		if rs.userRepo != nil {
			if err := rs.userRepo.Update(user); err != nil {
				return err
			}
		}

		return nil
	}

	return &RoomError{Message: "User not found"}
}

// UpdateUserPingTime updates user's last ping time in a room
func (rs *RoomService) UpdateUserPingTime(roomID, userID string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if rs.members[roomID] != nil {
		if member, exists := rs.members[roomID][userID]; exists {
			member.LastPingTime = time.Now()
		}
	}

	if user, exists := rs.users[userID]; exists {
		user.LastSeen = time.Now()
	}
}

// GetUserByID returns a user by their ID from the in-memory store
func (rs *RoomService) GetUserByID(userID string) (*models.User, bool) {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	user, exists := rs.users[userID]
	return user, exists
}

// CheckPingTimeouts checks for users who haven't pinged within timeout and returns them
func (rs *RoomService) CheckPingTimeouts(timeout time.Duration) []struct {
	RoomID string
	UserID string
} {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	now := time.Now()
	timedOutUsers := make([]struct {
		RoomID string
		UserID string
	}, 0)

	for roomID, members := range rs.members {
		for userID, member := range members {
			if now.Sub(member.LastPingTime) > timeout {
				timedOutUsers = append(timedOutUsers, struct {
					RoomID string
					UserID string
				}{RoomID: roomID, UserID: userID})
			}
		}
	}

	return timedOutUsers
}

// UpdateRoomCategory updates a room's category
func (rs *RoomService) UpdateRoomCategory(roomID string, categoryID string) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	room, exists := rs.rooms[roomID]
	if !exists {
		return &RoomError{Message: "Room not found"}
	}

	room.Category = categoryID
	return nil
}

// UpdateRoom updates a room's name, max users, and optionally category
func (rs *RoomService) UpdateRoom(roomID string, name string, maxUsers int, categoryID string) (*models.Room, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	room, exists := rs.rooms[roomID]
	if !exists {
		return nil, &RoomError{Message: "Room not found"}
	}

	// Validate max users only if it's being updated (maxUsers > 0)
	if maxUsers > 0 && (maxUsers < 2 || maxUsers > 10) {
		return nil, &RoomError{Message: "Max users must be between 2 and 10"}
	}

	// Update fields
	if name != "" {
		room.Name = name
	}
	// Only update maxUsers if it's being changed (> 0)
	if maxUsers > 0 {
		room.MaxUsers = maxUsers
	}
	if categoryID != "" {
		room.Category = categoryID
	}

	// Update in database
	if rs.roomRepo != nil {
		if err := rs.roomRepo.Update(room); err != nil {
			return nil, err
		}
	}

	return room, nil
}

// GetRoomsByCategory returns all rooms in a specific category
func (rs *RoomService) GetRoomsByCategory(categoryID string) []*models.Room {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	var rooms []*models.Room
	for _, room := range rs.rooms {
		if room.Category == categoryID {
			rooms = append(rooms, room)
		}
	}

	return rooms
}

// UpdateRoomSortOrder updates the sort order of rooms
func (rs *RoomService) UpdateRoomSortOrder(roomOrders map[string]int) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	// Update in-memory rooms
	for roomID, sortOrder := range roomOrders {
		if room, exists := rs.rooms[roomID]; exists {
			room.SortOrder = sortOrder
		}
	}

	// Update in database
	if rs.roomRepo != nil {
		if err := rs.roomRepo.UpdateSortOrders(roomOrders); err != nil {
			return err
		}
	}

	return nil
}

// DeleteRoom removes a room completely
func (rs *RoomService) DeleteRoom(roomID string) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if _, exists := rs.rooms[roomID]; !exists {
		return &RoomError{Message: "Room not found"}
	}

	// Remove all members first
	if members, exists := rs.members[roomID]; exists {
		for userID := range members {
			if user, exists := rs.users[userID]; exists {
				user.LastSeen = time.Now()

				// Update last_seen in database
				if rs.userRepo != nil {
					if err := rs.userRepo.UpdateLastSeen(userID, user.LastSeen); err != nil {
						log.Printf("Failed to update user last_seen in database: %v", err)
					}
				}
			}
		}
	}

	// Delete from database
	if rs.roomRepo != nil {
		if err := rs.roomRepo.Delete(roomID); err != nil {
			return err
		}
	}

	// Delete room and its members from memory
	delete(rs.rooms, roomID)
	delete(rs.members, roomID)

	log.Printf("Deleted room: %s", roomID)
	return nil
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
