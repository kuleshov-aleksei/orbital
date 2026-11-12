//go:build integration

package chatmedia

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// TestIntegrationS3Store runs against the dev Garage (make garage-up) with
// GARAGE_DEFAULT_ACCESS_KEY/SECRET_KEY from .env.
func TestIntegrationS3Store(t *testing.T) {
	access, secret := os.Getenv("GARAGE_DEFAULT_ACCESS_KEY"), os.Getenv("GARAGE_DEFAULT_SECRET_KEY")
	if access == "" || secret == "" {
		t.Skip("GARAGE_DEFAULT_ACCESS_KEY/SECRET_KEY not set")
	}
	bucket := os.Getenv("GARAGE_DEFAULT_BUCKET")
	if bucket == "" {
		bucket = "orbital-chat-media"
	}
	store, err := NewS3Store(S3Config{
		Endpoint: "http://127.0.0.1:3900", Bucket: bucket, Region: "garage", AccessKey: access, SecretKey: secret,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key := "integration/" + newID() + "/original.mp3"
	body := []byte("ID3 integration test")
	if err := store.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "audio/mpeg"); err != nil {
		t.Fatalf("put: %v", err)
	}
	for _, disposition := range []string{"", "attachment; filename*=UTF-8''clip.mp3"} {
		u, err := store.PresignGet(ctx, key, time.Minute, disposition)
		if err != nil {
			t.Fatalf("presign: %v", err)
		}
		resp, err := http.Get(u)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		got, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || !bytes.Equal(got, body) {
			t.Fatalf("presigned get = %d %q", resp.StatusCode, got)
		}
		if disposition != "" && !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment") {
			t.Fatalf("Content-Disposition = %q", resp.Header.Get("Content-Disposition"))
		}
	}
	if err := store.Delete(ctx, []string{key, key}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	u, _ := store.PresignGet(ctx, key, time.Minute, "")
	if resp, err := http.Get(u); err == nil {
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("after delete: %d, want 404", resp.StatusCode)
		}
	}
}
