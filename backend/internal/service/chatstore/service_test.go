package chatstore

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

type fixedClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fixedClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fixedClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newTestService(t *testing.T) (*Service, *MemoryEngine, *fixedClock) {
	t.Helper()
	eng := NewMemoryEngine()
	clock := &fixedClock{t: time.UnixMilli(1_762_770_000_000)}
	s := New(eng, Options{Now: clock.Now})
	if err := s.Bootstrap(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	return s, eng, clock
}

func mustCreate(t *testing.T, s *Service, room, sender, content string) *Message {
	t.Helper()
	m, err := s.Create(context.Background(), CreateInput{RoomID: room, SenderID: sender, Content: content})
	if err != nil {
		t.Fatalf("create %q: %v", content, err)
	}
	return m
}

func contents(p *Page) []string {
	out := make([]string, len(p.Messages))
	for i, m := range p.Messages {
		out[i] = m.Content
	}
	return out
}

func TestSeqIsMonotonicWithinOneMillisecond(t *testing.T) {
	s, _, clock := newTestService(t)
	var last int64
	for i := 0; i < 50; i++ {
		m := mustCreate(t, s, "r", "u", fmt.Sprint(i))
		if m.Seq <= last {
			t.Fatalf("seq %d not after %d", m.Seq, last)
		}
		if m.ID != fmt.Sprint(m.Seq) {
			t.Fatalf("id %q != seq %d", m.ID, m.Seq)
		}
		last = m.Seq
	}
	// A clock step backwards must not reuse or reorder seqs.
	clock.Advance(-time.Hour)
	if m := mustCreate(t, s, "r", "u", "late"); m.Seq <= last {
		t.Fatalf("seq went backwards after a clock step: %d <= %d", m.Seq, last)
	}
}

func TestSeqResumesFromStoredMaximum(t *testing.T) {
	eng := NewMemoryEngine()
	future := &Message{ID: "9000000000000000", Seq: 9_000_000_000_000_000, RoomID: "r", SenderID: "u", Content: "x"}
	if _, err := eng.Add(context.Background(), future); err != nil {
		t.Fatal(err)
	}
	s := New(eng, Options{})
	if err := s.Bootstrap(context.Background(), []string{"r"}); err != nil {
		t.Fatal(err)
	}
	if got := s.NewestSeq("r"); got != future.Seq {
		t.Fatalf("newest seq not preloaded: %d", got)
	}
	if m := mustCreate(t, s, "r", "u", "next"); m.Seq != future.Seq+1 {
		t.Fatalf("seq = %d, want %d", m.Seq, future.Seq+1)
	}
}

func TestUnavailableBeforeBootstrap(t *testing.T) {
	s := New(NewMemoryEngine(), Options{})
	if _, err := s.Create(context.Background(), CreateInput{RoomID: "r", SenderID: "u", Content: "hi"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestContentValidation(t *testing.T) {
	s, _, _ := newTestService(t)
	for _, content := range []string{"", "   \n "} {
		if _, err := s.Create(context.Background(), CreateInput{RoomID: "r", SenderID: "u", Content: content}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("content %q: err = %v", content, err)
		}
	}
	// 2000 multi-byte characters are allowed (runes, not bytes).
	long := make([]rune, MaxContentRunes)
	for i := range long {
		long[i] = 'ж'
	}
	if _, err := s.Create(context.Background(), CreateInput{RoomID: "r", SenderID: "u", Content: string(long)}); err != nil {
		t.Fatalf("2000 runes rejected: %v", err)
	}
	if _, err := s.Create(context.Background(), CreateInput{RoomID: "r", SenderID: "u", Content: string(long) + "x"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("2001 runes accepted: %v", err)
	}
}

func TestSearchText(t *testing.T) {
	got := SearchText("hi <:party_parrot:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d> <@user1> **bold**")
	want := "hi :party_parrot:   **bold**"
	if got != want {
		t.Fatalf("SearchText = %q, want %q", got, want)
	}
}

func TestHistoryPaging(t *testing.T) {
	s, _, _ := newTestService(t)
	for i := 0; i < 7; i++ {
		mustCreate(t, s, "r", "u", fmt.Sprint(i))
	}
	mustCreate(t, s, "other", "u", "elsewhere")
	ctx := context.Background()

	newest, err := s.History(ctx, HistoryQuery{RoomID: "r", Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(contents(newest)); got != "[4 5 6]" || !newest.HasMoreBefore || newest.HasMoreAfter {
		t.Fatalf("newest page = %s before=%v after=%v", got, newest.HasMoreBefore, newest.HasMoreAfter)
	}
	older, err := s.History(ctx, HistoryQuery{RoomID: "r", BeforeSeq: newest.Messages[0].Seq, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(contents(older)); got != "[1 2 3]" || !older.HasMoreBefore || !older.HasMoreAfter {
		t.Fatalf("older page = %s before=%v after=%v", got, older.HasMoreBefore, older.HasMoreAfter)
	}
	oldest, err := s.History(ctx, HistoryQuery{RoomID: "r", BeforeSeq: older.Messages[0].Seq, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(contents(oldest)); got != "[0]" || oldest.HasMoreBefore {
		t.Fatalf("oldest page = %s before=%v", got, oldest.HasMoreBefore)
	}
	after, err := s.History(ctx, HistoryQuery{RoomID: "r", AfterSeq: oldest.Messages[0].Seq, Limit: 4})
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(contents(after)); got != "[1 2 3 4]" || !after.HasMoreAfter {
		t.Fatalf("after page = %s after=%v", got, after.HasMoreAfter)
	}
	around, err := s.History(ctx, HistoryQuery{RoomID: "r", AroundSeq: older.Messages[1].Seq, Limit: 4})
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(contents(around)); got != "[1 2 3 4]" || !around.HasMoreBefore || !around.HasMoreAfter {
		t.Fatalf("around page = %s before=%v after=%v", got, around.HasMoreBefore, around.HasMoreAfter)
	}
}

func TestOverlayServesUnappliedWrites(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	kept := mustCreate(t, s, "r", "u", "kept")
	eng.Hold() // Meilisearch accepts tasks but has not applied them yet

	added := mustCreate(t, s, "r", "u", "pending")
	if _, err := s.Edit(ctx, kept.ID, "u", "kept (edited)"); err != nil {
		t.Fatal(err)
	}
	gone := mustCreate(t, s, "r", "u", "deleted soon")
	if _, err := s.Delete(ctx, gone.ID, "u", nil); err != nil {
		t.Fatal(err)
	}

	check := func(stage string) {
		page, err := s.History(ctx, HistoryQuery{RoomID: "r"})
		if err != nil {
			t.Fatal(err)
		}
		if got := fmt.Sprint(contents(page)); got != "[kept (edited) pending]" {
			t.Fatalf("%s: history = %s", stage, got)
		}
		if page.Messages[0].EditedAtTS == nil {
			t.Fatalf("%s: edited_at_ts missing", stage)
		}
	}
	check("while held")
	if _, err := s.Get(ctx, added.ID); err != nil {
		t.Fatalf("pending message not readable: %v", err)
	}
	if _, err := s.Get(ctx, gone.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pending delete still readable: %v", err)
	}

	s.Flush(ctx) // tasks still enqueued: nothing confirmed
	if s.PendingCount() == 0 {
		t.Fatal("overlay emptied before tasks finished")
	}
	eng.Release()
	s.Flush(ctx)
	if n := s.PendingCount(); n != 0 {
		t.Fatalf("overlay still has %d entries", n)
	}
	check("after apply")
}

func TestFailedCreateIsReverted(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	var reverts []Revert
	s.SetRevertHandler(func(rv Revert) { reverts = append(reverts, rv) })

	mustCreate(t, s, "r", "u", "ok")
	eng.FailNext()
	lost := mustCreate(t, s, "r", "u", "lost")
	if s.NewestSeq("r") != lost.Seq {
		t.Fatal("newest seq not bumped on create")
	}
	s.Flush(ctx)

	if len(reverts) != 1 || reverts[0].ID != lost.ID || reverts[0].Message != nil || reverts[0].SenderID != "u" {
		t.Fatalf("reverts = %+v", reverts)
	}
	page, _ := s.History(ctx, HistoryQuery{RoomID: "r"})
	if got := fmt.Sprint(contents(page)); got != "[ok]" {
		t.Fatalf("history after revert = %s", got)
	}
	if s.NewestSeq("r") == lost.Seq {
		t.Fatal("newest seq still points at the lost message")
	}
}

func TestFailedEditIsReverted(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	var reverts []Revert
	s.SetRevertHandler(func(rv Revert) { reverts = append(reverts, rv) })

	m := mustCreate(t, s, "r", "u", "original")
	eng.FailNext()
	if _, err := s.Edit(ctx, m.ID, "u", "changed"); err != nil {
		t.Fatal(err)
	}
	s.Flush(ctx)
	if len(reverts) != 1 || reverts[0].Message == nil || reverts[0].Message.Content != "original" {
		t.Fatalf("reverts = %+v", reverts)
	}
	got, err := s.Get(ctx, m.ID)
	if err != nil || got.Content != "original" {
		t.Fatalf("message after revert = %+v, %v", got, err)
	}
}

func TestEditAndDeletePermissions(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, "r", "author", "hello")

	if _, err := s.Edit(ctx, m.ID, "other", "hijack"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("edit by other: %v", err)
	}
	if _, err := s.Delete(ctx, m.ID, "other", func(string) bool { return false }); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delete by other without manage_messages: %v", err)
	}
	var askedRoom string
	if _, err := s.Delete(ctx, m.ID, "mod", func(room string) bool { askedRoom = room; return true }); err != nil {
		t.Fatalf("delete by moderator: %v", err)
	}
	if askedRoom != "r" {
		t.Fatalf("manage check asked for room %q", askedRoom)
	}
	if _, err := s.Edit(ctx, m.ID, "author", "edit after delete"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("edit of deleted message: %v", err)
	}
	if _, err := s.Delete(ctx, m.ID, "author", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

func TestDeleteKeepsDocumentAndUpdatesNewest(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	first := mustCreate(t, s, "r", "u", "first")
	last := mustCreate(t, s, "r", "u", "last")
	if _, err := s.Delete(ctx, last.ID, "u", nil); err != nil {
		t.Fatal(err)
	}
	if got := s.NewestSeq("r"); got != first.Seq {
		t.Fatalf("newest = %d, want %d", got, first.Seq)
	}
	s.Flush(ctx)
	doc, _ := eng.Get(ctx, last.ID)
	if doc == nil || !doc.IsDeleted || doc.DeletedBy == nil || *doc.DeletedBy != "u" || doc.Content != "last" {
		t.Fatalf("soft delete did not keep the document: %+v", doc)
	}
}

func TestReplies(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	parent := mustCreate(t, s, "r", "alice", "question")
	foreign := mustCreate(t, s, "other", "alice", "elsewhere")

	if _, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "bob", Content: "x", ReplyToID: foreign.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-channel reply: %v", err)
	}
	if _, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "bob", Content: "x", ReplyToID: "missing"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("reply to missing: %v", err)
	}
	reply, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "bob", Content: "answer", ReplyToID: parent.ID, ReplyPing: true})
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(reply.MentionUserIDs) != "[alice]" {
		t.Fatalf("reply ping mentions = %v", reply.MentionUserIDs)
	}
	self, _ := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "alice", Content: "me too", ReplyToID: parent.ID, ReplyPing: true})
	if len(self.MentionUserIDs) != 0 {
		t.Fatalf("self reply pings: %v", self.MentionUserIDs)
	}

	page, _ := s.History(ctx, HistoryQuery{RoomID: "r"})
	if p, ok := page.Replied[parent.ID]; !ok || p.Content != "question" {
		t.Fatalf("replied previews = %+v", page.Replied)
	}
	if _, err := s.Delete(ctx, parent.ID, "alice", nil); err != nil {
		t.Fatal(err)
	}
	page, _ = s.History(ctx, HistoryQuery{RoomID: "r"})
	if _, ok := page.Replied[parent.ID]; ok {
		t.Fatal("deleted parent still previewed")
	}
}

// Concurrent mutations of one message must serialize (run with -race).
func TestConcurrentMutations(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, "r", "u", "v0")
	eng.Hold()
	var wg sync.WaitGroup
	for i := 1; i <= 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = s.Edit(ctx, m.ID, "u", fmt.Sprint("v", i))
		}(i)
	}
	wg.Wait()
	pending, _ := s.Get(ctx, m.ID)
	eng.Release()
	s.Flush(ctx)
	stored, _ := eng.Get(ctx, m.ID)
	if stored.Content != pending.Content {
		t.Fatalf("stored %q, overlay showed %q", stored.Content, pending.Content)
	}
}

func TestDeleteRoom(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	mustCreate(t, s, "r", "u", "a")
	mustCreate(t, s, "keep", "u", "b")
	if err := s.DeleteRoom(ctx, "r"); err != nil {
		t.Fatal(err)
	}
	if s.NewestSeq("r") != 0 {
		t.Fatal("newest seq kept for deleted room")
	}
	page, _ := s.History(ctx, HistoryQuery{RoomID: "r"})
	if len(page.Messages) != 0 {
		t.Fatalf("messages left: %v", contents(page))
	}
	page, _ = s.History(ctx, HistoryQuery{RoomID: "keep"})
	if len(page.Messages) != 1 {
		t.Fatal("other room affected")
	}
}

func TestEngineDownMapsToUnavailable(t *testing.T) {
	s, eng, _ := newTestService(t)
	eng.SetDown(true)
	if _, err := s.History(context.Background(), HistoryQuery{RoomID: "r"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("history: %v", err)
	}
	if _, err := s.Create(context.Background(), CreateInput{RoomID: "r", SenderID: "u", Content: "x"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("create: %v", err)
	}
}
