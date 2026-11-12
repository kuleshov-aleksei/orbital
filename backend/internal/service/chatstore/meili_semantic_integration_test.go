//go:build integration

package chatstore

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sort"
	"testing"
	"time"
)

// Image search by meaning against a real Meilisearch, with hand-made
// vectors (no ML service needed): the userProvided embedder, the federated
// keyword + vector query, the score threshold and de-duplication.
func TestMeiliImageSearchIntegration(t *testing.T) {
	url := os.Getenv("MEILI_TEST_URL")
	if url == "" {
		t.Skip("MEILI_TEST_URL not set")
	}
	index := fmt.Sprintf("text_messages_test_sem_%d", time.Now().UnixNano())
	eng := NewMeili(url, os.Getenv("MEILI_TEST_KEY"), index)
	ctx := context.Background()
	t.Cleanup(func() {
		var task taskRef
		if err := eng.do(ctx, http.MethodDelete, eng.indexPath(""), nil, &task); err == nil {
			_ = eng.waitTask(ctx, task.TaskUID)
		}
	})
	s := New(eng, Options{CallTimeout: 10 * time.Second})
	if err := s.Bootstrap(ctx, []string{semRoom}); err != nil {
		t.Fatal(err)
	}

	// A document from before this feature: no _vectors at all. Creating the
	// embedder must not fail on it.
	var task taskRef
	legacy := map[string]any{"id": "1762770000000000", "seq": 1762770000000000, "room_id": semRoom,
		"sender_id": semSender, "content": "старое", "content_search": "старое", "is_deleted": false}
	if err := eng.do(ctx, http.MethodPost, eng.indexPath("/documents"), []any{legacy}, &task); err != nil {
		t.Fatal(err)
	}
	if err := eng.waitTask(ctx, task.TaskUID); err != nil {
		t.Fatal(err)
	}

	text := mustCreate(t, s, semRoom, semSender, "отчёт за ноябрь, кот тут ни при чём")
	cat := imageMessage(t, s, "мой")
	car := imageMessage(t, s, "")
	receipt := imageMessage(t, s, "")
	cases := []struct {
		m    *Message
		text string
		vec  []float32
	}{
		{cat, "", []float32{1, 0, 0}},
		{car, "", []float32{0, 1, 0}},
		{receipt, "ИТОГО 1250 руб", []float32{0.1, 0.1, 1}},
	}
	for _, c := range cases {
		if err := s.SetAttachmentContent(ctx, c.m.ID, c.text, [][]float32{c.vec}, true); err != nil {
			t.Fatal(err)
		}
	}
	waitFlushed(t, s)

	queries := map[string][]float32{"кот": {1, 0, 0}, "итого": {0, 0, -1}, "банан": {-1, -1, 0}}
	s.SetQueryEmbedder(func(_ context.Context, q string) ([]float32, error) { return queries[q], nil }, 0.6)

	ids := func(q string) []string {
		t.Helper()
		res, err := s.Search(ctx, SearchRequest{Text: q, RoomIDs: []string{semRoom}})
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		var out []string
		for _, h := range res.Hits {
			out = append(out, h.Message.ID)
		}
		return out
	}
	name := map[string]string{text.ID: "text", cat.ID: "cat", car.ID: "car", receipt.ID: "receipt"}
	names := func(ids []string) string {
		var out []string
		for _, id := range ids {
			out = append(out, name[id])
		}
		sort.Strings(out) // merged by score; order is not asserted
		return fmt.Sprint(out)
	}

	// The keyword hit and the close image; the unrelated car (cosine 0) is
	// cut by the threshold.
	if got := names(ids("кот")); got != "[cat text]" {
		t.Fatalf("кот = %s, want [cat text]", got)
	}
	// OCR text is searchable by keyword; the opposite vector finds nothing.
	if got := names(ids("итого")); got != "[receipt]" {
		t.Fatalf("итого = %s, want [receipt]", got)
	}
	if got := names(ids("банан")); got != "[]" {
		t.Fatalf("банан = %s, want []", got)
	}

	// A query that finds the same message by keyword and by vector lists it once.
	queries["итого"] = []float32{0.1, 0.1, 1}
	if got := names(ids("итого")); got != "[receipt]" {
		t.Fatalf("итого (both queries) = %s, want [receipt] once", got)
	}

	// Editing the text keeps the vectors.
	if _, err := s.Edit(ctx, cat.ID, semSender, "мой питомец"); err != nil {
		t.Fatal(err)
	}
	waitFlushed(t, s)
	if got := names(ids("кот")); got != "[cat text]" {
		t.Fatalf("кот after edit = %s, want [cat text]", got)
	}
	if res, err := s.Search(ctx, SearchRequest{Text: "старое", RoomIDs: []string{semRoom}}); err != nil || len(res.Hits) != 1 {
		t.Fatalf("legacy message search = %v, %v", res, err)
	}

	// Clearing the vectors removes the image from vector search.
	if err := s.SetAttachmentContent(ctx, cat.ID, "", nil, true); err != nil {
		t.Fatal(err)
	}
	waitFlushed(t, s)
	if got := names(ids("кот")); got != "[text]" {
		t.Fatalf("кот after clearing = %s, want [text]", got)
	}

	// A model with another size replaces the embedder.
	if err := s.SetAttachmentContent(ctx, car.ID, "", [][]float32{{1, 0, 0, 0}}, true); err != nil {
		t.Fatal(err)
	}
	if dims, err := eng.ImageEmbedderDims(ctx); err != nil || dims != 4 {
		t.Fatalf("embedder dims = %d (%v), want 4", dims, err)
	}
}
