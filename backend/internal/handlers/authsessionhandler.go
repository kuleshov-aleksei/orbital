package handlers

import (
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/ratelimit"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// SessionPushStore drops the push tokens of signed-out devices
// (repository.PushDeviceRepository).
type SessionPushStore interface {
	DeleteForSessions(userID string, sessionIDs []string) error
	DeleteForUserExcept(userID, keepSessionID string) error
}

// SessionCloser closes the open sockets of signed-out devices (websocket.Hub).
type SessionCloser interface {
	CloseSessions(userID string, sessionIDs []string)
	CloseOtherSessions(userID, keepSessionID string)
}

// SetSessionHooks wires what must happen when devices are signed out.
// Either may be nil.
func (h *AuthHandler) SetSessionHooks(push SessionPushStore, closer SessionCloser) {
	h.sessionPush = push
	h.sessionCloser = closer
}

func sessionMetaFromRequest(r *http.Request) service.SessionMeta {
	return service.SessionMeta{
		UserAgent: r.UserAgent(),
		Client:    r.Header.Get(ClientHeader),
		IP:        ratelimit.ClientIP(r),
	}
}

func (h *AuthHandler) afterSessionsEnded(userID string, sessionIDs []string) {
	if len(sessionIDs) == 0 {
		return
	}
	if h.sessionPush != nil {
		if err := h.sessionPush.DeleteForSessions(userID, sessionIDs); err != nil {
			log.Printf("[Auth] Failed to drop push tokens of ended sessions of %s: %v", userID, err)
		}
	}
	if h.sessionCloser != nil {
		h.sessionCloser.CloseSessions(userID, sessionIDs)
	}
}

// ListSessions handles GET /api/auth/sessions: the caller's signed-in devices.
func (h *AuthHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessions, err := h.authService.ListSessions(userID, SessionIDFromContext(r.Context()))
	if err != nil {
		log.Printf("[Auth] Failed to list sessions of %s: %v", userID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, sessions)
}

// RevokeSession handles DELETE /api/auth/sessions/{id}: signs out one of the
// caller's other devices. Another user's session reads as not found; the
// current session is ended with /api/auth/logout instead.
func (h *AuthHandler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	id := mux.Vars(r)["id"]
	if id == "" {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	if id == SessionIDFromContext(r.Context()) {
		http.Error(w, "Use logout to end the current session", http.StatusBadRequest)
		return
	}
	found, err := h.authService.EndSession(userID, id)
	if err != nil {
		log.Printf("[Auth] Failed to revoke session of %s: %v", userID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if !found {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	h.afterSessionsEnded(userID, []string{id})
	w.WriteHeader(http.StatusNoContent)
}

// RevokeOtherSessions handles POST /api/auth/sessions/revoke-others: signs
// out every device of the caller except the current one, legacy tokens
// included.
func (h *AuthHandler) RevokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	current := SessionIDFromContext(r.Context())
	if current == "" {
		// A legacy token can't be told apart from the others it would revoke.
		// Clients refresh legacy tokens onto a session at startup.
		http.Error(w, "Refresh your session first", http.StatusConflict)
		return
	}
	ids, err := h.authService.EndOtherSessions(userID, current)
	if err != nil {
		log.Printf("[Auth] Failed to revoke other sessions of %s: %v", userID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if h.sessionPush != nil {
		if err := h.sessionPush.DeleteForUserExcept(userID, current); err != nil {
			log.Printf("[Auth] Failed to drop push tokens of %s: %v", userID, err)
		}
	}
	if h.sessionCloser != nil {
		h.sessionCloser.CloseOtherSessions(userID, current)
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]int{"revoked": len(ids)})
}
