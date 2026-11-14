package websocket

import (
	"context"
	"sync"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/service/push"
)

type sentPush struct {
	tokens []string
	note   push.Notification
}

type fakeSender struct {
	mu      sync.Mutex
	sent    []sentPush
	invalid []string
}

func (s *fakeSender) Send(_ context.Context, tokens []string, n push.Notification) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, sentPush{tokens: tokens, note: n})
	return s.invalid, nil
}

func (s *fakeSender) take() []sentPush {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.sent
	s.sent = nil
	return out
}

type fakeDevices struct {
	mu     sync.Mutex
	tokens map[string][]string
}

func (d *fakeDevices) TokensForUser(userID string) ([]string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.tokens[userID], nil
}

func (d *fakeDevices) Delete(token string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	for u, list := range d.tokens {
		kept := list[:0]
		for _, t := range list {
			if t != token {
				kept = append(kept, t)
			}
		}
		d.tokens[u] = kept
	}
	return nil
}

func withPush(f *textFixture) (*fakeSender, *fakeDevices) {
	sender := &fakeSender{}
	devices := &fakeDevices{tokens: map[string][]string{"alice": {"tok-alice"}, "bob": {"tok-bob"}}}
	tc := f.hub.textChatService()
	tc.Push = push.NewSyncService(sender, devices)
	tc.UserName = func(id string) string {
		return map[string]string{"alice": "Alice", "bob": "Bob"}[id]
	}
	return sender, devices
}

func setActive(c *Client, active bool) {
	c.handleClientState(map[string]any{"active": active})
}

func TestMentionPushOnlyWhenNoActiveSession(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)

	// Sockets that never reported state count as active.
	f.send(f.alice, f.text.ID, "hi <@bob>")
	if got := sender.take(); len(got) != 0 {
		t.Fatalf("pushed to an active user: %+v", got)
	}

	setActive(f.bob, false)
	f.send(f.alice, f.text.ID, "hi <@bob> look <:party:0b6c1f2e-9d4a-4c1b-8f3e-2a1d5c6b7e8f>")
	got := sender.take()
	if len(got) != 1 || len(got[0].tokens) != 1 || got[0].tokens[0] != "tok-bob" {
		t.Fatalf("pushes = %+v", got)
	}
	n := got[0].note
	if n.Title != "#general" || n.Body != "Alice: hi @Bob look :party:" || n.Tag != f.text.ID {
		t.Fatalf("notification = %+v", n)
	}
	if n.Data["room_id"] != f.text.ID || n.Data["type"] != "text_mention" || n.Data["message_id"] == "" {
		t.Fatalf("data = %+v", n.Data)
	}

	// Any other active session (e.g. a focused desktop) suppresses the push.
	desktop := f.connect("bob")
	f.send(f.alice, f.text.ID, "again <@bob>")
	if got := sender.take(); len(got) != 0 {
		t.Fatalf("pushed while a desktop session is active: %+v", got)
	}
	setActive(desktop, false)
	f.send(f.alice, f.text.ID, "and again <@bob>")
	if got := sender.take(); len(got) != 1 {
		t.Fatalf("all sessions inactive: %d pushes", len(got))
	}
}

func TestMentionPushRespectsMentionRules(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	setActive(f.alice, false)
	setActive(f.bob, false)

	// Never the sender.
	f.send(f.alice, f.text.ID, "note to self <@alice>")
	// Not a user who can't view the channel.
	f.send(f.alice, f.hidden.ID, "secret for <@bob>")
	// Not a muted channel.
	if err := f.notify().Set("bob", f.text.ID, chatstore.NotifySetting{Mode: chatstore.NotifyMuted}); err != nil {
		t.Fatal(err)
	}
	f.send(f.alice, f.text.ID, "<@bob> muted")
	if got := sender.take(); len(got) != 0 {
		t.Fatalf("unexpected pushes: %+v", got)
	}
}

func TestMentionPushDropsInvalidTokens(t *testing.T) {
	f := newTextFixture(t)
	sender, devices := withPush(f)
	sender.invalid = []string{"tok-bob"}
	setActive(f.bob, false)
	f.send(f.alice, f.text.ID, "<@bob>")
	if got := sender.take(); len(got) != 1 {
		t.Fatalf("pushes = %d", len(got))
	}
	if toks, _ := devices.TokensForUser("bob"); len(toks) != 0 {
		t.Fatalf("invalid token kept: %v", toks)
	}
}

func TestMentionPushPreviewIsTruncated(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	setActive(f.bob, false)
	long := "<@bob> "
	for i := 0; i < 50; i++ {
		long += "слово "
	}
	f.send(f.alice, f.text.ID, long)
	got := sender.take()
	if len(got) != 1 {
		t.Fatalf("pushes = %d", len(got))
	}
	preview := []rune(got[0].note.Body)[len([]rune("Alice: ")):]
	if len(preview) > pushPreviewRunes {
		t.Fatalf("preview has %d runes", len(preview))
	}
	if preview[len(preview)-1] != '…' {
		t.Fatalf("no ellipsis: %q", string(preview))
	}
}
