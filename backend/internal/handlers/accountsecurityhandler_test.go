package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

func (e *emailHandlerEnv) sessionClaims(t *testing.T, user models.User) *models.JWTClaims {
	t.Helper()
	token, _, err := e.handler.authService.StartSession(&user, service.SessionMeta{})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := e.handler.authService.ValidateJWT(token)
	if err != nil {
		t.Fatal(err)
	}
	return claims
}

// tokenTo returns the token of the newest mail sent to addr.
func (e *emailHandlerEnv) tokenTo(t *testing.T, addr string) string {
	t.Helper()
	e.mailer.Wait()
	e.sender.mu.Lock()
	defer e.sender.mu.Unlock()
	for i := len(e.sender.sent) - 1; i >= 0; i-- {
		if e.sender.sent[i].To == addr {
			if m := regexp.MustCompile(`token=([A-Za-z0-9_-]+)`).FindStringSubmatch(e.sender.sent[i].Text); m != nil {
				return m[1]
			}
		}
	}
	t.Fatalf("no link mailed to %s", addr)
	return ""
}

func TestChangePasswordEndpoint(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	user := decodeLoginUser(t, postRegister(env.handler, true, "tara@example.com", "tara"))
	claims := env.sessionClaims(t, user)
	body := map[string]string{"current_password": "s3cret-pass!", "new_password": "n3w-passw0rd!"}

	if rec := postJSON(env.handler.ChangePassword, "/api/auth/password/change", body, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: %d", rec.Code)
	}
	legacy := &models.JWTClaims{UserID: user.ID}
	if rec := postJSON(env.handler.ChangePassword, "/api/auth/password/change", body, legacy); rec.Code != http.StatusConflict {
		t.Fatalf("legacy token: %d", rec.Code)
	}
	wrong := map[string]string{"current_password": "wrong-pass1!", "new_password": "n3w-passw0rd!"}
	if rec := postJSON(env.handler.ChangePassword, "/api/auth/password/change", wrong, claims); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong password: %d", rec.Code)
	}
	weak := map[string]string{"current_password": "s3cret-pass!", "new_password": "short"}
	if rec := postJSON(env.handler.ChangePassword, "/api/auth/password/change", weak, claims); rec.Code != http.StatusBadRequest {
		t.Fatalf("weak password: %d", rec.Code)
	}
	if rec := postJSON(env.handler.ChangePassword, "/api/auth/password/change", body, claims); rec.Code != http.StatusNoContent {
		t.Fatalf("change: %d %s", rec.Code, rec.Body.String())
	}
	if len(env.closer.closed) != 1 || env.closer.closed[0] != user.ID+"|"+claims.SessionID {
		t.Fatalf("closed = %v, want other sessions of %s", env.closer.closed, user.ID)
	}
}

func TestChangePasswordEndpointRejectsOAuth(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	u := &models.User{
		ID: "qkUrdzLDoqslx8EEy2cM7Q==", Nickname: "uma", OriginalNickname: "uma",
		AuthProvider: models.AuthProviderGoogle, ProviderID: "5678", Email: "uma@example.com",
		CreatedAt: time.Now(), LastSeen: time.Now(), Role: models.RoleUser,
	}
	if err := env.users.Create(u); err != nil {
		t.Fatal(err)
	}
	claims := env.sessionClaims(t, *u)
	body := map[string]string{"current_password": "x", "new_password": "n3w-passw0rd!"}
	if rec := postJSON(env.handler.ChangePassword, "/api/auth/password/change", body, claims); rec.Code != http.StatusBadRequest {
		t.Fatalf("OAuth: %d", rec.Code)
	}
}

func TestEmailChangeAndRestoreEndpoints(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	user := decodeLoginUser(t, postRegister(env.handler, true, "vera@example.com", "vera"))
	verifyToken := env.lastToken(t)
	if rec := postJSON(env.handler.VerifyEmail, "/api/auth/verify-email", map[string]string{"token": verifyToken}, nil); rec.Code != http.StatusOK {
		t.Fatalf("verify: %d", rec.Code)
	}
	claims := env.sessionClaims(t, user)

	req := map[string]string{"new_email": "vera2@example.com", "password": "s3cret-pass!"}
	rec := postJSON(env.handler.RequestEmailChange, "/api/auth/email/change", req, claims)
	if rec.Code != http.StatusOK {
		t.Fatalf("request: %d %s", rec.Code, rec.Body.String())
	}
	var started struct {
		Pending bool   `json:"pending"`
		Email   string `json:"email"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &started)
	if !started.Pending || started.Email != "vera@example.com" {
		t.Fatalf("request answer = %+v", started)
	}

	confirm := env.tokenTo(t, "vera2@example.com")
	rec = postJSON(env.handler.ConfirmEmailChange, "/api/auth/email/confirm", map[string]string{"token": confirm}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body.String())
	}
	if rec := postJSON(env.handler.ConfirmEmailChange, "/api/auth/email/confirm", map[string]string{"token": confirm}, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("reused confirm: %d", rec.Code)
	}

	undo := env.tokenTo(t, "vera@example.com")
	rec = postJSON(env.handler.RestoreEmail, "/api/auth/email/restore", map[string]string{"token": undo, "password": "n3w-passw0rd!"}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	var login models.LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &login); err != nil || login.Token == "" || login.User.Email != "vera@example.com" {
		t.Fatalf("restore answer = %+v, %v", login, err)
	}
	if len(env.closer.closed) != 1 || env.closer.closed[0] != user.ID+"|" {
		t.Fatalf("closed = %v, want every session of %s", env.closer.closed, user.ID)
	}
}

func TestEmailChangeWithoutSMTP(t *testing.T) {
	env := newEmailHandlerEnv(t, false)
	user := decodeLoginUser(t, postRegister(env.handler, true, "wren@example.com", "wren"))
	claims := env.sessionClaims(t, user)

	rec := postJSON(env.handler.RequestEmailChange, "/api/auth/email/change", map[string]string{"new_email": "wren2@example.com", "password": "s3cret-pass!"}, claims)
	if rec.Code != http.StatusOK {
		t.Fatalf("request: %d %s", rec.Code, rec.Body.String())
	}
	var answer struct {
		Pending bool   `json:"pending"`
		Email   string `json:"email"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	if answer.Pending || answer.Email != "wren2@example.com" {
		t.Fatalf("answer = %+v, want applied", answer)
	}
	if rec := postJSON(env.handler.ConfirmEmailChange, "/api/auth/email/confirm", map[string]string{"token": "x"}, nil); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("confirm without SMTP: %d", rec.Code)
	}
	if rec := postJSON(env.handler.RestoreEmail, "/api/auth/email/restore", map[string]string{"token": "x", "password": "n3w-passw0rd!"}, nil); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("restore without SMTP: %d", rec.Code)
	}
}

func TestEmailChangeTakenAddress(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	user := decodeLoginUser(t, postRegister(env.handler, true, "xena@example.com", "xena"))
	decodeLoginUser(t, postRegister(env.handler, true, "yara@example.com", "yara"))
	claims := env.sessionClaims(t, user)
	rec := postJSON(env.handler.RequestEmailChange, "/api/auth/email/change", map[string]string{"new_email": "YARA@example.com", "password": "s3cret-pass!"}, claims)
	if rec.Code != http.StatusConflict {
		t.Fatalf("taken: %d", rec.Code)
	}
	rec = postJSON(env.handler.RequestEmailChange, "/api/auth/email/change", map[string]string{"new_email": "x2@example.com", "password": "wrong-pass1!"}, claims)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("wrong password: %d", rec.Code)
	}
}
