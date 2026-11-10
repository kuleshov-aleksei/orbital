package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

type textHandlerFixture struct {
	*rbacFixture
	store      *chatstore.Service
	text       *TextChatHandler
	openText   *models.Room
	hiddenText *models.Room
	notify     *repository.TextNotifyRepository
	events     *recordedEvents
}

func newTextHandlerFixture(t *testing.T) *textHandlerFixture {
	t.Helper()
	f := &textHandlerFixture{rbacFixture: newRBACFixture(t)}
	general := f.cats.GetGeneralCategoryID()
	f.openText, _ = f.rooms.CreateRoom("chat", general, 5, models.RoomTypeText)
	f.hiddenText, _ = f.rooms.CreateRoom("staff", general, 5, models.RoomTypeText)
	if _, err := f.ps.SetOverwrite(f.ownerSub, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: f.hiddenText.ID,
		SubjectType: models.OverwriteSubjectRole, SubjectID: models.SystemRoleEveryone,
		Deny: uint64(permissions.ViewRoom)}); err != nil {
		t.Fatal(err)
	}
	f.store = chatstore.New(chatstore.NewMemoryEngine(), chatstore.Options{})
	if err := f.store.Bootstrap(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	readState := repository.NewTextReadStateRepository(f.db)
	f.notify = repository.NewTextNotifyRepository(f.db)
	f.events = &recordedEvents{}
	f.text = NewTextChatHandler(TextChatDeps{
		Store: f.store, ReadState: readState, Notify: f.notify, RoomService: f.rooms, Permissions: f.ps,
		Users: f.allUsers, Events: f.events,
	})
	f.room.SetTextChat(&websocket.TextChat{Store: f.store, ReadState: readState, Notify: f.notify})
	return f
}

func (f *textHandlerFixture) post(t *testing.T, room *models.Room, content string) *chatstore.Message {
	t.Helper()
	m, err := f.store.Create(context.Background(), chatstore.CreateInput{RoomID: room.ID, SenderID: "owner", Content: content})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestTextChannelGuards(t *testing.T) {
	f := newTextHandlerFixture(t)
	if rec := f.do(t, "user", f.room.JoinRoom, http.MethodPost, map[string]string{"id": f.openText.ID}, map[string]string{"nickname": "u"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("join text channel: %d, want 400", rec.Code)
	}
	if f.rooms.IsUserInRoom(f.openText.ID, "user") {
		t.Fatal("user joined a text channel")
	}
	if rec := f.do(t, "user", f.livekit.GenerateToken, http.MethodPost, nil, map[string]string{"room_id": f.openText.ID}); rec.Code != http.StatusBadRequest && rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("livekit token for text channel: %d", rec.Code)
	}
	if rec := f.do(t, "owner", f.room.UpdateRoom, http.MethodPut, map[string]string{"id": f.openText.ID}, map[string]string{"type": "voice"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("convert text to voice: %d, want 400", rec.Code)
	}
	if rec := f.do(t, "owner", f.room.UpdateRoom, http.MethodPut, map[string]string{"id": f.open.ID}, map[string]string{"type": "text"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("convert voice to text: %d, want 400", rec.Code)
	}
}

func TestCreateTextChannelNeedsMeilisearch(t *testing.T) {
	f := newRBACFixture(t) // no SetTextChat: text channels disabled
	body := map[string]interface{}{"name": "chat", "category": "General", "max_users": 5, "type": "text"}
	if rec := f.do(t, "owner", f.room.CreateRoom, http.MethodPost, nil, body); rec.Code != http.StatusBadRequest {
		t.Fatalf("create text channel without Meilisearch: %d, want 400", rec.Code)
	}
	body["type"] = "bogus"
	if rec := f.do(t, "owner", f.room.CreateRoom, http.MethodPost, nil, body); rec.Code != http.StatusBadRequest {
		t.Fatalf("create unknown type: %d, want 400", rec.Code)
	}
}

func TestDeleteTextChannelRemovesMessages(t *testing.T) {
	f := newTextHandlerFixture(t)
	f.post(t, f.openText, "bye")
	if rec := f.do(t, "owner", f.room.DeleteRoom, http.MethodDelete, map[string]string{"id": f.openText.ID}, nil); rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	page, err := f.store.History(context.Background(), chatstore.HistoryQuery{RoomID: f.openText.ID})
	if err != nil || len(page.Messages) != 0 {
		t.Fatalf("messages left after channel delete: %+v %v", page, err)
	}
}

type recordedEvents struct {
	mu   sync.Mutex
	sent []string // "user:type"
}

func (e *recordedEvents) SendTextToUser(userID string, message models.WebSocketMessage) {
	e.mu.Lock()
	e.sent = append(e.sent, userID+":"+message.Type)
	e.mu.Unlock()
}

func (f *textHandlerFixture) allUsers() []*models.User {
	users, _ := f.users.GetAll()
	return users
}

func (f *textHandlerFixture) query(t *testing.T, as string, h http.HandlerFunc, method string, vars map[string]string, q url.Values, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, "/?"+q.Encode(), &buf)
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, f.claims[as]))
	if vars != nil {
		req = mux.SetURLVars(req, vars)
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func (f *textHandlerFixture) postAs(t *testing.T, room *models.Room, sender, content string) *chatstore.Message {
	t.Helper()
	m, err := f.store.Create(context.Background(), chatstore.CreateInput{RoomID: room.ID, SenderID: sender, Content: content})
	if err != nil {
		t.Fatal(err)
	}
	return m
}
