package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/livekit/protocol/auth"
	livekit "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

// LiveKitTokenTTL keeps join tokens short-lived. LiveKit refreshes tokens for
// connected participants, so this does not limit long calls.
const LiveKitTokenTTL = 10 * time.Minute

// participantMetadata is public to every room participant. Authorization data
// (roles) is deliberately not included: the client could rewrite it.
type participantMetadata struct {
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

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
	RoomID   string
	// Permissions are the user's effective permissions in RoomID; they decide
	// which track sources the token may publish.
	Permissions permissions.Permission
}

// PublishSourcesFor maps room permissions to LiveKit track sources.
func PublishSourcesFor(p permissions.Permission) []livekit.TrackSource {
	var sources []livekit.TrackSource
	if p.Has(permissions.Speak) {
		sources = append(sources, livekit.TrackSource_MICROPHONE)
	}
	if p.Has(permissions.Video) {
		sources = append(sources, livekit.TrackSource_CAMERA)
	}
	if p.Has(permissions.Screenshare) {
		sources = append(sources, livekit.TrackSource_SCREEN_SHARE, livekit.TrackSource_SCREEN_SHARE_AUDIO)
	}
	// The boombox publishes its music track with source UNKNOWN (the frontend
	// uses no other UNKNOWN-source tracks), so this is what gates it server-side.
	if p.Has(permissions.UseSoundboard) {
		sources = append(sources, livekit.TrackSource_UNKNOWN)
	}
	return sources
}

// buildVideoGrant creates the LiveKit grant for a user's room permissions.
func buildVideoGrant(roomID string, p permissions.Permission) *auth.VideoGrant {
	// Needed for setAttributes (boombox state, presence).
	canUpdateMetadata := true
	grant := &auth.VideoGrant{
		RoomJoin:             true,
		Room:                 roomID,
		CanUpdateOwnMetadata: &canUpdateMetadata,
	}
	sources := PublishSourcesFor(p)
	grant.SetCanPublish(len(sources) > 0)
	grant.SetCanSubscribe(true)
	// Data channel carries spatial positions and boombox sync for everyone.
	grant.SetCanPublishData(true)
	if len(sources) > 0 {
		grant.SetCanPublishSources(sources)
	}
	return grant
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

	grant := buildVideoGrant(data.RoomID, data.Permissions)

	// Set user metadata. Marshal it so nicknames/avatars cannot inject JSON.
	metadataBytes, err := json.Marshal(participantMetadata{
		Nickname: data.Nickname,
		Avatar:   data.Avatar,
	})
	if err != nil {
		return "", fmt.Errorf("failed to marshal participant metadata: %w", err)
	}

	// Build token
	token, err := at.SetVideoGrant(grant).
		SetIdentity(data.UserID).
		SetName(data.Nickname).
		SetMetadata(string(metadataBytes)).
		SetValidFor(LiveKitTokenTTL).
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

// IsHealthy checks if the LiveKit service is properly configured
func (s *LiveKitService) IsHealthy() bool {
	return s.config != nil && s.config.IsConfigured() && s.roomClient != nil
}

// GetConfig returns the LiveKit configuration
func (s *LiveKitService) GetConfig() *config.LiveKitConfig {
	return s.config
}

// GenerateTokenFromJWTClaims generates a LiveKit token from JWT claims
func (s *LiveKitService) GenerateTokenFromJWTClaims(claims *models.JWTClaims, roomID string, perms permissions.Permission) (string, error) {
	data := LiveKitTokenData{
		UserID:      claims.UserID,
		Nickname:    claims.Nickname,
		Avatar:      claims.AvatarURL,
		RoomID:      roomID,
		Permissions: perms,
	}
	return s.GenerateAccessToken(data)
}

// UpdateParticipantPermissions applies new room permissions to a connected
// participant and mutes any published track whose source is no longer allowed
// (LiveKit only guarantees unpublishing when CanPublish is fully revoked).
func (s *LiveKitService) UpdateParticipantPermissions(roomID, identity string, p permissions.Permission) error {
	if s.roomClient == nil {
		return fmt.Errorf("livekit room client not initialized")
	}
	sources := PublishSourcesFor(p)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	info, err := s.roomClient.UpdateParticipant(ctx, &livekit.UpdateParticipantRequest{
		Room:     roomID,
		Identity: identity,
		Permission: &livekit.ParticipantPermission{
			CanSubscribe:      true,
			CanPublish:        len(sources) > 0,
			CanPublishData:    true,
			CanPublishSources: sources,
			CanUpdateMetadata: true,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to update participant permissions: %w", err)
	}

	allowed := make(map[livekit.TrackSource]bool, len(sources))
	for _, src := range sources {
		allowed[src] = true
	}
	for _, track := range info.GetTracks() {
		if allowed[track.GetSource()] || track.GetMuted() {
			continue
		}
		if _, err := s.roomClient.MutePublishedTrack(ctx, &livekit.MuteRoomTrackRequest{
			Room: roomID, Identity: identity, TrackSid: track.GetSid(), Muted: true,
		}); err != nil {
			log.Printf("[LiveKit] Failed to mute disallowed track %s of %s: %v", track.GetSid(), identity, err)
		}
	}
	return nil
}
