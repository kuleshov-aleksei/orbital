package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/mail"
	"strconv"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	mailsvc "github.com/kuleshov-aleksei/orbital/internal/service/mail"
)

const emailRequestMaxBytes = 4 << 10

// SetEmailAuth wires email verification and password reset. nil (or a
// service without SMTP) leaves email disabled.
func (h *AuthHandler) SetEmailAuth(emailAuth *service.EmailAuthService) {
	h.emailAuth = emailAuth
}

func (h *AuthHandler) emailEnabled() bool {
	return h.emailAuth != nil && h.emailAuth.Enabled()
}

func decodeEmailRequest(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, emailRequestMaxBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return false
	}
	return true
}

// sendVerificationAfterRegister mails the first verification link. Failures
// are logged only: the account works unverified and can resend later.
func (h *AuthHandler) sendVerificationAfterRegister(user *models.User) {
	if !h.emailEnabled() {
		return
	}
	if err := h.emailAuth.SendVerification(user); err != nil {
		log.Printf("[Auth] Failed to queue verification mail for %s: %v", user.ID, err)
	}
}

// VerifyEmail handles POST /api/auth/verify-email {token}. Public: the link
// may be opened on a device that isn't signed in.
func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
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
	if _, err := h.emailAuth.VerifyEmail(req.Token); err != nil {
		if errors.Is(err, service.ErrInvalidEmailToken) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		log.Printf("[Auth] Email verification failed: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"verified": true})
}

// ResendVerification handles POST /api/auth/verify-email/resend for the
// signed-in user.
func (h *AuthHandler) ResendVerification(w http.ResponseWriter, r *http.Request) {
	if !h.emailEnabled() {
		http.Error(w, "Email is not configured", http.StatusServiceUnavailable)
		return
	}
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	user, err := h.authService.GetUserByID(userID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	switch err := h.emailAuth.SendVerification(user); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, service.ErrEmailCooldown):
		http.Error(w, err.Error(), http.StatusTooManyRequests)
	case errors.Is(err, service.ErrAlreadyVerified):
		http.Error(w, err.Error(), http.StatusConflict)
	case errors.Is(err, service.ErrNoPasswordEmail):
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		log.Printf("[Auth] Failed to resend verification for %s: %v", userID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

// ForgotPassword handles POST /api/auth/password/forgot {email}. It answers
// 200 with the same body after a random 400 ms–1 s delay whatever the
// email, so it can't be used to find out who has an account.
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	if !h.emailEnabled() {
		http.Error(w, "Email is not configured", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if !decodeEmailRequest(w, r, &req) {
		return
	}
	h.emailAuth.RequestPasswordReset(r.Context(), req.Email)
	writeJSON(w, map[string]bool{"ok": true})
}

// ResetPassword handles POST /api/auth/password/reset {token, password}.
// Every device of the account is signed out (sockets closed with 4401) and
// the caller gets a fresh session.
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
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
	user, err := h.emailAuth.ResetPassword(req.Token, req.Password)
	if err != nil {
		if errors.Is(err, service.ErrInvalidEmailToken) || service.ValidatePassword(req.Password) != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		log.Printf("[Auth] Password reset failed: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if user == nil {
		http.Error(w, service.ErrInvalidEmailToken.Error(), http.StatusBadRequest)
		return
	}
	h.signInAfterRecovery(w, r, user)
}

// signInAfterRecovery finishes a flow that revoked every session (password
// reset, email restore): it drops the push tokens and sockets of the ended
// sessions and signs the caller in with a fresh one.
func (h *AuthHandler) signInAfterRecovery(w http.ResponseWriter, r *http.Request, user *models.User) {
	if h.sessionPush != nil {
		if err := h.sessionPush.DeleteForUserExcept(user.ID, ""); err != nil {
			log.Printf("[Auth] Failed to drop push tokens of %s: %v", user.ID, err)
		}
	}
	if h.sessionCloser != nil {
		h.sessionCloser.CloseOtherSessions(user.ID, "")
	}

	token, expiry, err := h.authService.StartSession(user, sessionMetaFromRequest(r))
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, models.LoginResponse{Token: token, User: *user, ExpiresAt: expiry})
}

// ListEmailLog handles GET /api/admin/emails?limit=&before= (super admin).
func (h *AuthHandler) ListEmailLog(w http.ResponseWriter, r *http.Request) {
	if h.emailAuth == nil {
		writeJSON(w, map[string]interface{}{"enabled": false, "entries": []models.EmailLogEntry{}})
		return
	}
	limit := 50
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	var before int64
	if v, err := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64); err == nil && v > 0 {
		before = v
	}
	entries, err := h.emailAuth.ListLog(limit, before)
	if err != nil {
		log.Printf("[Auth] Failed to list email log: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]interface{}{"enabled": h.emailEnabled(), "entries": entries})
}

// SendTestEmail handles POST /api/admin/emails/test {to} (super admin): a
// synchronous send that reports the SMTP error, to check the configuration.
func (h *AuthHandler) SendTestEmail(w http.ResponseWriter, r *http.Request) {
	if !h.emailEnabled() {
		http.Error(w, "Email is not configured", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		To string `json:"to"`
	}
	if !decodeEmailRequest(w, r, &req) {
		return
	}
	if _, err := mail.ParseAddress(req.To); err != nil {
		http.Error(w, "Invalid email address", http.StatusBadRequest)
		return
	}
	err := h.emailAuth.Mailer().SendNow(r.Context(), UserIDFromContext(r.Context()), req.To, mailsvc.PurposeTest, mailsvc.Data{}, "")
	if err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}
