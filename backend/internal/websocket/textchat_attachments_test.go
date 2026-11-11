package websocket

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func withMedia(t *testing.T, f *textFixture) *chatmedia.Service {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	media := chatmedia.New(db, chatmedia.NewMemoryStore(), chatmedia.Limits{
		MaxImageBytes: 1 << 20, MaxAudioBytes: 1 << 20, MaxVideoBytes: 1 << 20, QuotaBytes: 1 << 20,
	})
	tc := f.hub.textChatService()
	tc.Media = media
	f.hub.SetTextChat(tc)
	return media
}

func uploadFor(t *testing.T, media *chatmedia.Service, user, roomID string) string {
	t.Helper()
	data := append([]byte("ID3"), make([]byte, 64)...)
	res, err := media.Upload(context.Background(), chatmedia.UploadInput{
		RoomID: roomID, UploaderID: user, Filename: "a.mp3", File: bytes.NewReader(data), Size: int64(len(data)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Record.ID
}

func TestTextSendWithAttachments(t *testing.T) {
	f := newTextFixture(t)
	media := withMedia(t, f)
	id := uploadFor(t, media, "alice", f.text.ID)

	f.alice.handleTextMessageSend(map[string]interface{}{"room_id": f.text.ID, "content": "", "upload_ids": []string{id}, "nonce": "n1"})
	got := messagesOfType(t, f.bob, "text_message_new")
	if len(got) != 1 {
		t.Fatalf("message with only an attachment not broadcast")
	}
	msg := got[0].Data.(map[string]interface{})["message"].(map[string]interface{})
	atts := msg["attachments"].([]interface{})
	if len(atts) != 1 || atts[0].(map[string]interface{})["id"] != id {
		t.Fatalf("attachments = %v", atts)
	}
	rec, _ := media.Get(id)
	if rec.Status != chatmedia.StatusAttached || rec.MessageID != msg["id"] {
		t.Fatalf("record = %+v", rec)
	}

	// The same upload cannot be sent twice.
	drain(f.alice)
	f.alice.handleTextMessageSend(map[string]interface{}{"room_id": f.text.ID, "content": "again", "upload_ids": []string{id}, "nonce": "n2"})
	if code := errorCode(t, f.alice); code != textErrInvalid {
		t.Fatalf("resend: code %q", code)
	}

	// Deleting the message removes its files.
	f.alice.handleTextMessageDelete(map[string]interface{}{"message_id": msg["id"]})
	if rec, _ := media.Get(id); rec.RemovedReason != chatmedia.ReasonMessageDeleted {
		t.Fatalf("after delete: %+v", rec)
	}
}

func TestTextSendAttachmentsDeniedPaths(t *testing.T) {
	f := newTextFixture(t)
	media := withMedia(t, f)
	// Someone else's upload.
	aliceUpload := uploadFor(t, media, "alice", f.text.ID)
	f.bob.handleTextMessageSend(map[string]interface{}{"room_id": f.text.ID, "content": "x", "upload_ids": []string{aliceUpload}, "nonce": "n1"})
	if code := errorCode(t, f.bob); code != textErrInvalid {
		t.Fatalf("foreign upload: code %q", code)
	}
	// Without AttachFiles.
	bobUpload := uploadFor(t, media, "bob", f.text.ID)
	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", 0, permissions.AttachFiles)
	f.bob.handleTextMessageSend(map[string]interface{}{"room_id": f.text.ID, "content": "x", "upload_ids": []string{bobUpload}, "nonce": "n2"})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("send without attach_files: code %q", code)
	}
	if rec, _ := media.Get(bobUpload); rec.Status != chatmedia.StatusPending {
		t.Fatalf("upload attached despite the denial: %+v", rec)
	}
}

func TestAttachmentRemovalUpdatesMessage(t *testing.T) {
	f := newTextFixture(t)
	media := withMedia(t, f)
	id := uploadFor(t, media, "alice", f.text.ID)
	f.alice.handleTextMessageSend(map[string]interface{}{"room_id": f.text.ID, "content": "pic", "upload_ids": []string{id}, "nonce": "n1"})
	drain(f.alice)
	drain(f.bob)
	rec, _ := media.Get(id)
	if _, err := media.Remove([]*chatmedia.Record{rec}, chatmedia.ReasonOwner); err != nil {
		t.Fatal(err)
	}
	// The hook runs asynchronously; wait for the broadcast.
	upd, ok := waitMessage(t, f.bob, "text_message_updated")
	if !ok {
		t.Fatal("no text_message_updated after removal")
	}
	atts := upd.Data.(map[string]interface{})["message"].(map[string]interface{})["attachments"].([]interface{})
	if atts[0].(map[string]interface{})["removed"] != chatmedia.ReasonOwner {
		t.Fatalf("attachment = %v", atts[0])
	}
}

// waitMessage waits up to 2 s for a message of one type.
func waitMessage(t *testing.T, c *Client, typ string) (models.WebSocketMessage, bool) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case raw := <-c.send:
			var msg models.WebSocketMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if msg.Type == typ {
				return msg, true
			}
		case <-deadline:
			return models.WebSocketMessage{}, false
		}
	}
}
