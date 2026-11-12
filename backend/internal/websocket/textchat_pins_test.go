package websocket

import (
	"context"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
)

func TestPinRequiresManageMessages(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "pin me")
	f.bob.handleTextPin(map[string]interface{}{"message_id": id, "pinned": true})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("pin without ManageMessages: %s", code)
	}
	if m, _ := f.store.Get(context.Background(), id); m.Pinned {
		t.Fatal("message pinned without permission")
	}

	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", permissions.ManageMessages, 0)
	f.bob.handleTextPin(map[string]interface{}{"message_id": id, "pinned": true})
	got := messagesOfType(t, f.alice, "text_message_updated")
	if len(got) != 1 {
		t.Fatalf("pin broadcast: %d", len(got))
	}
	msg := got[0].Data.(map[string]interface{})["message"].(map[string]interface{})
	if msg["pinned"] != true || msg["pinned_by"] != "bob" {
		t.Fatalf("pinned message = %+v", msg)
	}
	drain(f.bob)
	// Pinning again changes nothing and broadcasts nothing.
	f.bob.handleTextPin(map[string]interface{}{"message_id": id, "pinned": true})
	if got := messagesOfType(t, f.alice, "text_message_updated"); len(got) != 0 {
		t.Fatal("no-op pin was broadcast")
	}
}
