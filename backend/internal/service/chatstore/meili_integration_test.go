//go:build integration

package chatstore

import (
	"context"
	"fmt"
	"net/http"
	"os"
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

	deadline := time.Now().Add(10 * time.Second)
	for s.PendingCount() > 0 {
		if time.Now().After(deadline) {
			t.Fatal("tasks did not finish")
		}
		time.Sleep(50 * time.Millisecond)
		s.Flush(ctx)
	}

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

	if err := s.DeleteRoom(ctx, "r"); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(10 * time.Second)
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
