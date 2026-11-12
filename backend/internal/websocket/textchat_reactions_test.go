package websocket

import (
	"context"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func TestReactionToggle(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "react to me")
	f.bob.handleTextReactionToggle(map[string]interface{}{"message_id": id, "emoji": "👍"})
	got := messagesOfType(t, f.alice, "text_message_updated")
	if len(got) != 1 {
		t.Fatalf("alice got %d updates", len(got))
	}
	reactions := got[0].Data.(map[string]interface{})["message"].(map[string]interface{})["reactions"].([]interface{})
	if len(reactions) != 1 {
		t.Fatalf("reactions = %v", reactions)
	}
	drain(f.bob)
	f.bob.handleTextReactionToggle(map[string]interface{}{"message_id": id, "emoji": "not an emoji"})
	if code := errorCode(t, f.bob); code != textErrInvalid {
		t.Fatalf("bad emoji code = %s", code)
	}
}

func TestReactionDeniedPaths(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "hi")
	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", 0, permissions.SendMessages)
	f.bob.handleTextReactionToggle(map[string]interface{}{"message_id": id, "emoji": "👍"})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("react without SendMessages: %s", code)
	}
	if got := messagesOfType(t, f.alice, "text_message_updated"); len(got) != 0 {
		t.Fatal("denied reaction was broadcast")
	}
	// Hidden channel messages look missing.
	secret := f.store
	m, err := secret.Create(context.Background(), chatstore.CreateInput{RoomID: f.hidden.ID, SenderID: "alice", Content: "s"})
	if err != nil {
		t.Fatal(err)
	}
	f.bob.handleTextReactionToggle(map[string]interface{}{"message_id": m.ID, "emoji": "👍"})
	if code := errorCode(t, f.bob); code != textErrNotFound {
		t.Fatalf("react in hidden channel: %s", code)
	}
}
