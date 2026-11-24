package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/service/mail"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type handlerMailSender struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (s *handlerMailSender) Send(_ context.Context, msg mail.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, msg)
	return nil
}

type closeAllRecorder struct {
	mu     sync.Mutex
	closed []string
}

func (c *closeAllRecorder) CloseSessions(userID string, _ []string) {}
func (c *closeAllRecorder) CloseOtherSessions(userID, keep string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = append(c.closed, userID+"|"+keep)
}

type emailHandlerEnv struct {
	handler *AuthHandler
	mailer  *mail.Mailer
	sender  *handlerMailSender
	closer  *closeAllRecorder
	users   *repository.UserRepository
}

func newEmailHandlerEnv(t *testing.T, withSMTP bool) *emailHandlerEnv {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	users := repository.NewUserRepository(db)
	auth := service.NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, users)
	auth.SetSessionRepository(repository.NewAuthSessionRepository(db))
	handler := NewAuthHandler(auth, service.NewRoleService(users), "", "")
	closer := &closeAllRecorder{}
	handler.SetSessionHooks(nil, closer)

	sender := &handlerMailSender{}
	var s mail.Sender
	if withSMTP {
		s = sender
	}
	logs := repository.NewEmailLogRepository(db)
	mailer := mail.NewMailer(s, logs, "Orbital")
	handler.SetEmailAuth(service.NewEmailAuthService(users, repository.NewEmailTokenRepository(db), logs, auth, mailer, "https://orb.example.com"))
	return &emailHandlerEnv{handler: handler, mailer: mailer, sender: sender, closer: closer, users: users}
}

func (e *emailHandlerEnv) lastToken(t *testing.T) string {
	t.Helper()
	e.mailer.Wait()
	e.sender.mu.Lock()
	defer e.sender.mu.Unlock()
	if len(e.sender.sent) == 0 {
		t.Fatal("no mail sent")
	}
	m := regexp.MustCompile(`token=([A-Za-z0-9_-]+)`).FindStringSubmatch(e.sender.sent[len(e.sender.sent)-1].Text)
	if m == nil {
		t.Fatal("no token in mail")
	}
	return m[1]
}

func postJSON(h http.HandlerFunc, path string, body interface{}, claims *models.JWTClaims) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	if claims != nil {
		req = req.WithContext(context.WithValue(req.Context(), userContextKey, claims))
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestRegisterSendsVerificationAndVerifyEndpoint(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	user := decodeLoginUser(t, postRegister(env.handler, true, "alice@example.com", "alice"))
	if user.EmailVerified {
		t.Fatal("registered user must start unverified")
	}
	token := env.lastToken(t)

	if rec := postJSON(env.handler.VerifyEmail, "/api/auth/verify-email", map[string]string{"token": "nope"}, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad token: %d", rec.Code)
	}
	if rec := postJSON(env.handler.VerifyEmail, "/api/auth/verify-email", map[string]string{"token": token}, nil); rec.Code != http.StatusOK {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
	}
	stored, _ := env.users.GetByID(user.ID)
	if !stored.EmailVerified {
		t.Fatal("not verified after the link")
	}
	// Resend once verified is a conflict.
	rec := postJSON(env.handler.ResendVerification, "/api/auth/verify-email/resend", nil, &models.JWTClaims{UserID: user.ID})
	if rec.Code != http.StatusConflict {
		t.Fatalf("resend after verify: %d", rec.Code)
	}
}

func TestForgotPasswordSameAnswerForUnknownEmail(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	decodeLoginUser(t, postRegister(env.handler, true, "bob@example.com", "bob"))

	var bodies []string
	for _, email := range []string{"nobody@example.com", "bob@example.com"} {
		start := time.Now()
		rec := postJSON(env.handler.ForgotPassword, "/api/auth/password/forgot", map[string]string{"email": email}, nil)
		if elapsed := time.Since(start); elapsed < 400*time.Millisecond {
			t.Fatalf("%s answered after %v, want >= 400ms", email, elapsed)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d", email, rec.Code)
		}
		bodies = append(bodies, rec.Body.String())
	}
	if bodies[0] != bodies[1] {
		t.Fatalf("answers differ: %q vs %q", bodies[0], bodies[1])
	}
}

func TestResetPasswordEndpointSignsOutEverywhere(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	user := decodeLoginUser(t, postRegister(env.handler, true, "carol@example.com", "carol"))
	postJSON(env.handler.VerifyEmail, "/api/auth/verify-email", map[string]string{"token": env.lastToken(t)}, nil)

	postJSON(env.handler.ForgotPassword, "/api/auth/password/forgot", map[string]string{"email": "carol@example.com"}, nil)
	// The lookup runs in the background after the answer.
	deadline := time.Now().Add(3 * time.Second)
	for {
		env.mailer.Wait()
		env.sender.mu.Lock()
		n := len(env.sender.sent)
		env.sender.mu.Unlock()
		if n == 2 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	token := env.lastToken(t)

	rec := postJSON(env.handler.ResetPassword, "/api/auth/password/reset", map[string]string{"token": token, "password": "weak"}, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("weak password: %d", rec.Code)
	}
	rec = postJSON(env.handler.ResetPassword, "/api/auth/password/reset", map[string]string{"token": token, "password": "n3w-passw0rd!"}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", rec.Code, rec.Body.String())
	}
	var resp models.LoginResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil || resp.Token == "" {
		t.Fatalf("reset response: %+v, %v", resp, err)
	}
	if len(env.closer.closed) != 1 || env.closer.closed[0] != user.ID+"|" {
		t.Fatalf("sockets closed = %v, want all of %s", env.closer.closed, user.ID)
	}
}

func TestEmailEndpointsDisabledWithoutSMTP(t *testing.T) {
	env := newEmailHandlerEnv(t, false)
	for name, h := range map[string]http.HandlerFunc{
		"forgot": env.handler.ForgotPassword,
		"reset":  env.handler.ResetPassword,
		"verify": env.handler.VerifyEmail,
	} {
		if rec := postJSON(h, "/x", map[string]string{"email": "a@example.com", "token": "t"}, nil); rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s without SMTP: %d, want 503", name, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	env.handler.GetAuthStatus(rec, httptest.NewRequest(http.MethodGet, "/api/auth/status", nil))
	var status map[string]interface{}
	_ = json.NewDecoder(rec.Body).Decode(&status)
	if status["email_enabled"] != false {
		t.Fatalf("status = %v", status)
	}
}

func TestEmailLogSuperAdminOnly(t *testing.T) {
	env := newEmailHandlerEnv(t, true)
	list := env.handler.RequireSuperAdmin(http.HandlerFunc(env.handler.ListEmailLog))

	call := func(role string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/admin/emails", nil)
		req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{UserID: "qkUrdzLDoqslx8EEy2cM7Q==", Role: role}))
		rec := httptest.NewRecorder()
		list.ServeHTTP(rec, req)
		return rec
	}
	if rec := call(models.RoleUser); rec.Code != http.StatusForbidden {
		t.Fatalf("user: %d, want 403", rec.Code)
	}

	decodeLoginUser(t, postRegister(env.handler, true, "dave@example.com", "dave"))
	token := env.lastToken(t)
	rec := call(models.RoleSuperAdmin)
	if rec.Code != http.StatusOK {
		t.Fatalf("super admin: %d", rec.Code)
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(token)) {
		t.Fatal("email log exposes a live token")
	}
	var resp struct {
		Enabled bool                   `json:"enabled"`
		Entries []models.EmailLogEntry `json:"entries"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	if !resp.Enabled || len(resp.Entries) != 1 || resp.Entries[0].Purpose != mail.PurposeVerify {
		t.Fatalf("log = %+v", resp)
	}
}
