package websocket

import (
	"context"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func TestSuppressEmbedsNeedsAuthorOrManageMessages(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "look https://example.com")
	if _, err := f.store.SetEmbeds(context.Background(), id, "look https://example.com",
		[]chatstore.Embed{{URL: "https://example.com", Kind: chatstore.EmbedLink, Title: "Example"}}); err != nil {
		t.Fatal(err)
	}

	// bob is neither the author nor a moderator.
	f.bob.handleTextMessageSuppressEmbeds(map[string]interface{}{"message_id": id})
	if got := messagesOfType(t, f.bob, "permission_denied"); len(got) != 1 {
		t.Fatalf("bob: got %d permission_denied, want 1", len(got))
	}
	if msg, _ := f.store.Get(context.Background(), id); len(msg.Embeds) != 1 || msg.EmbedsSuppressed {
		t.Fatal("bob removed the previews")
	}
	drain(f.alice)

	f.alice.handleTextMessageSuppressEmbeds(map[string]interface{}{"message_id": id})
	updates := messagesOfType(t, f.bob, "text_message_updated")
	if len(updates) != 1 {
		t.Fatalf("bob got %d text_message_updated, want 1", len(updates))
	}
	msg := updates[0].Data.(map[string]interface{})["message"].(map[string]interface{})
	if msg["embeds_suppressed"] != true || len(msg["embeds"].([]interface{})) != 0 {
		t.Fatalf("broadcast message = %+v", msg)
	}
}
