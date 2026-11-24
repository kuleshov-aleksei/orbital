package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// writeAccountSecurityError maps the account security errors to statuses.
// password is the new password of the request, if any: a failed
// ValidatePassword on it is a 400.
func writeAccountSecurityError(w http.ResponseWriter, err error, password, action string) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, service.ErrWrongPassword):
		status = http.StatusForbidden
	case errors.Is(err, service.ErrEmailInUse), errors.Is(err, service.ErrNoSession):
		status = http.StatusConflict
	case errors.Is(err, service.ErrEmailCooldown):
		status = http.StatusTooManyRequests
	case errors.Is(err, service.ErrNotPasswordAccount),
		errors.Is(err, service.ErrSameEmail),
		errors.Is(err, service.ErrInvalidEmail),
		errors.Is(err, service.ErrInvalidEmailToken):
		status = http.StatusBadRequest
	case password != "" && service.ValidatePassword(password) != nil:
		status = http.StatusBadRequest
	}
	if status == http.StatusInternalServerError {
		log.Printf("[Auth] %s failed: %v", action, err)
		http.Error(w, "Internal server error", status)
		return
	}
	http.Error(w, err.Error(), status)
}

// ChangePassword handles POST /api/auth/password/change {current_password,
// new_password}. Every other device is signed out; this one stays.
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	if h.emailAuth == nil {
		http.Error(w, "Not available", http.StatusServiceUnavailable)
		return
	}
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !decodeEmailRequest(w, r, &req) {
		return
	}
	current := SessionIDFromContext(r.Context())
	if err := h.emailAuth.ChangePassword(userID, current, req.CurrentPassword, req.NewPassword); err != nil {
		writeAccountSecurityError(w, err, req.NewPassword, "Password change")
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
	w.WriteHeader(http.StatusNoContent)
}

// RequestEmailChange handles POST /api/auth/email/change {new_email,
// password}. With email on, the new address gets a confirm link (pending);
// with email off, it applies at once, unverified.
func (h *AuthHandler) RequestEmailChange(w http.ResponseWriter, r *http.Request) {
	if h.emailAuth == nil {
		http.Error(w, "Not available", http.StatusServiceUnavailable)
		return
	}
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		NewEmail string `json:"new_email"`
		Password string `json:"password"`
	}
	if !decodeEmailRequest(w, r, &req) {
		return
	}
	pending, err := h.emailAuth.RequestEmailChange(userID, req.Password, req.NewEmail)
	if err != nil {
		writeAccountSecurityError(w, err, "", "Email change")
		return
	}
	user, err := h.authService.GetUserByID(userID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]interface{}{
		"pending":        pending,
		"new_email":      req.NewEmail,
		"email":          user.Email,
		"email_verified": user.EmailVerified,
	})
}

// ConfirmEmailChange handles POST /api/auth/email/confirm {token}. Public:
// the link may be opened on a device that isn't signed in.
func (h *AuthHandler) ConfirmEmailChange(w http.ResponseWriter, r *http.Request) {
	if !h.emailEnabled() {
		http.Error(w, "Email is not configured", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if !decodeEmailRequest(w, r, &req) {
		return
	}
	if req.Token == "" {
		http.Error(w, service.ErrInvalidEmailToken.Error(), http.StatusBadRequest)
		return
	}
	user, err := h.emailAuth.ConfirmEmailChange(req.Token)
	if err != nil {
		writeAccountSecurityError(w, err, "", "Email change confirmation")
		return
	}
	if user == nil {
		http.Error(w, service.ErrInvalidEmailToken.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{
		"user_id":        user.ID,
		"email":          user.Email,
		"email_verified": user.EmailVerified,
	})
}

// RestoreEmail handles POST /api/auth/email/restore {token, password}: the
// "this wasn't me" link sent to the old address. The old email comes back,
// the password is replaced, every device is signed out and the caller gets
// a fresh session.
func (h *AuthHandler) RestoreEmail(w http.ResponseWriter, r *http.Request) {
	if !h.emailEnabled() {
		http.Error(w, "Email is not configured", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !decodeEmailRequest(w, r, &req) {
		return
	}
	if req.Token == "" {
		http.Error(w, service.ErrInvalidEmailToken.Error(), http.StatusBadRequest)
		return
	}
	user, err := h.emailAuth.RestoreEmail(req.Token, req.Password)
	if err != nil {
		writeAccountSecurityError(w, err, req.Password, "Email restore")
		return
	}
	if user == nil {
		http.Error(w, service.ErrInvalidEmailToken.Error(), http.StatusBadRequest)
		return
	}
	h.signInAfterRecovery(w, r, user)
}
