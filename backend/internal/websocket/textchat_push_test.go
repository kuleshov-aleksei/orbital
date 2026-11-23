package websocket

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"

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

func (d *fakeDevices) UserIDs() ([]string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []string
	for u, list := range d.tokens {
		if len(list) > 0 {
			out = append(out, u)
		}
	}
	sort.Strings(out)
	return out, nil
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
	// Custom emoji are dropped: a system notification can't show them.
	if n.Title != "#general" || n.Body != "Alice: hi @Bob look" || n.Tag != "mention:"+f.text.ID ||
		n.ChannelID != push.AndroidChannelID {
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

	// Never the sender: alice gets nothing, bob only the message push.
	f.send(f.alice, f.text.ID, "note to self <@alice>")
	got := sender.take()
	if len(got) != 1 || got[0].tokens[0] != "tok-bob" || got[0].note.Data["type"] != "text_message" {
		t.Fatalf("pushes = %+v", got)
	}
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
		long += "word "
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

// shortCooldown makes message push cooldowns end quickly.
func shortCooldown(f *textFixture, d time.Duration) {
	f.hub.textPushes = newPushThrottle(d)
}

// waitPushes collects pushes for d (cooldown flushes run on timers).
func waitPushes(s *fakeSender, d time.Duration) []sentPush {
	time.Sleep(d)
	return s.take()
}

func TestMessagePushCooldownSumsUp(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	shortCooldown(f, 100*time.Millisecond)
	setActive(f.bob, false)

	f.send(f.alice, f.text.ID, "hello")
	got := sender.take()
	if len(got) != 1 || got[0].tokens[0] != "tok-bob" {
		t.Fatalf("pushes = %+v", got)
	}
	n := got[0].note
	if n.Title != "#general" || n.Body != "Alice: hello" || n.Tag != f.text.ID ||
		n.ChannelID != push.MessagesChannelID || n.Data["type"] != "text_message" {
		t.Fatalf("preview = %+v", n)
	}

	for _, text := range []string{"one", "two", "three"} {
		f.send(f.alice, f.text.ID, text)
	}
	if got := sender.take(); len(got) != 0 {
		t.Fatalf("pushed during the cooldown: %+v", got)
	}
	got = waitPushes(sender, 300*time.Millisecond)
	if len(got) != 1 {
		t.Fatalf("summary pushes = %+v", got)
	}
	if n := got[0].note; n.Body != "4 new messages from Alice" || n.Tag != f.text.ID || n.Data["room_id"] != f.text.ID ||
		n.ChannelID != push.MessagesChannelID {
		t.Fatalf("summary = %+v", n)
	}
	// A quiet cooldown sends nothing more.
	if got := waitPushes(sender, 300*time.Millisecond); len(got) != 0 {
		t.Fatalf("pushes after a quiet cooldown: %+v", got)
	}
}

func TestMessagePushSummarySkippedAfterRead(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	shortCooldown(f, 100*time.Millisecond)
	setActive(f.bob, false)

	f.send(f.alice, f.text.ID, "hello")
	f.send(f.alice, f.text.ID, "again")
	if got := sender.take(); len(got) != 1 {
		t.Fatalf("pushes = %+v", got)
	}
	f.bob.handleTextChannelRead(map[string]any{"room_id": f.text.ID, "seq": f.store.NewestSeq(f.text.ID)})
	if got := waitPushes(sender, 300*time.Millisecond); len(got) != 0 {
		t.Fatalf("summary after read: %+v", got)
	}
	// The next message starts over with a preview.
	f.send(f.alice, f.text.ID, "new")
	if got := sender.take(); len(got) != 1 || got[0].note.Body != "Alice: new" {
		t.Fatalf("pushes = %+v", got)
	}
}

func TestMessagePushSummarySkippedWhenActive(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	shortCooldown(f, 100*time.Millisecond)
	setActive(f.bob, false)

	f.send(f.alice, f.text.ID, "hello")
	f.send(f.alice, f.text.ID, "again")
	sender.take()
	setActive(f.bob, true)
	if got := waitPushes(sender, 300*time.Millisecond); len(got) != 0 {
		t.Fatalf("summary to an active user: %+v", got)
	}
}

func TestMentionPushBypassesCooldown(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	shortCooldown(f, time.Hour)
	setActive(f.bob, false)

	f.send(f.alice, f.text.ID, "hello")
	f.send(f.alice, f.text.ID, "look <@bob>")
	got := sender.take()
	if len(got) != 2 {
		t.Fatalf("pushes = %+v", got)
	}
	if n := got[1].note; n.Tag != "mention:"+f.text.ID || n.Data["type"] != "text_mention" {
		t.Fatalf("mention push = %+v", n)
	}
}

func TestMessagePushNotifyModes(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	setActive(f.bob, false)

	// no_mentions: a mention arrives as an ordinary message push.
	if err := f.notify().Set("bob", f.text.ID, chatstore.NotifySetting{Mode: chatstore.NotifyNoMentions}); err != nil {
		t.Fatal(err)
	}
	f.send(f.alice, f.text.ID, "<@bob> hi")
	got := sender.take()
	if len(got) != 1 || got[0].note.Data["type"] != "text_message" || got[0].note.ChannelID != push.MessagesChannelID {
		t.Fatalf("pushes = %+v", got)
	}

	// muted: nothing, mention or not.
	f.hub.textPushes.reset(pushKey{userID: "bob", roomID: f.text.ID})
	if err := f.notify().Set("bob", f.text.ID, chatstore.NotifySetting{Mode: chatstore.NotifyMuted}); err != nil {
		t.Fatal(err)
	}
	f.send(f.alice, f.text.ID, "plain")
	f.send(f.alice, f.text.ID, "<@bob> hi")
	if got := sender.take(); len(got) != 0 {
		t.Fatalf("pushed to a muted channel: %+v", got)
	}
}

func TestMessagePushEmojiOnly(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	setActive(f.bob, false)
	f.send(f.alice, f.text.ID, "<:party:0b6c1f2e-9d4a-4c1b-8f3e-2a1d5c6b7e8f>")
	got := sender.take()
	if len(got) != 1 || got[0].note.Body != "Alice: sent an emoji" {
		t.Fatalf("pushes = %+v", got)
	}
}

func TestSummaryBodyNamesSenders(t *testing.T) {
	cases := []struct {
		names []string
		want  string
	}{
		{nil, "5 new messages"},
		{[]string{"Alice"}, "5 new messages from Alice"},
		{[]string{"Alice", "Bob"}, "5 new messages from Alice and Bob"},
		{[]string{"Alice", "Bob", "Carol"}, "5 new messages from Alice, Bob and Carol"},
		{[]string{"Alice", "Bob", "Carol", "Dave"}, "5 new messages from Alice, Bob and 2 others"},
	}
	for _, c := range cases {
		if got := summaryBody(5, c.names); got != c.want {
			t.Errorf("summaryBody(%v) = %q, want %q", c.names, got, c.want)
		}
	}
}

func TestMessagePushSummaryListsEverySender(t *testing.T) {
	f := newTextFixture(t)
	sender, devices := withPush(f)
	shortCooldown(f, 100*time.Millisecond)
	// carol only receives; alice and bob both write.
	devices.tokens["carol"] = []string{"tok-carol"}
	tc := f.hub.textChatService()
	tc.UserName = func(id string) string {
		return map[string]string{"alice": "Alice", "bob": "Bob", "carol": "Carol"}[id]
	}
	carol := f.connect("carol")
	setActive(carol, false)
	setActive(f.alice, true)
	setActive(f.bob, true)

	f.send(f.alice, f.text.ID, "hi")
	f.send(f.bob, f.text.ID, "hey")
	f.send(f.alice, f.text.ID, "again")
	if got := sender.take(); len(got) != 1 || got[0].note.Body != "Alice: hi" {
		t.Fatalf("pushes = %+v", got)
	}
	got := waitPushes(sender, 300*time.Millisecond)
	if len(got) != 1 || got[0].note.Body != "3 new messages from Alice and Bob" {
		t.Fatalf("summary = %+v", got)
	}
}
