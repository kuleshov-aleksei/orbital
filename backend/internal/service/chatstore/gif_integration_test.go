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

// The GIF reference must survive the Meilisearch round trip: it is stored as
// a plain document field and read back with history, pins and search hits
// (docs/specs/CHAT_SYSTEM.md §7.17).
func TestMeiliGIFRoundTripIntegration(t *testing.T) {
	url := os.Getenv("MEILI_TEST_URL")
	if url == "" {
		t.Skip("MEILI_TEST_URL not set")
	}
	index := fmt.Sprintf("text_messages_gif_test_%d", time.Now().UnixNano())
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
	gif, err := NormalizeGIF(validGIF())
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.Create(ctx, CreateInput{
		RoomID: "r", SenderID: "qkUrdzLDoqslx8EEy2cM7Q==", GIF: gif,
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := s.Get(ctx, msg.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.GIF == nil || got.GIF.ID != klipyGIFRefID || got.GIF.URL != klipyGIFURL {
		t.Fatalf("GIF lost in Meilisearch: %+v", got.GIF)
	}
	if got.Content != "" {
		t.Fatalf("content = %q, want empty", got.Content)
	}
}
