package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// BadgeNotifier is told when the badge library changes so clients can refresh.
type BadgeNotifier interface {
	BroadcastBadgesUpdated()
	BroadcastUserBadgesUpdated(userID string, badges []models.UserBadge)
}

// BadgeHandler serves the profile badge library. Reads need an authenticated
// user (everyone renders badges); mutations are super-admin only (the routes
// live on the admin router).
type BadgeHandler struct {
	badges   *service.BadgeService
	notifier BadgeNotifier
}

func NewBadgeHandler(s *service.BadgeService, notifier BadgeNotifier) *BadgeHandler {
	return &BadgeHandler{badges: s, notifier: notifier}
}

func (h *BadgeHandler) notifyLibrary() {
	if h.notifier != nil {
		h.notifier.BroadcastBadgesUpdated()
	}
}

func writeBadgeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrBadgeNotFound):
		http.Error(w, "Badge not found", http.StatusNotFound)
	case errors.Is(err, service.ErrBadgeUserNotFound):
		http.Error(w, "User not found", http.StatusNotFound)
	case errors.Is(err, service.ErrBadgeTooLarge):
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
	case errors.Is(err, service.ErrBadgeInvalidType),
		errors.Is(err, service.ErrBadgeInvalidImage),
		errors.Is(err, service.ErrBadgeInvalidName),
		errors.Is(err, service.ErrBadgeInvalidDesc),
		errors.Is(err, service.ErrBadgeNotHeld):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, service.ErrBadgeNameTaken):
		http.Error(w, err.Error(), http.StatusConflict)
	default:
		http.Error(w, "Badge operation failed", http.StatusInternalServerError)
	}
}

// ListBadges returns the badge library.
// GET /api/badges
func (h *BadgeHandler) ListBadges(w http.ResponseWriter, r *http.Request) {
	badges, err := h.badges.List()
	if err != nil {
		http.Error(w, "Failed to fetch badges", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, badges)
}

// GetAssignments returns every user's badges (with award dates).
// GET /api/badges/assignments
func (h *BadgeHandler) GetAssignments(w http.ResponseWriter, r *http.Request) {
	assignments, err := h.badges.Assignments()
	if err != nil {
		http.Error(w, "Failed to fetch badge assignments", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]models.BadgeAssignments{"assignments": assignments})
}

// GetBadgeImage serves a badge image. Public because <img> cannot send
// Authorization headers; ids are random UUIDs.
// GET /api/badges/{id}/image
func (h *BadgeHandler) GetBadgeImage(w http.ResponseWriter, r *http.Request) {
	filePath, err := h.badges.ImagePath(mux.Vars(r)["id"])
	if err != nil {
		writeBadgeError(w, err)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Safe to cache forever: image_url carries the stored filename as a version.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "image/webp")
	http.ServeFile(w, r, filePath)
}

// maxBadgeBody leaves headroom for the other form fields on top of the file.
const maxBadgeBody = service.MaxBadgeFileSize + 64*1024

// badgeImage reads the "image" part of a multipart request.
func badgeImage(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if r.ContentLength > maxBadgeBody {
		http.Error(w, service.ErrBadgeTooLarge.Error(), http.StatusRequestEntityTooLarge)
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBadgeBody)
	if err := r.ParseMultipartForm(maxBadgeBody); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, service.ErrBadgeTooLarge.Error(), http.StatusRequestEntityTooLarge)
			return nil, false
		}
		http.Error(w, "Failed to parse multipart form", http.StatusBadRequest)
		return nil, false
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "No image file provided", http.StatusBadRequest)
		return nil, false
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, service.MaxBadgeFileSize+1))
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return nil, false
	}
	return data, true
}

// UploadBadge adds a badge. Multipart fields: image, name, description.
// POST /api/admin/badges
func (h *BadgeHandler) UploadBadge(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	data, ok := badgeImage(w, r)
	if !ok {
		return
	}
	badge, err := h.badges.Create(sub.UserID, data, r.FormValue("name"), r.FormValue("description"))
	if err != nil {
		writeBadgeError(w, err)
		return
	}
	h.notifyLibrary()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, badge)
}

// UpdateBadge edits a badge's name and/or description.
// PATCH /api/admin/badges/{id}
func (h *BadgeHandler) UpdateBadge(w http.ResponseWriter, r *http.Request) {
	var req models.UpdateBadgeRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	badge, err := h.badges.Update(mux.Vars(r)["id"], req)
	if err != nil {
		writeBadgeError(w, err)
		return
	}
	h.notifyLibrary()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, badge)
}

// ReplaceBadgeImage swaps a badge's image. Multipart field: image.
// PUT /api/admin/badges/{id}/image
func (h *BadgeHandler) ReplaceBadgeImage(w http.ResponseWriter, r *http.Request) {
	data, ok := badgeImage(w, r)
	if !ok {
		return
	}
	badge, err := h.badges.ReplaceImage(mux.Vars(r)["id"], data)
	if err != nil {
		writeBadgeError(w, err)
		return
	}
	h.notifyLibrary()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, badge)
}

// DeleteBadge removes a badge and every assignment of it.
// DELETE /api/admin/badges/{id}
func (h *BadgeHandler) DeleteBadge(w http.ResponseWriter, r *http.Request) {
	if err := h.badges.Delete(mux.Vars(r)["id"]); err != nil {
		writeBadgeError(w, err)
		return
	}
	h.notifyLibrary()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "deleted"})
}

// SetMyDisplayedBadge pins one of the caller's badges next to their nickname.
// PUT /api/users/me/displayed-badge  ({"badge_id": ""} clears the pin)
func (h *BadgeHandler) SetMyDisplayedBadge(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req models.SetDisplayedBadgeRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4*1024)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	badges, err := h.badges.SetDisplayedBadge(sub.UserID, req.BadgeID)
	if err != nil {
		writeBadgeError(w, err)
		return
	}
	if h.notifier != nil {
		h.notifier.BroadcastUserBadgesUpdated(sub.UserID, badges)
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"user_id": sub.UserID, "badges": badges})
}

// SetUserBadges replaces one user's badge set.
// PUT /api/admin/users/{id}/badges
func (h *BadgeHandler) SetUserBadges(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req models.SetUserBadgesRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	userID := mux.Vars(r)["id"]
	badges, err := h.badges.SetUserBadges(userID, req.BadgeIDs, sub.UserID)
	if err != nil {
		writeBadgeError(w, err)
		return
	}
	if h.notifier != nil {
		h.notifier.BroadcastUserBadgesUpdated(userID, badges)
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"user_id": userID, "badges": badges})
}
