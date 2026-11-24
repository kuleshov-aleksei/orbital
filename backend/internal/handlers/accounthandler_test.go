package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type fakeAccountLive struct{ deleted []string }

func (f *fakeAccountLive) AccountDeleted(userID string) { f.deleted = append(f.deleted, userID) }

type accountTestEnv struct {
	db       *storage.DB
	handler  *AuthHandler
	auth     *service.AuthService
	userRepo *repository.UserRepository
	live     *fakeAccountLive
}

func newAccountTestEnv(t *testing.T) *accountTestEnv {
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
	authService := service.NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, userRepo)
	handler := NewAuthHandler(authService, service.NewRoleService(userRepo), "", "")
	debugLogs := service.NewDebugLogService(repository.NewDebugLogRepository(db), t.TempDir(), 1<<20)
	accounts := service.NewAccountService(userRepo, debugLogs, nil)
	live := &fakeAccountLive{}
	accounts.SetLive(live)
	handler.SetAccountService(accounts)
	return &accountTestEnv{db: db, handler: handler, auth: authService, userRepo: userRepo, live: live}
}

func (e *accountTestEnv) register(t *testing.T, email, nickname string) (models.User, string) {
	t.Helper()
	rec := postRegister(e.handler, true, email, nickname)
	if rec.Code != http.StatusOK {
		t.Fatalf("register %s: status %d (%s)", nickname, rec.Code, rec.Body.String())
	}
	var resp models.LoginResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp.User, resp.Token
}

func (e *accountTestEnv) deleteAccount(userID string, body deleteAccountRequest) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/auth/account", bytes.NewReader(raw))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{UserID: userID}))
	rec := httptest.NewRecorder()
	e.handler.DeleteAccount(rec, req)
	return rec
}

func (e *accountTestEnv) count(t *testing.T, query string, args ...interface{}) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func TestDeleteAccount_ErasesPersonalDataAndKeepsTombstone(t *testing.T) {
	env := newAccountTestEnv(t)
	owner, _ := env.register(t, "owner@example.com", "Owner") // first account becomes super_admin
	user, token := env.register(t, "alice@example.com", "Alice")
	const roomID = "20261110145113MiTbtB"

	seed := []string{
		`INSERT INTO auth_sessions (id, user_id, created_at, last_active_at, expires_at, ip) VALUES ('sid-qkUrdzLDoqslx8EEy2cM7Q==', ?, 1, 1, 9999999999999, '203.0.113.7')`,
		`INSERT INTO push_devices (token, user_id, platform, created_at, last_seen_at) VALUES ('fcm-token', ?, 'android', 1, 1)`,
		`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'admin')`,
		`INSERT INTO user_color_roles (user_id, role_id) VALUES (?, 'admin')`,
		`INSERT INTO user_badges (user_id, badge_id, assigned_at) VALUES (?, 'badge1', CURRENT_TIMESTAMP)`,
		`INSERT INTO permission_overwrites (target_type, target_id, subject_type, subject_id, allow, deny) VALUES ('room', '` + roomID + `', 'user', ?, 1, 0)`,
		`INSERT INTO text_read_state (user_id, room_id, last_read_seq, updated_at) VALUES (?, '` + roomID + `', 5, 1)`,
		`INSERT INTO text_notify_settings (user_id, room_id, mode, updated_at) VALUES (?, '` + roomID + `', 'muted', 1)`,
		`INSERT INTO chat_reminders (user_id, room_id, message_id, due_at, note, created_at) VALUES (?, '` + roomID + `', 'm1', 1, 'note', 1)`,
		`INSERT INTO qr_login_challenges (id, public_key, approved_by_user_id, sealed_payload, created_at, expires_at) VALUES ('qr1', 'pk', ?, 'sealed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		`INSERT INTO user_sessions (user_id, room_id, first_seen, last_seen, platform, system_name, device_info) VALUES (?, '` + roomID + `', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'linux', 'Arch', '{"app_version":"1.2.3"}')`,
		`INSERT INTO soundboard_sounds (id, name, filename, format, uploaded_by, created_at) VALUES ('snd1', 'Airhorn', 'a.ogg', 'ogg', ?, CURRENT_TIMESTAMP)`,
	}
	for _, stmt := range seed {
		if _, err := env.db.Exec(stmt, user.ID); err != nil {
			t.Fatalf("seed %q: %v", stmt, err)
		}
	}
	// A badge Alice awarded to the owner stays the owner's.
	if _, err := env.db.Exec(`INSERT INTO user_badges (user_id, badge_id, assigned_by, assigned_at) VALUES (?, 'badge1', ?, CURRENT_TIMESTAMP)`, owner.ID, user.ID); err != nil {
		t.Fatalf("seed owner badge: %v", err)
	}
	if _, err := service.NewDebugLogService(repository.NewDebugLogRepository(env.db), t.TempDir(), 1<<20).SaveLog(user.ID, "Alice", "1.0", "", "log"); err != nil {
		t.Fatalf("seed debug log: %v", err)
	}

	if rec := env.deleteAccount(user.ID, deleteAccountRequest{Password: "wrong"}); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong password: status %d, want 403", rec.Code)
	}
	if rec := env.deleteAccount(user.ID, deleteAccountRequest{Password: "s3cret-pass!"}); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: status %d (%s), want 204", rec.Code, rec.Body.String())
	}

	for _, table := range []string{"auth_sessions", "push_devices", "user_roles", "user_color_roles", "text_read_state", "text_notify_settings", "chat_reminders", "debug_logs"} {
		if n := env.count(t, `SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, user.ID); n != 0 {
			t.Errorf("%s: %d rows left", table, n)
		}
	}
	if n := env.count(t, `SELECT COUNT(*) FROM user_badges WHERE user_id = ?`, user.ID); n != 0 {
		t.Errorf("user_badges: %d rows left", n)
	}
	if n := env.count(t, `SELECT COUNT(*) FROM user_badges WHERE user_id = ?`, owner.ID); n != 1 {
		t.Errorf("owner's badge awarded by the deleted user: %d rows, want 1", n)
	}
	if n := env.count(t, `SELECT COUNT(*) FROM permission_overwrites WHERE subject_id = ?`, user.ID); n != 0 {
		t.Errorf("permission_overwrites: %d rows left", n)
	}
	if n := env.count(t, `SELECT COUNT(*) FROM qr_login_challenges WHERE approved_by_user_id = ?`, user.ID); n != 0 {
		t.Errorf("qr_login_challenges: %d rows left", n)
	}
	// Kept: call stats (device info included) and uploads, under the tombstone id.
	if n := env.count(t, `SELECT COUNT(*) FROM user_sessions WHERE user_id = ? AND device_info != ''`, user.ID); n != 1 {
		t.Errorf("user_sessions: %d rows, want 1 kept with device info", n)
	}
	if n := env.count(t, `SELECT COUNT(*) FROM soundboard_sounds WHERE uploaded_by = ?`, user.ID); n != 1 {
		t.Errorf("soundboard_sounds: %d rows, want 1 kept", n)
	}

	tomb, err := env.userRepo.GetByID(user.ID)
	if err != nil || tomb == nil {
		t.Fatalf("tombstone missing: %v", err)
	}
	if tomb.DeletedAt == nil || tomb.Nickname != repository.DeletedNickname || tomb.Email != "" ||
		tomb.PasswordHash != "" || tomb.OriginalNickname != "" || tomb.AuthProvider != models.AuthProviderDeleted {
		t.Errorf("tombstone not scrubbed: %+v", tomb)
	}
	all, _ := env.userRepo.GetAll()
	for _, u := range all {
		if u.ID == user.ID {
			t.Errorf("GetAll lists the deleted account")
		}
	}
	if len(env.live.deleted) != 1 || env.live.deleted[0] != user.ID {
		t.Errorf("live teardown = %v, want [%s]", env.live.deleted, user.ID)
	}

	// The old token no longer works.
	claims, err := env.auth.ValidateJWT(token)
	if err == nil {
		if err := env.auth.CheckSession(claims, tomb); err == nil {
			t.Errorf("token of the deleted account still passes CheckSession")
		}
	}

	// Email and nickname are free again.
	again, _ := env.register(t, "alice@example.com", "Alice")
	if again.ID == user.ID {
		t.Errorf("re-registration reused the tombstone id")
	}
}

func TestDeleteAccount_OwnerRefused(t *testing.T) {
	env := newAccountTestEnv(t)
	owner, _ := env.register(t, "owner@example.com", "Owner")
	if owner.Role != models.RoleSuperAdmin {
		t.Fatalf("first account role = %q, want super_admin", owner.Role)
	}
	if rec := env.deleteAccount(owner.ID, deleteAccountRequest{Password: "s3cret-pass!"}); rec.Code != http.StatusForbidden {
		t.Fatalf("owner delete: status %d, want 403", rec.Code)
	}
	if u, _ := env.userRepo.GetByID(owner.ID); u == nil || u.DeletedAt != nil {
		t.Fatalf("owner account was deleted")
	}
}

func TestDeleteAccount_NicknameConfirmationForNonPasswordAccounts(t *testing.T) {
	user := &models.User{ID: "qkUrdzLDoqslx8EEy2cM7Q==", Nickname: "Bob", AuthProvider: models.AuthProviderDiscord}
	if err := service.ConfirmDelete(user, "", "bob"); err == nil {
		t.Errorf("wrong-case nickname accepted")
	}
	if err := service.ConfirmDelete(user, "", ""); err == nil {
		t.Errorf("empty confirmation accepted")
	}
	if err := service.ConfirmDelete(user, "", "Bob"); err != nil {
		t.Errorf("matching nickname refused: %v", err)
	}
}
