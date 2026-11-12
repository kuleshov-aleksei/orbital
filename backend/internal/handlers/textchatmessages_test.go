package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

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

func TestPinsRequireViewRoomAndHideDeleted(t *testing.T) {
	f := newTextHandlerFixture(t)
	ctx := context.Background()
	kept := f.post(t, f.openText, "keep")
	gone := f.post(t, f.openText, "gone")
	secret := f.post(t, f.hiddenText, "secret")
	for _, m := range []*chatstore.Message{kept, gone, secret} {
		if _, _, err := f.store.SetPinned(ctx, m.ID, "owner", true); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.store.Delete(ctx, gone.ID, "owner", nil); err != nil {
		t.Fatal(err)
	}
	rec := f.do(t, "user", f.text.GetPins, http.MethodGet, map[string]string{"id": f.openText.ID}, nil)
	var body struct {
		Messages []chatstore.PublicMessage `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusOK || len(body.Messages) != 1 || body.Messages[0].ID != kept.ID {
		t.Fatalf("pins = %d %+v", rec.Code, body)
	}
	if rec := f.do(t, "user", f.text.GetPins, http.MethodGet, map[string]string{"id": f.hiddenText.ID}, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("hidden pins: %d, want 404", rec.Code)
	}
}
