package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

type mediaFixture struct {
	*textHandlerFixture
	media *chatmedia.Service
	objs  *chatmedia.MemoryStore
}

func newMediaFixture(t *testing.T) *mediaFixture {
	t.Helper()
	f := &mediaFixture{textHandlerFixture: newTextHandlerFixture(t), objs: chatmedia.NewMemoryStore()}
	f.media = chatmedia.New(f.db, f.objs, chatmedia.Limits{
		MaxImageBytes: 1 << 20, MaxAudioBytes: 1 << 20, MaxVideoBytes: 1 << 20, QuotaBytes: 10 << 20,
	})
	f.text.media = f.media
	f.room.SetTextChat(&websocket.TextChat{Store: f.store, ReadState: f.text.readState, Notify: f.notify, Media: f.media})
	// "mod" moderates the open text channel.
	if _, err := f.ps.SetOverwrite(f.ownerSub, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: f.openText.ID,
		SubjectType: models.OverwriteSubjectUser, SubjectID: "mod", Allow: uint64(permissions.ManageMessages)}); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *mediaFixture) uploadAs(t *testing.T, as string, room *models.Room) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("peaks", "[1,2,3]")
	_ = mw.WriteField("duration_ms", "2000")
	fw, _ := mw.CreateFormFile("file", "voice.mp3")
	_, _ = fw.Write(append([]byte("ID3"), make([]byte, 100)...))
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, f.claims[as]))
	req = mux.SetURLVars(req, map[string]string{"id": room.ID})
	rec := httptest.NewRecorder()
	f.text.UploadAttachment(rec, req)
	return rec
}

// sentFile uploads as "user" and attaches the file to a message.
func (f *mediaFixture) sentFile(t *testing.T) (*chatstore.Message, string) {
	t.Helper()
	rec := f.uploadAs(t, "user", f.openText)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	var msg *chatstore.Message
	err := f.media.Attach(context.Background(), "user", f.openText.ID, []string{resp.UploadID},
		func(atts []chatstore.Attachment) (string, error) {
			m, err := f.store.Create(context.Background(), chatstore.CreateInput{RoomID: f.openText.ID, SenderID: "user", Attachments: atts})
			msg = m
			if err != nil {
				return "", err
			}
			return m.ID, nil
		})
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	return msg, resp.UploadID
}

func TestUploadRequiresAttachFiles(t *testing.T) {
	f := newMediaFixture(t)
	if rec := f.uploadAs(t, "guest", f.openText); rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
		t.Fatalf("guest upload: %d, want 403/404", rec.Code)
	}
	if rec := f.uploadAs(t, "user", f.hiddenText); rec.Code != http.StatusNotFound {
		t.Fatalf("hidden channel upload: %d, want 404", rec.Code)
	}
	if _, err := f.ps.SetOverwrite(f.ownerSub, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: f.openText.ID,
		SubjectType: models.OverwriteSubjectUser, SubjectID: "user", Deny: uint64(permissions.AttachFiles)}); err != nil {
		t.Fatal(err)
	}
	if rec := f.uploadAs(t, "user", f.openText); rec.Code != http.StatusForbidden {
		t.Fatalf("upload without attach_files: %d, want 403", rec.Code)
	}
}

func TestProtectIsUploaderOnly(t *testing.T) {
	f := newMediaFixture(t)
	msg, id := f.sentFile(t)
	vars := map[string]string{"id": id}
	body := map[string]bool{"protected": true}
	if rec := f.do(t, "mod", f.text.UpdateAttachment, http.MethodPatch, vars, body); rec.Code != http.StatusForbidden {
		t.Fatalf("moderator protect: %d, want 403", rec.Code)
	}
	if rec := f.do(t, "user", f.text.UpdateAttachment, http.MethodPatch, vars, body); rec.Code != http.StatusOK {
		t.Fatalf("uploader protect: %d %s", rec.Code, rec.Body.String())
	}
	f.store.Flush(context.Background())
	if got, _ := f.store.Get(context.Background(), msg.ID); got == nil || len(got.Attachments) != 1 {
		t.Fatalf("message = %+v", got)
	}
}

func TestDeleteAttachmentPermissions(t *testing.T) {
	f := newMediaFixture(t)
	_, id := f.sentFile(t)
	vars := map[string]string{"id": id}
	if rec := f.do(t, "guest", f.text.DeleteAttachment, http.MethodDelete, vars, nil); rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
		t.Fatalf("guest delete: %d", rec.Code)
	}
	if rec := f.do(t, "mod", f.text.DeleteAttachment, http.MethodDelete, vars, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("moderator delete: %d %s", rec.Code, rec.Body.String())
	}
	rec, _ := f.media.Get(id)
	if rec.RemovedReason != chatmedia.ReasonModerator {
		t.Fatalf("reason = %q", rec.RemovedReason)
	}
	// Removed files are gone for everyone, the uploader included.
	if rec := f.do(t, "user", f.text.DeleteAttachment, http.MethodDelete, vars, nil); rec.Code != http.StatusGone {
		t.Fatalf("second delete: %d, want 410", rec.Code)
	}
	urls := f.do(t, "user", f.text.AttachmentURLs, http.MethodPost, nil,
		map[string]any{"items": []map[string]string{{"id": id, "variant": "original"}}})
	var resp struct {
		URLs map[string]any `json:"urls"`
		Gone []string       `json:"gone"`
	}
	_ = json.Unmarshal(urls.Body.Bytes(), &resp)
	if len(resp.URLs) != 0 || len(resp.Gone) != 1 {
		t.Fatalf("urls for a removed file = %s", urls.Body.String())
	}
}

func TestAttachmentURLsRespectViewRoom(t *testing.T) {
	f := newMediaFixture(t)
	_, id := f.sentFile(t)
	ask := func(as string) (int, int) {
		rec := f.do(t, as, f.text.AttachmentURLs, http.MethodPost, nil,
			map[string]any{"items": []map[string]string{{"id": id, "variant": "thumb"}, {"id": id, "variant": "download"}}})
		var resp struct {
			URLs map[string]any `json:"urls"`
			Gone []string       `json:"gone"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &resp)
		return len(resp.URLs), len(resp.Gone)
	}
	if urls, gone := ask("mod"); urls != 2 || gone != 0 {
		t.Fatalf("viewer: %d urls, %d gone", urls, gone)
	}
	// The uploader loses access to the channel but still reaches their file.
	if _, err := f.ps.SetOverwrite(f.ownerSub, models.PermissionOverwrite{TargetType: models.OverwriteTargetRoom, TargetID: f.openText.ID,
		SubjectType: models.OverwriteSubjectRole, SubjectID: models.SystemRoleEveryone, Deny: uint64(permissions.ViewRoom)}); err != nil {
		t.Fatal(err)
	}
	if urls, _ := ask("user"); urls != 2 {
		t.Fatalf("uploader without view_room: %d urls, want 2", urls)
	}
	if urls, gone := ask("mod"); urls != 0 || gone != 1 {
		t.Fatalf("non-viewer: %d urls, %d gone", urls, gone)
	}
}

func TestMyAttachmentsListsOnlyOwnFiles(t *testing.T) {
	f := newMediaFixture(t)
	_, id := f.sentFile(t)
	rec := f.do(t, "mod", f.text.ListMyAttachments, http.MethodGet, nil, nil)
	var resp struct {
		Items []myAttachment `json:"items"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Items) != 0 {
		t.Fatalf("mod sees %d files of another user", len(resp.Items))
	}
	rec = f.do(t, "user", f.text.ListMyAttachments, http.MethodGet, nil, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Items) != 1 || resp.Items[0].ID != id || resp.Items[0].RoomName != "chat" || !resp.Items[0].CanView {
		t.Fatalf("own files = %s", rec.Body.String())
	}
	// Bulk on someone else's file is not_found and changes nothing.
	bulk := f.do(t, "mod", f.text.BulkMyAttachments, http.MethodPost, nil, map[string]any{"ids": []string{id}, "action": "delete"})
	if !bytes.Contains(bulk.Body.Bytes(), []byte(`"not_found"`)) {
		t.Fatalf("bulk on another user's file: %s", bulk.Body.String())
	}
	if got, _ := f.media.Get(id); got.Status != chatmedia.StatusAttached {
		t.Fatalf("status = %s", got.Status)
	}
}

func TestDeleteTextChannelRemovesAttachments(t *testing.T) {
	f := newMediaFixture(t)
	_, id := f.sentFile(t)
	if rec := f.do(t, "owner", f.room.DeleteRoom, http.MethodDelete, map[string]string{"id": f.openText.ID}, nil); rec.Code != http.StatusOK {
		t.Fatalf("delete room: %d", rec.Code)
	}
	if got, _ := f.media.Get(id); got.RemovedReason != chatmedia.ReasonChannelDeleted {
		t.Fatalf("reason = %q", got.RemovedReason)
	}
}
