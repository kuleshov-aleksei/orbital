package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type recordingCloser struct {
	closed      [][]string
	closeOthers []string
}

func (c *recordingCloser) CloseSessions(_ string, ids []string) { c.closed = append(c.closed, ids) }
func (c *recordingCloser) CloseOtherSessions(_, keep string)    { c.closeOthers = append(c.closeOthers, keep) }

type sessionTestEnv struct {
	router  *mux.Router
	auth    *service.AuthService
	push    *repository.PushDeviceRepository
	closer  *recordingCloser
	alice   *models.User
	mallory *models.User
}

func newSessionTestEnv(t *testing.T) *sessionTestEnv {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	userRepo := repository.NewUserRepository(db)
	mkUser := func(id, nick string) *models.User {
		u := &models.User{
			ID: id, Nickname: nick, OriginalNickname: nick,
			CreatedAt: time.Now(), LastSeen: time.Now(),
			AuthProvider: models.AuthProviderPassword, Role: models.RoleUser,
		}
		if err := userRepo.Create(u); err != nil {
			t.Fatalf("Create user: %v", err)
		}
		return u
	}

	auth := service.NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, userRepo)
	auth.SetSessionRepository(repository.NewAuthSessionRepository(db))
	push := repository.NewPushDeviceRepository(db)
	closer := &recordingCloser{}
	h := NewAuthHandler(auth, nil, "", "")
	h.SetSessionHooks(push, closer)

	r := mux.NewRouter()
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Handle("/api/auth/me", h.AuthMiddleware(ok)).Methods("GET")
	r.Handle("/api/auth/logout", h.AuthMiddleware(http.HandlerFunc(h.Logout))).Methods("POST")
	r.Handle("/api/auth/refresh", h.AuthMiddleware(http.HandlerFunc(h.RefreshToken))).Methods("POST")
	r.Handle("/api/auth/sessions", h.AuthMiddleware(http.HandlerFunc(h.ListSessions))).Methods("GET")
	r.Handle("/api/auth/sessions/revoke-others", h.AuthMiddleware(http.HandlerFunc(h.RevokeOtherSessions))).Methods("POST")
	r.Handle("/api/auth/sessions/{id}", h.AuthMiddleware(http.HandlerFunc(h.RevokeSession))).Methods("DELETE")

	return &sessionTestEnv{
		router: r, auth: auth, push: push, closer: closer,
		alice:   mkUser("qkUrdzLDoqslx8EEy2cM7Q==", "Alice"),
		mallory: mkUser("Z9n-x_2LDoqslx8EEy2cM7Q=", "Mallory"),
	}
}

const chromeOnWindows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

func (e *sessionTestEnv) login(t *testing.T, u *models.User, ua string) string {
	t.Helper()
	token, _, err := e.auth.StartSession(u, service.SessionMeta{UserAgent: ua, IP: "192.0.2.10"})
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	return token
}

func (e *sessionTestEnv) call(method, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func (e *sessionTestEnv) sessions(t *testing.T, token string) []models.AuthSessionInfo {
	t.Helper()
	rec := e.call(http.MethodGet, "/api/auth/sessions", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("list sessions status = %d (%s)", rec.Code, rec.Body.String())
	}
	var out []models.AuthSessionInfo
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}
	return out
}

func sidOf(t *testing.T, auth *service.AuthService, token string) string {
	t.Helper()
	claims, err := auth.ValidateJWT(token)
	if err != nil || claims.SessionID == "" {
		t.Fatalf("token has no session: %v", err)
	}
	return claims.SessionID
}

func TestLogoutEndsOnlyCurrentDevice(t *testing.T) {
	e := newSessionTestEnv(t)
	laptop := e.login(t, e.alice, chromeOnWindows)
	phone := e.login(t, e.alice, "")
	if err := e.push.Upsert("fcm-phone", e.alice.ID, "android", sidOf(t, e.auth, phone)); err != nil {
		t.Fatal(err)
	}

	if rec := e.call(http.MethodPost, "/api/auth/logout", phone); rec.Code != http.StatusOK {
		t.Fatalf("logout status = %d", rec.Code)
	}
	if rec := e.call(http.MethodGet, "/api/auth/me", phone); rec.Code != http.StatusUnauthorized {
		t.Fatalf("logged-out token status = %d, want 401", rec.Code)
	}
	if rec := e.call(http.MethodGet, "/api/auth/me", laptop); rec.Code != http.StatusOK {
		t.Fatalf("other device status = %d, want 200 (logout must not sign out other devices)", rec.Code)
	}
	if tokens, _ := e.push.TokensForUser(e.alice.ID); len(tokens) != 0 {
		t.Fatalf("push token of the logged-out device survived: %v", tokens)
	}
	if len(e.closer.closed) != 1 || e.closer.closed[0][0] != sidOf(t, e.auth, phone) {
		t.Fatalf("sockets closed = %v, want the phone session", e.closer.closed)
	}
}

func TestListSessions(t *testing.T) {
	e := newSessionTestEnv(t)
	laptop := e.login(t, e.alice, chromeOnWindows)
	e.login(t, e.alice, "")
	e.login(t, e.mallory, chromeOnWindows)

	list := e.sessions(t, laptop)
	if len(list) != 2 {
		t.Fatalf("listed %d sessions, want alice's 2", len(list))
	}
	current := 0
	for _, s := range list {
		if s.Current {
			current++
			if s.DeviceName != "Chrome on Windows" || s.Platform != "web" || s.IP != "192.0.2.10" {
				t.Errorf("current session = %+v", s)
			}
		}
		if s.LastActiveAt.IsZero() {
			t.Errorf("session %s has no last_active_at", s.ID)
		}
	}
	if current != 1 {
		t.Fatalf("%d sessions marked current, want 1", current)
	}
}

func TestRevokeSession(t *testing.T) {
	e := newSessionTestEnv(t)
	laptop := e.login(t, e.alice, chromeOnWindows)
	phone := e.login(t, e.alice, "")
	mallory := e.login(t, e.mallory, chromeOnWindows)
	phoneSID := sidOf(t, e.auth, phone)

	if rec := e.call(http.MethodDelete, "/api/auth/sessions/"+phoneSID, mallory); rec.Code != http.StatusNotFound {
		t.Fatalf("revoking another user's session status = %d, want 404", rec.Code)
	}
	if rec := e.call(http.MethodDelete, "/api/auth/sessions/"+sidOf(t, e.auth, laptop), laptop); rec.Code != http.StatusBadRequest {
		t.Fatalf("revoking the current session status = %d, want 400", rec.Code)
	}
	if rec := e.call(http.MethodGet, "/api/auth/me", phone); rec.Code != http.StatusOK {
		t.Fatalf("phone status = %d before revoke", rec.Code)
	}
	if rec := e.call(http.MethodDelete, "/api/auth/sessions/"+phoneSID, laptop); rec.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, want 204", rec.Code)
	}
	if rec := e.call(http.MethodGet, "/api/auth/me", phone); rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked phone status = %d, want 401", rec.Code)
	}
	if rec := e.call(http.MethodGet, "/api/auth/me", laptop); rec.Code != http.StatusOK {
		t.Fatalf("laptop status = %d, want 200", rec.Code)
	}
}

func TestRevokeOtherSessions(t *testing.T) {
	e := newSessionTestEnv(t)
	laptop := e.login(t, e.alice, chromeOnWindows)
	phone := e.login(t, e.alice, "")
	legacy, _, err := e.auth.GenerateJWT(e.alice) // issued before sessions existed
	if err != nil {
		t.Fatal(err)
	}
	mallory := e.login(t, e.mallory, chromeOnWindows)
	if err := e.push.Upsert("fcm-laptop", e.alice.ID, "android", sidOf(t, e.auth, laptop)); err != nil {
		t.Fatal(err)
	}
	if err := e.push.Upsert("fcm-legacy", e.alice.ID, "android", ""); err != nil {
		t.Fatal(err)
	}

	if rec := e.call(http.MethodGet, "/api/auth/me", legacy); rec.Code != http.StatusOK {
		t.Fatalf("legacy token status = %d, want 200 until revoked", rec.Code)
	}
	if rec := e.call(http.MethodPost, "/api/auth/sessions/revoke-others", legacy); rec.Code != http.StatusConflict {
		t.Fatalf("revoke-others from a legacy token status = %d, want 409", rec.Code)
	}

	if rec := e.call(http.MethodPost, "/api/auth/sessions/revoke-others", laptop); rec.Code != http.StatusOK {
		t.Fatalf("revoke-others status = %d", rec.Code)
	}
	for name, token := range map[string]string{"phone": phone, "legacy": legacy} {
		if rec := e.call(http.MethodGet, "/api/auth/me", token); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s status = %d after revoke-others, want 401", name, rec.Code)
		}
	}
	if rec := e.call(http.MethodGet, "/api/auth/me", laptop); rec.Code != http.StatusOK {
		t.Fatalf("current session status = %d, want 200", rec.Code)
	}
	if rec := e.call(http.MethodGet, "/api/auth/me", mallory); rec.Code != http.StatusOK {
		t.Fatalf("other user's session status = %d, want 200", rec.Code)
	}
	if tokens, _ := e.push.TokensForUser(e.alice.ID); len(tokens) != 1 || tokens[0] != "fcm-laptop" {
		t.Fatalf("push tokens after revoke-others = %v, want [fcm-laptop]", tokens)
	}
	if len(e.closer.closeOthers) != 1 || e.closer.closeOthers[0] != sidOf(t, e.auth, laptop) {
		t.Fatalf("CloseOtherSessions calls = %v", e.closer.closeOthers)
	}
	if list := e.sessions(t, laptop); len(list) != 1 || !list[0].Current {
		t.Fatalf("sessions after revoke-others = %+v, want only the current one", list)
	}
}

func TestRefreshKeepsSessionAndUpgradesLegacy(t *testing.T) {
	e := newSessionTestEnv(t)
	laptop := e.login(t, e.alice, chromeOnWindows)

	refresh := func(token string) string {
		t.Helper()
		rec := e.call(http.MethodPost, "/api/auth/refresh", token)
		if rec.Code != http.StatusOK {
			t.Fatalf("refresh status = %d (%s)", rec.Code, rec.Body.String())
		}
		var resp models.AuthResponse
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		return resp.Token
	}

	if got := sidOf(t, e.auth, refresh(laptop)); got != sidOf(t, e.auth, laptop) {
		t.Fatalf("refresh changed the session id: %q -> %q", sidOf(t, e.auth, laptop), got)
	}

	legacy, _, _ := e.auth.GenerateJWT(e.alice)
	upgraded := refresh(legacy)
	sidOf(t, e.auth, upgraded) // fails when the refreshed token has no session
	if list := e.sessions(t, upgraded); len(list) != 2 {
		t.Fatalf("sessions after legacy upgrade = %d, want 2", len(list))
	}
}
