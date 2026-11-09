package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// SoundboardNotifier is told when the library changes so clients can refresh.
type SoundboardNotifier interface {
	BroadcastSoundboardUpdated()
}

// SoundboardHandler serves the shared soundboard library. Permissions are
// checked in the handlers (upload_sounds / manage_soundboard).
type SoundboardHandler struct {
	soundboard  *service.SoundboardService
	permissions *service.PermissionService
	notifier    SoundboardNotifier
}

func NewSoundboardHandler(s *service.SoundboardService, ps *service.PermissionService, notifier SoundboardNotifier) *SoundboardHandler {
	return &SoundboardHandler{soundboard: s, permissions: ps, notifier: notifier}
}

func (h *SoundboardHandler) notify() {
	if h.notifier != nil {
		h.notifier.BroadcastSoundboardUpdated()
	}
}

func writeSoundboardError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrSoundNotFound):
		http.Error(w, "Sound not found", http.StatusNotFound)
	case errors.Is(err, service.ErrSoundTooLarge):
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
	case errors.Is(err, service.ErrSoundInvalidType),
		errors.Is(err, service.ErrSoundInvalidName),
		errors.Is(err, service.ErrSoundInvalidAlias),
		errors.Is(err, service.ErrSoundInvalidWAV),
		errors.Is(err, service.ErrSoundTooLong):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, service.ErrSoundLibraryFull):
		http.Error(w, err.Error(), http.StatusConflict)
	default:
		http.Error(w, "Soundboard operation failed", http.StatusInternalServerError)
	}
}

// ListSounds returns the whole library.
// GET /api/soundboard
func (h *SoundboardHandler) ListSounds(w http.ResponseWriter, r *http.Request) {
	sounds, err := h.soundboard.List()
	if err != nil {
		http.Error(w, "Failed to fetch sounds", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, sounds)
}

// GetSoundAudio serves a clip. Public (like /api/audio/{id}) because audio
// loaders cannot send Authorization headers; ids are random UUIDs.
// GET /api/soundboard/{id}/audio
func (h *SoundboardHandler) GetSoundAudio(w http.ResponseWriter, r *http.Request) {
	filePath, contentType, err := h.soundboard.AudioPath(mux.Vars(r)["id"])
	if err != nil {
		writeSoundboardError(w, err)
		return
	}
	w.Header().Set("Content-Type", contentType)
	// Safe to cache forever: audio_url carries a version that changes when the
	// audio is replaced (see withAudioURL).
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filePath)
}

// UploadSound adds a clip. Multipart fields: audio, name, emoji, aliases (JSON array).
// POST /api/soundboard
func (h *SoundboardHandler) UploadSound(w http.ResponseWriter, r *http.Request) {
	sub, ok := requireServerPerm(w, r, h.permissions, permissions.UploadSounds)
	if !ok {
		return
	}
	if sub.IsGuest {
		http.Error(w, "Guests cannot upload sounds", http.StatusForbidden)
		return
	}

	data, ok := readSoundUpload(w, r)
	if !ok {
		return
	}

	emoji := strings.TrimSpace(r.FormValue("emoji"))
	if err := validateStatusEmoji(emoji); err != nil {
		http.Error(w, "Invalid emoji", http.StatusBadRequest)
		return
	}
	var aliases []string
	if raw := r.FormValue("aliases"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &aliases); err != nil {
			http.Error(w, "aliases must be a JSON array of strings", http.StatusBadRequest)
			return
		}
	}

	sound, err := h.soundboard.Create(sub.UserID, data, r.FormValue("name"), emoji, aliases)
	if err != nil {
		writeSoundboardError(w, err)
		return
	}
	h.notify()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, sound)
}

// ReplaceSoundAudio swaps a clip's audio, keeping its id and metadata.
// Multipart field: audio.
// PUT /api/admin/soundboard/{id}/audio
func (h *SoundboardHandler) ReplaceSoundAudio(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireServerPerm(w, r, h.permissions, permissions.ManageSoundboard); !ok {
		return
	}
	data, ok := readSoundUpload(w, r)
	if !ok {
		return
	}
	sound, err := h.soundboard.ReplaceAudio(mux.Vars(r)["id"], data)
	if err != nil {
		writeSoundboardError(w, err)
		return
	}
	h.notify()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, sound)
}

// readSoundUpload parses the multipart form and returns the "audio" file,
// writing the error response itself when it fails.
func readSoundUpload(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	// Leave headroom for the other form fields on top of the file itself.
	const maxBody = service.MaxSoundboardFileSize + 64*1024
	if r.ContentLength > maxBody {
		http.Error(w, service.ErrSoundTooLarge.Error(), http.StatusRequestEntityTooLarge)
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	if err := r.ParseMultipartForm(maxBody); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, service.ErrSoundTooLarge.Error(), http.StatusRequestEntityTooLarge)
			return nil, false
		}
		http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
		return nil, false
	}

	file, _, err := r.FormFile("audio")
	if err != nil {
		http.Error(w, "No audio file provided", http.StatusBadRequest)
		return nil, false
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, service.MaxSoundboardFileSize+1))
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return nil, false
	}
	return data, true
}

// UpdateSound edits a clip's name, emoji and/or aliases.
// PATCH /api/admin/soundboard/{id}
func (h *SoundboardHandler) UpdateSound(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireServerPerm(w, r, h.permissions, permissions.ManageSoundboard); !ok {
		return
	}
	var req models.UpdateSoundboardSoundRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Emoji != nil {
		emoji := strings.TrimSpace(*req.Emoji)
		if err := validateStatusEmoji(emoji); err != nil {
			http.Error(w, "Invalid emoji", http.StatusBadRequest)
			return
		}
		req.Emoji = &emoji
	}
	sound, err := h.soundboard.Update(mux.Vars(r)["id"], req)
	if err != nil {
		writeSoundboardError(w, err)
		return
	}
	h.notify()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, sound)
}

// DeleteSound removes a clip and its file.
// DELETE /api/admin/soundboard/{id}
func (h *SoundboardHandler) DeleteSound(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireServerPerm(w, r, h.permissions, permissions.ManageSoundboard); !ok {
		return
	}
	if err := h.soundboard.Delete(mux.Vars(r)["id"]); err != nil {
		writeSoundboardError(w, err)
		return
	}
	h.notify()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "deleted"})
}
