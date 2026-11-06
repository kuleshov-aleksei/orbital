package websocket

import (
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

func newMediaTestClient(t *testing.T) (*Client, *service.RoomService, string) {
	t.Helper()
	cfg := &config.Config{WebSocket: config.WebSocketConfig{
		PingTimeout:       30 * time.Second,
		PingCheckInterval: time.Hour,
	}}
	roomService := service.NewRoomService(nil, nil)
	room, err := roomService.CreateRoom("R", "general", 10, "voice")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	hub := NewHub(roomService, nil, nil, nil, nil, cfg)
	client := &Client{hub: hub, send: make(chan []byte, 32), roomID: room.ID}
	client.userID = "user-1"
	return client, roomService, room.ID
}

func TestJoinRoomAppliesInitialMediaState(t *testing.T) {
	client, roomService, roomID := newMediaTestClient(t)

	client.handleJoinRoom(map[string]interface{}{
		"room_id":  roomID,
		"nickname": "Alice",
		"media_state": map[string]interface{}{
			"is_muted":          true,
			"is_camera_enabled": true,
		},
	})

	got, ok := roomService.GetUserMediaState(roomID, "user-1")
	if !ok || !got.IsMuted || !got.IsCameraEnabled || got.IsDeafened || got.IsScreenSharing {
		t.Fatalf("state after join = %+v, ok=%v", got, ok)
	}
}

func TestLegacyMuteUpdateKeepsOtherFields(t *testing.T) {
	client, roomService, roomID := newMediaTestClient(t)
	client.handleJoinRoom(map[string]interface{}{"room_id": roomID, "nickname": "Alice"})

	client.handleUpdateMediaState(map[string]interface{}{
		"room_id":           roomID,
		"is_deafened":       true,
		"is_muted":          true,
		"is_screen_sharing": true,
	})
	client.handleUpdateMuteState(map[string]interface{}{"room_id": roomID, "is_muted": false})

	got, _ := roomService.GetUserMediaState(roomID, "user-1")
	if got.IsMuted || !got.IsDeafened || !got.IsScreenSharing {
		t.Fatalf("legacy mute update clobbered state: %+v", got)
	}
}

func TestMediaStateRejectedForNonMember(t *testing.T) {
	client, roomService, roomID := newMediaTestClient(t)
	client.handleUpdateMediaState(map[string]interface{}{"room_id": roomID, "is_muted": true})
	if _, ok := roomService.GetUserMediaState(roomID, "user-1"); ok {
		t.Fatal("non-member should not get a media state")
	}
}
