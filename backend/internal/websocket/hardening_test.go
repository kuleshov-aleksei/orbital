package websocket

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

func TestCheckOrigin(t *testing.T) {
	hub := &Hub{cfg: &config.Config{
		Server: config.ServerConfig{
			Mode:        "production",
			CORSOrigins: []string{"https://orbital.example"},
		},
	}}

	cases := []struct {
		name   string
		origin string
		want   bool
	}{
		{name: "no origin", origin: "", want: true},
		{name: "configured origin", origin: "https://orbital.example", want: true},
		{name: "electron", origin: "orbital://app", want: true},
		{name: "trailing slash", origin: "https://orbital.example/", want: true},
		{name: "untrusted origin", origin: "https://evil.example", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/ws", nil)
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if got := hub.checkOrigin(r); got != tc.want {
				t.Fatalf("checkOrigin(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

func TestCheckOriginWildcard(t *testing.T) {
	hub := &Hub{cfg: &config.Config{Server: config.ServerConfig{CORSOrigins: []string{"*"}}}}
	r := httptest.NewRequest("GET", "/ws", nil)
	r.Header.Set("Origin", "https://anything.example")
	if !hub.checkOrigin(r) {
		t.Fatal("wildcard CORS should allow the origin")
	}
}

func TestRoomSubscriptionOnlyAfterJoin(t *testing.T) {
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
	client := &Client{
		hub:    hub,
		send:   make(chan []byte, 32),
		roomID: room.ID,
	}
	client.userID = "user-1"

	if hub.roomClients[room.ID][client] {
		t.Fatal("client was subscribed before join")
	}

	client.handleJoinRoom(map[string]interface{}{
		"room_id":  room.ID,
		"user_id":  "user-1",
		"nickname": "Alice",
	})
	if !hub.roomClients[room.ID][client] {
		t.Fatal("client was not subscribed after successful join")
	}

	client.handleLeaveRoom(nil)
	if hub.roomClients[room.ID][client] {
		t.Fatal("client remained subscribed after leave")
	}
}

func TestSendMessageRequiresMembership(t *testing.T) {
	cfg := &config.Config{WebSocket: config.WebSocketConfig{
		PingTimeout:       30 * time.Second,
		PingCheckInterval: time.Hour,
	}}
	roomService := service.NewRoomService(nil, nil)
	if _, err := roomService.CreateRoom("R", "general", 10, "voice"); err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}

	hub := NewHub(roomService, nil, nil, nil, nil, cfg)
	client := &Client{
		hub:    hub,
		send:   make(chan []byte, 8),
		roomID: "room-1",
	}
	client.userID = "user-1"

	client.handleSendMessage(map[string]interface{}{"content": "hello"})

	select {
	case msg := <-client.send:
		var parsed models.WebSocketMessage
		if err := json.Unmarshal(msg, &parsed); err != nil {
			t.Fatalf("decode error message: %v", err)
		}
		if parsed.Type != "error" {
			t.Fatalf("message type = %q, want error", parsed.Type)
		}
	default:
		t.Fatal("expected an error response for a non-member message")
	}
}

func TestDecodeStatsBatchRejectsOversizedDecompressedPayload(t *testing.T) {
	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	if _, err := zw.Write(bytes.Repeat([]byte("a"), maxStatsDecompressedBytes+1)); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}

	data := base64.StdEncoding.EncodeToString(compressed.Bytes())
	if _, err := decodeStatsBatch(data); err == nil {
		t.Fatal("expected oversized decompressed payload to be rejected")
	}
}

func TestDecodeStatsBatchAcceptsSmallPayload(t *testing.T) {
	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	if _, err := zw.Write([]byte(`{"room_id":"r1"}`)); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}

	data := base64.StdEncoding.EncodeToString(compressed.Bytes())
	raw, err := decodeStatsBatch(data)
	if err != nil {
		t.Fatalf("decodeStatsBatch: %v", err)
	}
	if string(raw) != `{"room_id":"r1"}` {
		t.Fatalf("decoded = %q", raw)
	}
}

func TestSubscribeAdminByUserIDSubscribesEveryConnection(t *testing.T) {
	hub := NewHub(nil, nil, nil, nil, nil, &config.Config{})
	// One tab = global connection + room connection, plus another unrelated user
	global := &Client{hub: hub, send: make(chan []byte, 4), userID: "admin"}
	room := &Client{hub: hub, send: make(chan []byte, 4), userID: "admin", roomID: "room-1"}
	other := &Client{hub: hub, send: make(chan []byte, 4), userID: "someone-else"}
	for _, c := range []*Client{global, room, other} {
		hub.clients[c] = true
	}

	hub.SubscribeAdminByUserID("admin", "room-1")
	subs := hub.statsAdminSubs["room-1"]
	if !subs[global] || !subs[room] {
		t.Fatalf("expected both admin connections subscribed, got %v", subs)
	}
	if subs[other] {
		t.Fatal("unrelated user must not be subscribed")
	}

	hub.UnsubscribeAdminByUserID("admin", "room-1")
	if _, ok := hub.statsAdminSubs["room-1"]; ok {
		t.Fatal("expected all admin connections unsubscribed")
	}
}
