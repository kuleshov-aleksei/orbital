package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

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
	f.text = NewTextChatHandler(f.store, readState, f.rooms, f.ps)
	f.room.SetTextChat(&websocket.TextChat{Store: f.store, ReadState: readState})
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

func TestTextHistoryRequiresViewRoom(t *testing.T) {
	f := newTextHandlerFixture(t)
	f.post(t, f.openText, "hello")
	f.post(t, f.hiddenText, "secret")

	rec := f.do(t, "user", f.text.GetMessages, http.MethodGet, map[string]string{"id": f.openText.ID}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("open channel: %d", rec.Code)
	}
	var page chatstore.Page
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if len(page.Messages) != 1 || page.Messages[0].Content != "hello" {
		t.Fatalf("page = %+v", page)
	}

	if rec := f.do(t, "user", f.text.GetMessages, http.MethodGet, map[string]string{"id": f.hiddenText.ID}, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("hidden channel history: %d, want 404", rec.Code)
	}
	if rec := f.do(t, "owner", f.text.GetMessages, http.MethodGet, map[string]string{"id": f.hiddenText.ID}, nil); rec.Code != http.StatusOK {
		t.Fatalf("owner on hidden channel: %d", rec.Code)
	}
	if rec := f.do(t, "user", f.text.GetMessages, http.MethodGet, map[string]string{"id": f.open.ID}, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("voice room history: %d, want 404", rec.Code)
	}
}

func TestTextContextHidesHiddenChannels(t *testing.T) {
	f := newTextHandlerFixture(t)
	secret := f.post(t, f.hiddenText, "secret")
	visible := f.post(t, f.openText, "visible")

	if rec := f.do(t, "user", f.text.GetMessageContext, http.MethodGet, map[string]string{"id": secret.ID}, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("context of hidden message: %d, want 404", rec.Code)
	}
	if rec := f.do(t, "user", f.text.GetMessageContext, http.MethodGet, map[string]string{"id": "missing"}, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("context of missing message: %d, want 404", rec.Code)
	}
	rec := f.do(t, "user", f.text.GetMessageContext, http.MethodGet, map[string]string{"id": visible.ID}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("context of visible message: %d", rec.Code)
	}

	// Deleted messages are gone for everyone.
	if _, err := f.store.Delete(context.Background(), visible.ID, "owner", nil); err != nil {
		t.Fatal(err)
	}
	if rec := f.do(t, "owner", f.text.GetMessageContext, http.MethodGet, map[string]string{"id": visible.ID}, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("context of deleted message: %d, want 404", rec.Code)
	}
}

func TestTextUnreadListsOnlyVisibleChannels(t *testing.T) {
	f := newTextHandlerFixture(t)
	m := f.post(t, f.openText, "new")
	f.post(t, f.hiddenText, "secret")

	rec := f.do(t, "user", f.text.GetUnread, http.MethodGet, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("unread: %d", rec.Code)
	}
	var resp struct {
		Channels []UnreadChannel `json:"channels"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Channels) != 1 || resp.Channels[0].RoomID != f.openText.ID || resp.Channels[0].NewestSeq != m.Seq || resp.Channels[0].LastReadSeq != 0 {
		t.Fatalf("unread = %+v", resp.Channels)
	}
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
