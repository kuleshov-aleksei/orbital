package websocket

import (
	"context"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func (f *textFixture) sendWithNonce(c *Client, roomID, content, nonce string) {
	c.handleTextMessageSend(map[string]interface{}{"room_id": roomID, "content": content, "nonce": nonce})
}

// An outbox resend (same nonce, echo lost) must not create a second message:
// only the sender gets the original message back.
func TestTextSendSameNonceCreatesOneMessage(t *testing.T) {
	f := newTextFixture(t)
	const nonce = "6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f"
	f.sendWithNonce(f.alice, f.text.ID, "queued offline", nonce)
	first := f.createdMessage(t, f.alice)
	drain(f.bob)

	f.sendWithNonce(f.alice, f.text.ID, "queued offline", nonce)
	resent := messagesOfType(t, f.alice, "text_message_new")
	if len(resent) != 1 {
		t.Fatalf("resend got %d text_message_new, want 1 ack", len(resent))
	}
	data := resent[0].Data.(map[string]interface{})
	if data["nonce"] != nonce {
		t.Fatalf("ack without the nonce: %+v", data)
	}
	if id := data["message"].(map[string]interface{})["id"]; id != first["id"] {
		t.Fatalf("resend created %v, want the original %v", id, first["id"])
	}
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatalf("resend was broadcast again: %+v", got)
	}
	page, err := f.store.History(context.Background(), chatstore.HistoryQuery{RoomID: f.text.ID, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 1 {
		t.Fatalf("channel has %d messages, want 1", len(page.Messages))
	}
}

func TestTextSendNonceIsPerUser(t *testing.T) {
	f := newTextFixture(t)
	const nonce = "shared-nonce"
	f.sendWithNonce(f.alice, f.text.ID, "from alice", nonce)
	a := f.createdMessage(t, f.alice)
	drain(f.bob)
	f.sendWithNonce(f.bob, f.text.ID, "from bob", nonce)
	b := f.createdMessage(t, f.bob)
	if a["id"] == b["id"] {
		t.Fatal("another user's nonce returned alice's message")
	}
}

// A rejected send (here: rate limited) leaves the nonce free for the retry.
func TestTextSendFailedNonceCanBeRetried(t *testing.T) {
	f := newTextFixture(t)
	for i := 0; i < textSendLimit; i++ {
		f.send(f.alice, f.text.ID, "spam")
	}
	drain(f.alice)
	const nonce = "retry-me"
	f.sendWithNonce(f.alice, f.text.ID, "late", nonce)
	if code := errorCode(t, f.alice); code != textErrRateLimited {
		t.Fatalf("got %q, want rate_limited", code)
	}
	if _, state := f.hub.textNonces.claim("alice", nonce); state != nonceNew {
		t.Fatalf("failed send kept its nonce (state %d)", state)
	}
}

func TestSentNoncesExpire(t *testing.T) {
	s := newSentNonces()
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	if _, state := s.claim("qkUrdzLDoqslx8EEy2cM7Q==", "n"); state != nonceNew {
		t.Fatal("fresh nonce not new")
	}
	if _, state := s.claim("qkUrdzLDoqslx8EEy2cM7Q==", "n"); state != nonceInFlight {
		t.Fatal("unfinished claim not reported in flight")
	}
	s.complete("qkUrdzLDoqslx8EEy2cM7Q==", "n", "msg-1")
	if id, state := s.claim("qkUrdzLDoqslx8EEy2cM7Q==", "n"); state != nonceDone || id != "msg-1" {
		t.Fatalf("got %q/%d, want msg-1 done", id, state)
	}
	now = now.Add(sentNonceTTL + time.Minute)
	if _, state := s.claim("qkUrdzLDoqslx8EEy2cM7Q==", "n"); state != nonceNew {
		t.Fatal("expired nonce still remembered")
	}
}
