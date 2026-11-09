package websocket

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

type fakeSounds map[string]bool

func (f fakeSounds) SoundExists(id string) bool { return f[id] }

type soundFixture struct {
	hub    *Hub
	ps     *service.PermissionService
	room   *models.Room
	client *Client
}

func newSoundFixture(t *testing.T) *soundFixture {
	t.Helper()
	cfg := &config.Config{WebSocket: config.WebSocketConfig{PingTimeout: 30 * time.Second, PingCheckInterval: time.Hour}}
	rooms := service.NewRoomService(nil, nil)
	room, err := rooms.CreateRoom("R", "general", 10, "voice")
	if err != nil {
		t.Fatal(err)
	}
	ps := service.NewPermissionService(nil, rooms, nil, func(id string) *models.User {
		u, _ := rooms.GetUserByID(id)
		return u
	})
	if err := ps.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	hub := NewHub(rooms, nil, nil, nil, nil, cfg)
	hub.SetPermissionService(ps)
	hub.SetSoundboard(fakeSounds{"airhorn": true})

	client := &Client{hub: hub, send: make(chan []byte, 32), roomID: room.ID}
	client.userID = "user-1"
	client.subject = service.Subject{UserID: "user-1"}
	client.handleJoinRoom(map[string]interface{}{"room_id": room.ID, "nickname": "Alice"})
	drain(client)
	return &soundFixture{hub: hub, ps: ps, room: room, client: client}
}

func drain(c *Client) {
	for {
		select {
		case <-c.send:
		default:
			return
		}
	}
}

// nextMessage pops the next queued message, if any.
func nextMessage(t *testing.T, c *Client) (models.WebSocketMessage, bool) {
	t.Helper()
	for {
		select {
		case raw := <-c.send:
			var msg models.WebSocketMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				t.Fatalf("decode: %v", err)
			}
			return msg, true
		default:
			return models.WebSocketMessage{}, false
		}
	}
}

func TestPlaySoundBroadcastsToRoom(t *testing.T) {
	f := newSoundFixture(t)
	f.client.handlePlaySound(map[string]interface{}{"sound_id": "airhorn"})
	msg, ok := nextMessage(t, f.client)
	if !ok || msg.Type != "sound_played" {
		t.Fatalf("got %+v, want sound_played", msg)
	}
	data := msg.Data.(map[string]interface{})
	if data["sound_id"] != "airhorn" || data["user_id"] != "user-1" || data["room_id"] != f.room.ID {
		t.Fatalf("bad payload: %+v", data)
	}
}

func TestPlaySoundIsThrottled(t *testing.T) {
	f := newSoundFixture(t)
	f.client.handlePlaySound(map[string]interface{}{"sound_id": "airhorn"})
	f.client.handlePlaySound(map[string]interface{}{"sound_id": "airhorn"})
	if _, ok := nextMessage(t, f.client); !ok {
		t.Fatal("first play was not broadcast")
	}
	if msg, ok := nextMessage(t, f.client); ok {
		t.Fatalf("second play inside the cooldown was broadcast: %+v", msg)
	}
	if !f.hub.allowSoundPlay("user-1", time.Now().Add(SoundPlayCooldown)) {
		t.Fatal("play after the cooldown should be allowed")
	}
}

func TestPlaySoundRejectsUnknownSound(t *testing.T) {
	f := newSoundFixture(t)
	f.client.handlePlaySound(map[string]interface{}{"sound_id": "nope"})
	if msg, _ := nextMessage(t, f.client); msg.Type != "error" {
		t.Fatalf("got %q, want error", msg.Type)
	}
}

func TestPlaySoundRequiresMembership(t *testing.T) {
	f := newSoundFixture(t)
	outsider := &Client{hub: f.hub, send: make(chan []byte, 8), roomID: f.room.ID}
	outsider.userID = "user-2"
	outsider.subject = service.Subject{UserID: "user-2"}
	outsider.handlePlaySound(map[string]interface{}{"sound_id": "airhorn"})
	if msg, _ := nextMessage(t, outsider); msg.Type != "error" {
		t.Fatalf("got %q, want error", msg.Type)
	}
	if msg, ok := nextMessage(t, f.client); ok {
		t.Fatalf("room received a play from a non-member: %+v", msg)
	}
}

func TestPlaySoundRequiresUseSoundboard(t *testing.T) {
	f := newSoundFixture(t)
	owner := service.Subject{UserID: "owner", IsOwner: true}
	if _, err := f.ps.SetOverwrite(owner, models.PermissionOverwrite{
		TargetType: models.OverwriteTargetRoom, TargetID: f.room.ID,
		SubjectType: models.OverwriteSubjectRole, SubjectID: models.SystemRoleEveryone,
		Deny: uint64(permissions.UseSoundboard),
	}); err != nil {
		t.Fatal(err)
	}
	drain(f.client) // permissions_updated etc.

	f.client.handlePlaySound(map[string]interface{}{"sound_id": "airhorn"})
	msg, ok := nextMessage(t, f.client)
	if !ok || msg.Type != "permission_denied" {
		t.Fatalf("got %+v, want permission_denied", msg)
	}
	if data := msg.Data.(map[string]interface{}); data["action"] != "play_sound" {
		t.Fatalf("bad denied payload: %+v", data)
	}
	if extra, ok := nextMessage(t, f.client); ok {
		t.Fatalf("denied play was still broadcast: %+v", extra)
	}
}
