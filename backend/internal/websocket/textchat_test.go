package websocket

import (
	"context"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

type textFixture struct {
	hub    *Hub
	ps     *service.PermissionService
	store  *chatstore.Service
	text   *models.Room
	hidden *models.Room
	voice  *models.Room
	alice  *Client // global socket
	bob    *Client // global socket
}

var ownerSubject = service.Subject{UserID: "owner", IsOwner: true}

func newTextFixture(t *testing.T) *textFixture {
	t.Helper()
	cfg := &config.Config{WebSocket: config.WebSocketConfig{PingTimeout: 30 * time.Second, PingCheckInterval: time.Hour}}
	rooms := service.NewRoomService(nil, nil)
	text, _ := rooms.CreateRoom("general", "general", 10, models.RoomTypeText)
	hidden, _ := rooms.CreateRoom("secret", "general", 10, models.RoomTypeText)
	voice, _ := rooms.CreateRoom("voice", "general", 10, models.RoomTypeVoice)
	ps := service.NewPermissionService(nil, rooms, nil, func(id string) *models.User {
		if id == "alice" || id == "bob" {
			return &models.User{ID: id, Nickname: id, Role: models.RoleUser}
		}
		return nil
	})
	if err := ps.LoadFromDB(); err != nil {
		t.Fatal(err)
	}
	hub := NewHub(rooms, nil, nil, nil, nil, cfg)
	hub.SetPermissionService(ps)
	store := chatstore.New(chatstore.NewMemoryEngine(), chatstore.Options{})
	if err := store.Bootstrap(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	hub.SetTextChat(&TextChat{Store: store, ReadState: chatstore.NewMemoryReadState(),
		UserExists: func(id string) bool { return id == "alice" || id == "bob" }})

	f := &textFixture{hub: hub, ps: ps, store: store, text: text, hidden: hidden, voice: voice}
	f.alice = f.connect("alice")
	f.bob = f.connect("bob")
	// Only alice may see the secret channel.
	f.overwrite(hidden.ID, models.OverwriteSubjectRole, models.SystemRoleEveryone, 0, permissions.ViewRoom)
	f.overwrite(hidden.ID, models.OverwriteSubjectUser, "alice", permissions.ViewRoom, 0)
	return f
}

func (f *textFixture) connect(userID string) *Client {
	c := &Client{hub: f.hub, send: make(chan []byte, 64), userID: userID, subject: service.Subject{UserID: userID}}
	f.hub.mu.Lock()
	f.hub.clients[c] = true
	f.hub.mu.Unlock()
	return c
}

func (f *textFixture) overwrite(roomID, subjectType, subjectID string, allow, deny permissions.Permission) {
	if _, err := f.ps.SetOverwrite(ownerSubject, models.PermissionOverwrite{
		TargetType: models.OverwriteTargetRoom, TargetID: roomID,
		SubjectType: subjectType, SubjectID: subjectID,
		Allow: uint64(allow), Deny: uint64(deny),
	}); err != nil {
		panic(err)
	}
	drain(f.alice)
	drain(f.bob)
}

// messagesOfType pops all queued messages and returns those of one type.
func messagesOfType(t *testing.T, c *Client, typ string) []models.WebSocketMessage {
	t.Helper()
	var out []models.WebSocketMessage
	for {
		msg, ok := nextMessage(t, c)
		if !ok {
			return out
		}
		if msg.Type == typ {
			out = append(out, msg)
		}
	}
}

func errorCode(t *testing.T, c *Client) string {
	t.Helper()
	errs := messagesOfType(t, c, "text_error")
	if len(errs) != 1 {
		t.Fatalf("got %d text_error messages, want 1", len(errs))
	}
	return errs[0].Data.(map[string]interface{})["code"].(string)
}

func (f *textFixture) send(c *Client, roomID, content string) {
	c.handleTextMessageSend(map[string]interface{}{"room_id": roomID, "content": content, "nonce": "n1"})
}

func TestTextEventsSkipRoomSockets(t *testing.T) {
	f := newTextFixture(t)
	callSocket := f.connect("bob")
	callSocket.roomID = f.voice.ID
	f.send(f.alice, f.text.ID, "hi")
	if got := messagesOfType(t, callSocket, "text_message_new"); len(got) != 0 {
		t.Fatal("room socket received a text event (would duplicate the global one)")
	}
}

func (f *textFixture) postAs(t *testing.T, c *Client, content string) string {
	t.Helper()
	f.send(c, f.text.ID, content)
	got := messagesOfType(t, c, "text_message_new")
	if len(got) != 1 {
		t.Fatalf("message not created")
	}
	drain(f.alice)
	drain(f.bob)
	return got[0].Data.(map[string]interface{})["message"].(map[string]interface{})["id"].(string)
}

func TestTextChannelRejectsJoin(t *testing.T) {
	f := newTextFixture(t)
	c := &Client{hub: f.hub, send: make(chan []byte, 32), roomID: f.text.ID, userID: "alice", subject: service.Subject{UserID: "alice"}}
	c.handleJoinRoom(map[string]interface{}{"room_id": f.text.ID, "nickname": "Alice"})
	if f.hub.roomService.IsUserInRoom(f.text.ID, "alice") {
		t.Fatal("joined a text channel")
	}
	if got := messagesOfType(t, c, "error"); len(got) != 1 {
		t.Fatalf("expected an error reply, got %+v", got)
	}
}

func (f *textFixture) notify() chatstore.NotifyStore { return f.hub.textChatService().Notify }

func mentionPings(t *testing.T, c *Client) int {
	t.Helper()
	return len(messagesOfType(t, c, "text_mention"))
}

func (f *textFixture) createdMessage(t *testing.T, c *Client) map[string]interface{} {
	t.Helper()
	got := messagesOfType(t, c, "text_message_new")
	if len(got) != 1 {
		t.Fatalf("%s got %d text_message_new", c.userID, len(got))
	}
	return got[0].Data.(map[string]interface{})["message"].(map[string]interface{})
}
