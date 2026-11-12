package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// EmojiNotifier is told when the library changes so clients can refresh.
type EmojiNotifier interface {
	BroadcastCustomEmojisUpdated()
}

// EmojiHandler serves the custom emoji library. Permissions are checked in
// the handlers (upload_emojis / manage_emojis).
type EmojiHandler struct {
	emojis      *service.EmojiService
	permissions *service.PermissionService
	notifier    EmojiNotifier
}

func NewEmojiHandler(s *service.EmojiService, ps *service.PermissionService, notifier EmojiNotifier) *EmojiHandler {
	return &EmojiHandler{emojis: s, permissions: ps, notifier: notifier}
}

func (h *EmojiHandler) notify() {
	if h.notifier != nil {
		h.notifier.BroadcastCustomEmojisUpdated()
	}
}

func writeEmojiError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrEmojiNotFound):
		http.Error(w, "Emoji not found", http.StatusNotFound)
	case errors.Is(err, service.ErrEmojiTooLarge):
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
	case errors.Is(err, service.ErrEmojiInvalidType),
		errors.Is(err, service.ErrEmojiInvalidImage),
		errors.Is(err, service.ErrSoundInvalidName),
		errors.Is(err, service.ErrSoundInvalidAlias):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, service.ErrEmojiLibraryFull):
		http.Error(w, err.Error(), http.StatusConflict)
	default:
		http.Error(w, "Emoji operation failed", http.StatusInternalServerError)
	}
}

// maxEmojiLookup caps the values of one ?ids= or ?shortcodes= lookup.
const maxEmojiLookup = 100

// emojiPageResponse is one page of the library or of a search.
type emojiPageResponse struct {
	Emojis     []*models.CustomEmoji `json:"emojis"`
	NextCursor string                `json:"next_cursor"`
	Total      int                   `json:"total"`
	Max        int                   `json:"max"`
}

// emojiLookupResponse answers ?ids= and ?shortcodes= lookups. Shortcodes maps
// each matched shortcode to its emoji id (unmatched ones are absent).
type emojiLookupResponse struct {
	Emojis     []*models.CustomEmoji `json:"emojis"`
	Shortcodes map[string]string     `json:"shortcodes,omitempty"`
}

// splitEmojiLookup parses a comma-separated lookup list, dropping empties.
func splitEmojiLookup(raw string) ([]string, bool) {
	var out []string
	for _, v := range strings.Split(raw, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out, len(out) <= maxEmojiLookup
}

// ListEmojis serves the library.
// GET /api/emojis                          the whole library as an array (older clients)
// GET /api/emojis?limit=N[&cursor=][&q=]   one page (or a search), with total and max
// GET /api/emojis?ids=a,b                  batch lookup by id
// GET /api/emojis?shortcodes=x,y           batch lookup by :shortcode:
func (h *EmojiHandler) ListEmojis(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	w.Header().Set("Content-Type", "application/json")

	switch {
	case query.Has("ids"):
		ids, ok := splitEmojiLookup(query.Get("ids"))
		if !ok {
			http.Error(w, "Too many ids", http.StatusBadRequest)
			return
		}
		emojis, err := h.emojis.GetByIDs(ids)
		if err != nil {
			http.Error(w, "Failed to fetch emojis", http.StatusInternalServerError)
			return
		}
		writeJSON(w, emojiLookupResponse{Emojis: emojis})

	case query.Has("shortcodes"):
		codes, ok := splitEmojiLookup(query.Get("shortcodes"))
		if !ok {
			http.Error(w, "Too many shortcodes", http.StatusBadRequest)
			return
		}
		ids, emojis, err := h.emojis.ByShortcodes(codes)
		if err != nil {
			http.Error(w, "Failed to fetch emojis", http.StatusInternalServerError)
			return
		}
		writeJSON(w, emojiLookupResponse{Emojis: emojis, Shortcodes: ids})

	case query.Has("limit"):
		limit, err := strconv.Atoi(query.Get("limit"))
		if err != nil {
			http.Error(w, "Invalid limit", http.StatusBadRequest)
			return
		}
		var (
			emojis []*models.CustomEmoji
			next   string
		)
		if q := strings.TrimSpace(query.Get("q")); q != "" {
			emojis, next, err = h.emojis.Search(q, query.Get("cursor"), limit)
		} else {
			emojis, next, err = h.emojis.Page(query.Get("cursor"), limit)
		}
		if errors.Is(err, service.ErrEmojiInvalidCursor) {
			http.Error(w, "Invalid cursor", http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, "Failed to fetch emojis", http.StatusInternalServerError)
			return
		}
		total, err := h.emojis.Count()
		if err != nil {
			http.Error(w, "Failed to fetch emojis", http.StatusInternalServerError)
			return
		}
		writeJSON(w, emojiPageResponse{Emojis: emojis, NextCursor: next, Total: total, Max: h.emojis.MaxCustom()})

	default:
		emojis, err := h.emojis.List()
		if err != nil {
			http.Error(w, "Failed to fetch emojis", http.StatusInternalServerError)
			return
		}
		writeJSON(w, emojis)
	}
}

// GetEmojiImage serves an emoji image. Public because <img> cannot send
// Authorization headers; ids are random UUIDs.
// GET /api/emojis/{id}/image
func (h *EmojiHandler) GetEmojiImage(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	filePath, err := h.emojis.ImagePath(id)
	if err != nil {
		writeEmojiError(w, err)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Safe to cache forever: image_url carries the stored filename as a version.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")

	// ?still=1: first frame of an animated emoji (reduce-motion setting).
	if r.URL.Query().Get("still") == "1" {
		still, ok, err := h.emojis.StillImage(id)
		if err != nil {
			writeEmojiError(w, err)
			return
		}
		if ok {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(still)
			return
		}
	}

	// .png/.gif are emojis stored before WebP (see EmojiService.MigrateToWebP).
	contentType := "image/webp"
	switch filepath.Ext(filePath) {
	case ".png":
		contentType = "image/png"
	case ".gif":
		contentType = "image/gif"
	}
	w.Header().Set("Content-Type", contentType)
	http.ServeFile(w, r, filePath)
}

// UploadEmoji adds an emoji. Multipart fields: image, name, aliases (JSON array).
// POST /api/emojis
func (h *EmojiHandler) UploadEmoji(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireServerPerm(w, r, h.permissions, permissions.UploadEmojis)
	if !ok {
		return
	}
	if sub.IsGuest {
		http.Error(w, "Guests cannot upload emojis", http.StatusForbidden)
		return
	}

	// Leave headroom for the other form fields on top of the file itself.
	const maxBody = service.MaxEmojiFileSize + 64*1024
	if r.ContentLength > maxBody {
		http.Error(w, service.ErrEmojiTooLarge.Error(), http.StatusRequestEntityTooLarge)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	if err := r.ParseMultipartForm(maxBody); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, service.ErrEmojiTooLarge.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "No image file provided", http.StatusBadRequest)
		return
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, service.MaxEmojiFileSize+1))
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	var aliases []string
	if raw := r.FormValue("aliases"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &aliases); err != nil {
			http.Error(w, "aliases must be a JSON array of strings", http.StatusBadRequest)
			return
		}
	}

	emoji, err := h.emojis.Create(sub.UserID, data, r.FormValue("name"), aliases)
	if err != nil {
		writeEmojiError(w, err)
		return
	}
	h.notify()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, emoji)
}

// UpdateEmoji edits an emoji's name and/or aliases.
// PATCH /api/admin/emojis/{id}
func (h *EmojiHandler) UpdateEmoji(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireServerPerm(w, r, h.permissions, permissions.ManageEmojis); !ok {
		return
	}
	var req models.UpdateCustomEmojiRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	emoji, err := h.emojis.Update(mux.Vars(r)["id"], req)
	if err != nil {
		writeEmojiError(w, err)
		return
	}
	h.notify()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, emoji)
}

// DeleteEmoji removes an emoji and its file.
// DELETE /api/admin/emojis/{id}
func (h *EmojiHandler) DeleteEmoji(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireServerPerm(w, r, h.permissions, permissions.ManageEmojis); !ok {
		return
	}
	if err := h.emojis.Delete(mux.Vars(r)["id"]); err != nil {
		writeEmojiError(w, err)
		return
	}
	h.notify()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "deleted"})
}
