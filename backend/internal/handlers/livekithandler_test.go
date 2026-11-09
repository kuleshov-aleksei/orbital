package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

func newTestLiveKitHandler(t *testing.T) (*LiveKitHandler, *service.RoomService) {
	t.Helper()

	livekitService, err := service.NewLiveKitService(&config.LiveKitConfig{
		URL:       "ws://localhost:7880",
		APIKey:    "key",
		APISecret: "secret",
	})
	if err != nil {
		t.Fatalf("NewLiveKitService: %v", err)
	}
	roomService := service.NewRoomService(nil, nil)
	ps := service.NewPermissionService(nil, roomService, nil, nil)
	if err := ps.LoadFromDB(); err != nil {
		t.Fatalf("LoadFromDB: %v", err)
	}
	return NewLiveKitHandler(livekitService, roomService, ps), roomService
}

func TestGenerateTokenRejectsMissingRoom(t *testing.T) {
	handler, _ := newTestLiveKitHandler(t)

	body, _ := json.Marshal(TokenRequest{RoomID: "missing"})
	req := httptest.NewRequest(http.MethodPost, "/api/livekit/token", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{
		UserID:   "user-1",
		Nickname: "Alice",
		Role:     models.RoleUser,
	}))
	rec := httptest.NewRecorder()

	handler.GenerateToken(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestGenerateTokenForExistingRoom(t *testing.T) {
	handler, roomService := newTestLiveKitHandler(t)
	room, err := roomService.CreateRoom("R", "general", 10, "voice")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}

	body, _ := json.Marshal(TokenRequest{RoomID: room.ID})
	req := httptest.NewRequest(http.MethodPost, "/api/livekit/token", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{
		UserID:   "user-1",
		Nickname: "Alice",
		Role:     models.RoleUser,
	}))
	rec := httptest.NewRecorder()

	handler.GenerateToken(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
}
