//go:build integration

package chatstore

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// Integration test against a real Meilisearch: `make test-integration`.
// Behind the `integration` build tag so `go test ./...` (make test-backend,
// PR CI) stays hermetic. It uses its own throwaway index, never the dev data.
func TestMeiliEngineIntegration(t *testing.T) {
	url := os.Getenv("MEILI_TEST_URL")
	if url == "" {
		t.Skip("MEILI_TEST_URL not set")
	}
	index := fmt.Sprintf("text_messages_test_%d", time.Now().UnixNano())
	eng := NewMeili(url, os.Getenv("MEILI_TEST_KEY"), index)
	ctx := context.Background()
	t.Cleanup(func() {
		var task taskRef
		if err := eng.do(ctx, http.MethodDelete, eng.indexPath(""), nil, &task); err == nil {
			_ = eng.waitTask(ctx, task.TaskUID)
		}
	})

	s := New(eng, Options{})
	if err := s.Bootstrap(ctx, []string{"r"}); err != nil {
		t.Fatal(err)
	}
	// Bootstrapping again must be a no-op (index already exists).
	if err := s.Bootstrap(ctx, []string{"r"}); err != nil {
		t.Fatalf("second bootstrap: %v", err)
	}

	parent, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "alice", Content: "привет **мир** <:wave:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d>"})
	if err != nil {
		t.Fatal(err)
	}
	reply, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "bob", Content: "reply", ReplyToID: parent.ID, ReplyPing: true})
	if err != nil {
		t.Fatal(err)
	}
	doomed, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "bob", Content: "oops"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Edit(ctx, reply.ID, "bob", "reply (edited)"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Delete(ctx, doomed.ID, "bob", nil); err != nil {
		t.Fatal(err)
	}

	// Read-your-writes before Meilisearch applied anything.
	page, err := s.History(ctx, HistoryQuery{RoomID: "r"})
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(contents(page)); got != "[привет **мир** <:wave:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d> reply (edited)]" {
		t.Fatalf("history via overlay = %s", got)
	}

	waitFlushed(t, s)

	page, err = s.History(ctx, HistoryQuery{RoomID: "r"})
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(contents(page)); got != "[привет **мир** <:wave:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d> reply (edited)]" {
		t.Fatalf("history from index = %s", got)
	}
	if p, ok := page.Replied[parent.ID]; !ok || p.SenderID != "alice" {
		t.Fatalf("replied = %+v", page.Replied)
	}
	if m := page.Messages[1]; m.EditedAtTS == nil || fmt.Sprint(m.MentionUserIDs) != "[alice]" {
		t.Fatalf("edited reply = %+v", m)
	}
	stored, err := eng.Get(ctx, doomed.ID)
	if err != nil || stored == nil || !stored.IsDeleted {
		t.Fatalf("soft-deleted doc = %+v, %v", stored, err)
	}
	if stored.ContentSearch != "oops" {
		t.Fatalf("content_search = %q", stored.ContentSearch)
	}
	newest, err := eng.NewestSeqs(ctx, []string{"r", "empty"})
	if err != nil || newest["r"] != reply.Seq || newest["empty"] != 0 {
		t.Fatalf("newest seqs = %v, %v", newest, err)
	}
	maxSeq, err := eng.MaxSeq(ctx)
	if err != nil || maxSeq != doomed.Seq {
		t.Fatalf("max seq = %d (want %d), %v", maxSeq, doomed.Seq, err)
	}
	around, err := s.History(ctx, HistoryQuery{RoomID: "r", AroundSeq: parent.Seq, Limit: 10})
	if err != nil || len(around.Messages) != 2 {
		t.Fatalf("around = %+v, %v", around, err)
	}

	// Phase 2: reactions, pins, search, mention counts against real filters.
	if _, err := s.ToggleReaction(ctx, parent.ID, "bob", "👍"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SetPinned(ctx, parent.ID, "mod", true); err != nil {
		t.Fatal(err)
	}
	mention, err := s.Create(ctx, CreateInput{RoomID: "r", SenderID: "bob", Content: "hey <@alice> and <@&mods> look at the квитанция"})
	if err != nil {
		t.Fatal(err)
	}
	waitFlushed(t, s)
	pins, err := s.Pins(ctx, "r")
	if err != nil || len(pins) != 1 || pins[0].ID != parent.ID || len(pins[0].Reactions) != 1 {
		t.Fatalf("pins = %+v, %v", pins, err)
	}
	res, err := s.Search(ctx, SearchRequest{Text: "квитанци", RoomIDs: []string{"r", "other"}})
	if err != nil || len(res.Hits) != 1 || res.Hits[0].Message.ID != mention.ID {
		t.Fatalf("prefix search = %+v, %v", res, err)
	}
	if !strings.Contains(res.Hits[0].Snippet, HighlightPre) {
		t.Fatalf("snippet without highlight: %q", res.Hits[0].Snippet)
	}
	res, err = s.Search(ctx, SearchRequest{Text: "квитонция", RoomIDs: []string{"r"}})
	if err != nil || len(res.Hits) != 1 {
		t.Fatalf("typo search = %+v, %v", res, err)
	}
	res, err = s.Search(ctx, SearchRequest{RoomIDs: []string{"r"}, SenderIDs: []string{"alice"}, Pinned: boolPtr(true)})
	if err != nil || len(res.Hits) != 1 || res.Hits[0].Message.ID != parent.ID || res.Hits[0].Snippet != "" {
		t.Fatalf("filter-only search = %+v, %v", res, err)
	}
	res, err = s.Search(ctx, SearchRequest{Text: "oops", RoomIDs: []string{"r"}})
	if err != nil || len(res.Hits) != 0 {
		t.Fatalf("deleted message found: %+v, %v", res, err)
	}
	res, err = s.Search(ctx, SearchRequest{Text: "квитанция", RoomIDs: []string{"other"}})
	if err != nil || len(res.Hits) != 0 {
		t.Fatalf("room filter leaked: %+v, %v", res, err)
	}
	counts, err := s.MentionCounts(ctx, []MentionCountQuery{
		{RoomID: "r", UserID: "alice"},                                 // reply ping + direct
		{RoomID: "r", AfterSeq: reply.Seq, UserID: "alice"},            // direct only
		{RoomID: "r", UserID: "carol", RoleIDs: []string{"mods", "x"}}, // via role
		{RoomID: "r", UserID: "bob", RoleIDs: []string{"mods"}},        // own messages excluded
	})
	if err != nil || fmt.Sprint(counts) != "[2 1 1 0]" {
		t.Fatalf("mention counts = %v, %v", counts, err)
	}

	if err := s.DeleteRoom(ctx, "r"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		page, err = s.History(ctx, HistoryQuery{RoomID: "r"})
		if err == nil && len(page.Messages) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("room not emptied: %v %v", page, err)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func waitFlushed(t *testing.T, s *Service) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for s.PendingCount() > 0 {
		if time.Now().After(deadline) {
			t.Fatal("tasks did not finish")
		}
		time.Sleep(50 * time.Millisecond)
		s.Flush(context.Background())
	}
}

func boolPtr(b bool) *bool { return &b }
