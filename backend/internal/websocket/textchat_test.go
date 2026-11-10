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
	hub.SetTextChat(&TextChat{Store: store, ReadState: chatstore.NewMemoryReadState()})

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

func TestTextSendBroadcastsToViewers(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.text.ID, "hello")
	for _, c := range []*Client{f.alice, f.bob} {
		got := messagesOfType(t, c, "text_message_new")
		if len(got) != 1 {
			t.Fatalf("%s got %d text_message_new", c.userID, len(got))
		}
		data := got[0].Data.(map[string]interface{})
		if data["nonce"] != "n1" || data["message"].(map[string]interface{})["content"] != "hello" {
			t.Fatalf("bad payload: %+v", data)
		}
	}

	// A message in the secret channel never reaches bob.
	f.send(f.alice, f.hidden.ID, "psst")
	if len(messagesOfType(t, f.alice, "text_message_new")) != 1 {
		t.Fatal("alice did not get her own message")
	}
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatalf("bob received a hidden channel message: %+v", got)
	}
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

func TestTextSendDeniedPaths(t *testing.T) {
	f := newTextFixture(t)

	f.send(f.bob, f.hidden.ID, "let me in")
	if code := errorCode(t, f.bob); code != textErrNotFound {
		t.Fatalf("hidden channel: code %q", code)
	}
	f.send(f.bob, f.voice.ID, "not a text channel")
	if code := errorCode(t, f.bob); code != textErrNotFound {
		t.Fatalf("voice room: code %q", code)
	}

	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", 0, permissions.SendMessages)
	f.send(f.bob, f.text.ID, "muted")
	msgs := []string{}
	for {
		msg, ok := nextMessage(t, f.bob)
		if !ok {
			break
		}
		msgs = append(msgs, msg.Type)
	}
	if len(msgs) != 2 || msgs[0] != "permission_denied" || msgs[1] != "text_error" {
		t.Fatalf("send without send_messages got %v", msgs)
	}
	if got := messagesOfType(t, f.alice, "text_message_new"); len(got) != 0 {
		t.Fatal("denied message was broadcast")
	}
}

func TestTextSendRateLimit(t *testing.T) {
	f := newTextFixture(t)
	for i := 0; i < textSendLimit; i++ {
		f.send(f.alice, f.text.ID, "spam")
	}
	drain(f.alice)
	f.send(f.alice, f.text.ID, "one too many")
	if code := errorCode(t, f.alice); code != textErrRateLimited {
		t.Fatalf("code %q, want rate_limited", code)
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

func TestTextEditOnlyByAuthor(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "original")

	f.bob.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "hijacked"})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("edit by other: code %q", code)
	}
	f.alice.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "fixed"})
	got := messagesOfType(t, f.bob, "text_message_updated")
	if len(got) != 1 || got[0].Data.(map[string]interface{})["message"].(map[string]interface{})["content"] != "fixed" {
		t.Fatalf("edit broadcast: %+v", got)
	}
}

func TestTextDeleteRequiresManageMessagesForOthers(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "bob will try to delete this")

	f.bob.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("delete without manage_messages: code %q", code)
	}
	if _, err := f.store.Get(context.Background(), id); err != nil {
		t.Fatalf("message gone after denied delete: %v", err)
	}

	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", permissions.ManageMessages, 0)
	f.bob.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	if got := messagesOfType(t, f.alice, "text_message_deleted"); len(got) != 1 {
		t.Fatalf("delete with manage_messages not broadcast: %+v", got)
	}
	page, _ := f.store.History(context.Background(), chatstore.HistoryQuery{RoomID: f.text.ID})
	if len(page.Messages) != 0 {
		t.Fatal("deleted message still in history")
	}
}

func TestTextActionsOnHiddenChannelMessages(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.hidden.ID, "secret")
	id := messagesOfType(t, f.alice, "text_message_new")[0].Data.(map[string]interface{})["message"].(map[string]interface{})["id"].(string)
	// Even with manage_messages server-wide, bob can't touch what he can't see.
	f.overwrite(f.hidden.ID, models.OverwriteSubjectUser, "bob", permissions.ManageMessages, 0)
	f.bob.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	if code := errorCode(t, f.bob); code != textErrNotFound {
		t.Fatalf("delete in hidden channel: code %q", code)
	}
}

func TestTextChannelReadSyncsSessions(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "read me")
	second := f.connect("bob")
	m, _ := f.store.Get(context.Background(), id)

	// Positions beyond the newest message are clamped.
	f.bob.handleTextChannelRead(map[string]interface{}{"room_id": f.text.ID, "seq": m.Seq + 1000})
	got := messagesOfType(t, second, "text_read_state")
	if len(got) != 1 || int64(got[0].Data.(map[string]interface{})["last_read_seq"].(float64)) != m.Seq {
		t.Fatalf("read state sync: %+v", got)
	}
	drain(f.bob)
	f.bob.handleTextChannelRead(map[string]interface{}{"room_id": f.hidden.ID, "seq": 1})
	if got := messagesOfType(t, f.bob, "text_read_state"); len(got) != 0 {
		t.Fatal("read state accepted for a hidden channel")
	}
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
