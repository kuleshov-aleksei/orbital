package service

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/livekit/protocol/auth"
	livekit "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

// LiveKitService wraps LiveKit server SDK operations
type LiveKitService struct {
	config     *config.LiveKitConfig
	roomClient *lksdk.RoomServiceClient
}

// LiveKitTokenData holds data needed to generate an access token
type LiveKitTokenData struct {
	UserID   string
	Nickname string
	Avatar   string
	Role     string
	RoomID   string
}

// NewLiveKitService creates a new LiveKit service
func NewLiveKitService(cfg *config.LiveKitConfig) (*LiveKitService, error) {
	if !cfg.IsConfigured() {
		return nil, fmt.Errorf("livekit is not configured")
	}

	// Create room service client
	roomClient := lksdk.NewRoomServiceClient(cfg.URL, cfg.APIKey, cfg.APISecret)

	service := &LiveKitService{
		config:     cfg,
		roomClient: roomClient,
	}

	log.Printf("[LiveKit] Service initialized with URL: %s", cfg.URL)
	return service, nil
}

// GenerateAccessToken creates a LiveKit access token for a user to join a room
func (s *LiveKitService) GenerateAccessToken(data LiveKitTokenData) (string, error) {
	if s.config == nil {
		return "", fmt.Errorf("livekit service not initialized")
	}

	// Create access token
	at := auth.NewAccessToken(s.config.APIKey, s.config.APISecret)

	// Set video grant with room join permission
	canUpdateMetadata := true
	grant := &auth.VideoGrant{
		RoomJoin:             true,
		Room:                 data.RoomID,
		CanUpdateOwnMetadata: &canUpdateMetadata,
	}

	// Set user metadata
	metadata := fmt.Sprintf(`{"nickname":"%s","avatar":"%s","role":"%s"}`,
		data.Nickname, data.Avatar, data.Role)

	// Build token
	token, err := at.SetVideoGrant(grant).
		SetIdentity(data.UserID).
		SetName(data.Nickname).
		SetMetadata(metadata).
		SetValidFor(24 * time.Hour).
		ToJWT()

	if err != nil {
		return "", fmt.Errorf("failed to generate access token: %w", err)
	}

	return token, nil
}

// CreateRoom creates a LiveKit room with the specified configuration
func (s *LiveKitService) CreateRoom(roomID string, maxParticipants int) (*livekit.Room, error) {
	if s.roomClient == nil {
		return nil, fmt.Errorf("livekit room client not initialized")
	}

	// Use config max users if not specified
	if maxParticipants <= 0 {
		maxParticipants = 10
	}

	req := &livekit.CreateRoomRequest{
		Name:            roomID,
		MaxParticipants: uint32(maxParticipants),
		EmptyTimeout:    300, // 5 minutes in seconds
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	room, err := s.roomClient.CreateRoom(ctx, req)
	if err != nil {
		// Room might already exist, which is fine (idempotent)
		log.Printf("[LiveKit] CreateRoom error (may already exist): %v", err)
		return nil, fmt.Errorf("failed to create room: %w", err)
	}

	log.Printf("[LiveKit] Room created: %s (max participants: %d)", room.Name, maxParticipants)
	return room, nil
}

// DeleteRoom deletes a LiveKit room
func (s *LiveKitService) DeleteRoom(roomID string) error {
	if s.roomClient == nil {
		return fmt.Errorf("livekit room client not initialized")
	}

	req := &livekit.DeleteRoomRequest{
		Room: roomID,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := s.roomClient.DeleteRoom(ctx, req)
	if err != nil {
		log.Printf("[LiveKit] DeleteRoom error: %v", err)
		return fmt.Errorf("failed to delete room: %w", err)
	}

	log.Printf("[LiveKit] Room deleted: %s", roomID)
	return nil
}

// ListRooms returns a list of active LiveKit rooms
func (s *LiveKitService) ListRooms() ([]*livekit.Room, error) {
	if s.roomClient == nil {
		return nil, fmt.Errorf("livekit room client not initialized")
	}

	req := &livekit.ListRoomsRequest{}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	res, err := s.roomClient.ListRooms(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to list rooms: %w", err)
	}

	return res.Rooms, nil
}

// ListParticipants returns a list of participants in a room
func (s *LiveKitService) ListParticipants(roomID string) ([]*livekit.ParticipantInfo, error) {
	if s.roomClient == nil {
		return nil, fmt.Errorf("livekit room client not initialized")
	}

	req := &livekit.ListParticipantsRequest{
		Room: roomID,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	res, err := s.roomClient.ListParticipants(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to list participants: %w", err)
	}

	return res.Participants, nil
}

// RemoveParticipant removes a participant from a room
func (s *LiveKitService) RemoveParticipant(roomID, participantID string) error {
	if s.roomClient == nil {
		return fmt.Errorf("livekit room client not initialized")
	}

	req := &livekit.RoomParticipantIdentity{
		Room:     roomID,
		Identity: participantID,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := s.roomClient.RemoveParticipant(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to remove participant: %w", err)
	}

	log.Printf("[LiveKit] Participant %s removed from room %s", participantID, roomID)
	return nil
}

// GenerateTokenFromUser generates a LiveKit token from a user model
func (s *LiveKitService) GenerateTokenFromUser(user *models.User, roomID string) (string, error) {
	data := LiveKitTokenData{
		UserID:   user.ID,
		Nickname: user.Nickname,
		Avatar:   user.AvatarURL,
		Role:     user.Role,
		RoomID:   roomID,
	}
	return s.GenerateAccessToken(data)
}

// IsHealthy checks if the LiveKit service is properly configured
func (s *LiveKitService) IsHealthy() bool {
	return s.config != nil && s.config.IsConfigured() && s.roomClient != nil
}

// GetConfig returns the LiveKit configuration
func (s *LiveKitService) GetConfig() *config.LiveKitConfig {
	return s.config
}

// GenerateTokenFromJWTClaims generates a LiveKit token from JWT claims
func (s *LiveKitService) GenerateTokenFromJWTClaims(claims *models.JWTClaims, roomID string) (string, error) {
	data := LiveKitTokenData{
		UserID:   claims.UserID,
		Nickname: claims.Nickname,
		Avatar:   claims.AvatarURL,
		Role:     claims.Role,
		RoomID:   roomID,
	}
	return s.GenerateAccessToken(data)
}
