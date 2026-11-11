package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"

	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// Text channel attachments (docs/specs/CHAT_SYSTEM.md §7.12). Every route
// needs h.media; main.go registers them only when S3 is configured.

const (
	maxURLBatch  = 100
	maxBulkBatch = 100
	// multipartMemory is kept in memory; larger files spool to a temp file.
	multipartMemory = 8 << 20
)

func writeMediaError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "internal_error"
	switch {
	case errors.Is(err, chatmedia.ErrNotFound):
		status, code = http.StatusNotFound, "not_found"
	case errors.Is(err, chatmedia.ErrForbidden):
		status, code = http.StatusForbidden, "forbidden"
	case errors.Is(err, chatmedia.ErrUnsupported):
		status, code = http.StatusUnsupportedMediaType, "unsupported_type"
	case errors.Is(err, chatmedia.ErrTooLarge):
		status, code = http.StatusRequestEntityTooLarge, "file_too_large"
	case errors.Is(err, chatmedia.ErrFileExceedsQuota):
		status, code = http.StatusRequestEntityTooLarge, "file_exceeds_quota"
	case errors.Is(err, chatmedia.ErrQuotaProtectedFull):
		status, code = http.StatusRequestEntityTooLarge, "quota_protected_full"
	case errors.Is(err, chatmedia.ErrBadImage):
		status, code = http.StatusBadRequest, "invalid_image"
	case errors.Is(err, chatmedia.ErrNotAttached):
		status, code = http.StatusConflict, "not_attached"
	case errors.Is(err, chatmedia.ErrUnavailable):
		status, code = http.StatusServiceUnavailable, "storage_unavailable"
		log.Printf("[ChatMedia] %v", err)
	default:
		log.Printf("[ChatMedia] %v", err)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	writeJSON(w, map[string]string{"error": code})
}

// evictedFile is one auto-removed file in an upload response.
type evictedFile struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	StoredBytes int64  `json:"stored_bytes"`
}

// UploadAttachment handles POST /api/rooms/{id}/attachments (multipart:
// file, plus optional peaks, duration_ms, width, height measured by the
// client). Needs SendMessages and AttachFiles in the channel.
func (h *TextChatHandler) UploadAttachment(w http.ResponseWriter, r *http.Request) {
	roomID := mux.Vars(r)["id"]
	if !h.requireTextRoom(w, r, roomID) {
		return
	}
	if _, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.SendMessages); !ok {
		return
	}
	sub, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.AttachFiles)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.media.MaxUploadBytes()+(1<<20))
	if err := r.ParseMultipartForm(multipartMemory); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeMediaError(w, chatmedia.ErrTooLarge)
			return
		}
		http.Error(w, "Invalid multipart form", http.StatusBadRequest)
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing file", http.StatusBadRequest)
		return
	}
	defer func() { _ = file.Close() }()

	meta := chatmedia.ClientMeta{}
	if v := r.FormValue("peaks"); v != "" && len(v) < 4096 {
		_ = json.Unmarshal([]byte(v), &meta.Peaks)
	}
	meta.DurationMS, _ = strconv.ParseInt(r.FormValue("duration_ms"), 10, 64)
	meta.Width, _ = strconv.Atoi(r.FormValue("width"))
	meta.Height, _ = strconv.Atoi(r.FormValue("height"))

	res, err := h.media.Upload(r.Context(), chatmedia.UploadInput{
		RoomID: roomID, UploaderID: sub.UserID, Filename: header.Filename,
		File: file, Size: header.Size, Meta: meta,
	})
	if err != nil {
		writeMediaError(w, err)
		return
	}
	evicted := make([]evictedFile, len(res.Evicted))
	for i, e := range res.Evicted {
		evicted[i] = evictedFile{ID: e.ID, Filename: e.Filename, StoredBytes: e.StoredBytes}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]any{
		"upload_id":  res.Record.ID,
		"attachment": publicAttachment(res.Record),
		"evicted":    evicted,
		"usage":      res.Usage,
	})
}

func publicAttachment(rec *chatmedia.Record) chatstore.Attachment {
	a := chatstore.Attachment{
		ID: rec.ID, Kind: rec.Kind, Mime: rec.Mime, Size: rec.SizeBytes, Filename: rec.Filename,
		Width: rec.Width, Height: rec.Height, DurationMS: rec.DurationMS, HasThumb: rec.HasThumb,
		Peaks: rec.Peaks, Protected: rec.Protected,
	}
	if rec.Status == chatmedia.StatusRemoved {
		a.Removed = rec.RemovedReason
	}
	return a
}

// canSee reports whether the subject may fetch a file: the uploader always
// (the storage page lists their files), others need VIEW_ROOM.
func (h *TextChatHandler) canSee(r *http.Request, rec *chatmedia.Record) bool {
	sub, ok := subjectFromRequest(r)
	if !ok {
		return false
	}
	if rec.UploaderID == sub.UserID {
		return true
	}
	return rec.Status == chatmedia.StatusAttached &&
		h.permissions.RoomPerms(sub, rec.RoomID).Has(permissions.ViewRoom)
}

type urlRequestItem struct {
	ID      string `json:"id"`
	Variant string `json:"variant"`
}

type presignedURL struct {
	URL       string `json:"url"`
	ExpiresAt int64  `json:"expires_at"`
}

// AttachmentURLs handles POST /api/attachments/urls {items: [{id, variant}]}.
// <img>/<video> cannot send the Authorization header, so clients fetch
// presigned URLs here (cached until expires_at). Removed or invisible files
// are listed in gone.
func (h *TextChatHandler) AttachmentURLs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []urlRequestItem `json:"items"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil ||
		len(req.Items) == 0 || len(req.Items) > maxURLBatch {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	urls := map[string]presignedURL{}
	gone := []string{}
	records := map[string]*chatmedia.Record{}
	for _, it := range req.Items {
		switch it.Variant {
		case "original", "thumb", "download":
		default:
			it.Variant = "original"
		}
		rec, seen := records[it.ID]
		if !seen {
			var err error
			rec, err = h.media.Get(it.ID)
			if err != nil && !errors.Is(err, chatmedia.ErrNotFound) {
				writeMediaError(w, err)
				return
			}
			records[it.ID] = rec
			if rec == nil || rec.Status == chatmedia.StatusRemoved || !h.canSee(r, rec) {
				gone = append(gone, it.ID)
			}
		}
		if rec == nil || rec.Status == chatmedia.StatusRemoved || !h.canSee(r, rec) {
			continue
		}
		u, exp, err := h.media.URL(r.Context(), rec, it.Variant)
		if err != nil {
			writeMediaError(w, err)
			return
		}
		urls[it.ID+":"+it.Variant] = presignedURL{URL: u, ExpiresAt: exp.UnixMilli()}
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"urls": urls, "gone": gone})
}

// loadVisible loads a file for PATCH/DELETE; files the subject cannot see
// are 404 (no existence leak), removed ones 410.
func (h *TextChatHandler) loadVisible(w http.ResponseWriter, r *http.Request, id string) (*chatmedia.Record, bool) {
	rec, err := h.media.Get(id)
	if err != nil {
		writeMediaError(w, err)
		return nil, false
	}
	if !h.canSee(r, rec) {
		writeMediaError(w, chatmedia.ErrNotFound)
		return nil, false
	}
	if rec.Status == chatmedia.StatusRemoved {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		writeJSON(w, map[string]string{"error": "removed"})
		return nil, false
	}
	return rec, true
}

// UpdateAttachment handles PATCH /api/attachments/{id} {protected}. Only the
// uploader may protect a file: it uses their quota.
func (h *TextChatHandler) UpdateAttachment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Protected *bool `json:"protected"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil || req.Protected == nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	rec, ok := h.loadVisible(w, r, mux.Vars(r)["id"])
	if !ok {
		return
	}
	if sub, _ := subjectFromRequest(r); rec.UploaderID != sub.UserID {
		writeMediaError(w, chatmedia.ErrForbidden)
		return
	}
	updated, err := h.media.SetProtected(rec, *req.Protected)
	if err != nil {
		writeMediaError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"attachment": publicAttachment(updated)})
}

// DeleteAttachment handles DELETE /api/attachments/{id}: the uploader, or
// ManageMessages in the channel. The message stays with a tombstone.
func (h *TextChatHandler) DeleteAttachment(w http.ResponseWriter, r *http.Request) {
	rec, ok := h.loadVisible(w, r, mux.Vars(r)["id"])
	if !ok {
		return
	}
	reason, ok := h.removalReason(r, rec)
	if !ok {
		writeMediaError(w, chatmedia.ErrForbidden)
		return
	}
	if _, err := h.media.Remove([]*chatmedia.Record{rec}, reason); err != nil {
		writeMediaError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *TextChatHandler) removalReason(r *http.Request, rec *chatmedia.Record) (string, bool) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		return "", false
	}
	if rec.UploaderID == sub.UserID {
		return chatmedia.ReasonOwner, true
	}
	if rec.Status == chatmedia.StatusAttached &&
		h.permissions.RoomPerms(sub, rec.RoomID).Has(permissions.ManageMessages) {
		return chatmedia.ReasonModerator, true
	}
	return "", false
}

// myAttachment is a row of the storage page.
type myAttachment struct {
	chatstore.Attachment
	RoomID      string `json:"room_id"`
	RoomName    string `json:"room_name"`
	MessageID   string `json:"message_id,omitempty"`
	Status      string `json:"status"`
	StoredBytes int64  `json:"stored_bytes"`
	CreatedAt   int64  `json:"created_at"`
	// CanView: the uploader still sees the channel (jump to message).
	CanView     bool `json:"can_view"`
	RemovalNext bool `json:"removal_next"`
}

// ListMyAttachments handles GET /api/me/attachments: the caller's own
// pending and attached files.
func (h *TextChatHandler) ListMyAttachments(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("cursor"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	kind := q.Get("kind")
	if kind != chatmedia.KindImage && kind != chatmedia.KindVideo && kind != chatmedia.KindAudio {
		kind = ""
	}
	recs, next, err := h.media.List(sub.UserID, chatmedia.ListFilter{
		Kind: kind, RoomID: q.Get("room_id"), Sort: q.Get("sort"), Query: q.Get("q"),
		ProtectedOnly: q.Get("protected") == "1", Offset: offset, Limit: limit,
	})
	if err != nil {
		writeMediaError(w, err)
		return
	}
	nextRemoval, err := h.media.NextRemovalIDs(sub.UserID)
	if err != nil {
		writeMediaError(w, err)
		return
	}
	items := make([]myAttachment, len(recs))
	for i, rec := range recs {
		name := ""
		if room, ok := h.roomService.GetRoom(rec.RoomID); ok {
			name = room.Name
		}
		items[i] = myAttachment{
			Attachment: publicAttachment(rec), RoomID: rec.RoomID, RoomName: name,
			MessageID: rec.MessageID, Status: rec.Status, StoredBytes: rec.StoredBytes, CreatedAt: rec.CreatedAt,
			CanView:     name != "" && h.permissions.RoomPerms(sub, rec.RoomID).Has(permissions.ViewRoom),
			RemovalNext: nextRemoval[rec.ID],
		}
	}
	resp := map[string]any{"items": items, "next_cursor": nil}
	if next > 0 {
		resp["next_cursor"] = strconv.Itoa(next)
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, resp)
}

// MyAttachmentUsage handles GET /api/me/attachments/usage.
func (h *TextChatHandler) MyAttachmentUsage(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	u, err := h.media.Usage(sub.UserID)
	if err != nil {
		writeMediaError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, u)
}

// BulkMyAttachments handles POST /api/me/attachments/bulk {ids, action}:
// delete, protect or unprotect several of the caller's own files.
func (h *TextChatHandler) BulkMyAttachments(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		IDs    []string `json:"ids"`
		Action string   `json:"action"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil ||
		len(req.IDs) == 0 || len(req.IDs) > maxBulkBatch {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Action != "delete" && req.Action != "protect" && req.Action != "unprotect" {
		http.Error(w, "Invalid action", http.StatusBadRequest)
		return
	}
	results := map[string]string{}
	var toRemove []*chatmedia.Record
	for _, id := range req.IDs {
		rec, err := h.media.Get(id)
		switch {
		case err != nil || rec.UploaderID != sub.UserID:
			results[id] = "not_found"
			continue
		case rec.Status == chatmedia.StatusRemoved:
			results[id] = "removed"
			continue
		}
		if req.Action == "delete" {
			toRemove = append(toRemove, rec)
			results[id] = "ok"
			continue
		}
		if _, err := h.media.SetProtected(rec, req.Action == "protect"); err != nil {
			if errors.Is(err, chatmedia.ErrNotAttached) {
				results[id] = "not_attached"
			} else {
				results[id] = "error"
				log.Printf("[ChatMedia] Bulk %s of %s failed: %v", req.Action, id, err)
			}
			continue
		}
		results[id] = "ok"
	}
	if len(toRemove) > 0 {
		if _, err := h.media.Remove(toRemove, chatmedia.ReasonOwner); err != nil {
			writeMediaError(w, err)
			return
		}
	}
	u, err := h.media.Usage(sub.UserID)
	if err != nil {
		writeMediaError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"results": results, "usage": u})
}
