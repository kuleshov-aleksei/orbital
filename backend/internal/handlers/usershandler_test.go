package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func newUsersHandlerForTest(t *testing.T) (*UsersHandler, *repository.UserRepository) {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	repo := repository.NewUserRepository(db)
	return NewUsersHandler(repo, nil), repo
}

func patchCustomStatus(h *UsersHandler, userID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, "/api/users/me/custom-status", strings.NewReader(body))
	if userID != "" {
		req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{UserID: userID}))
	}
	rec := httptest.NewRecorder()
	h.UpdateCustomStatus(rec, req)
	return rec
}

func TestUpdateCustomStatusPersistsAndIsPublic(t *testing.T) {
	h, repo := newUsersHandlerForTest(t)
	created := time.Date(2025, 3, 14, 12, 0, 0, 0, time.UTC)
	if err := repo.Create(&models.User{ID: "u1", Nickname: "alice", CreatedAt: created, LastSeen: created, Role: models.RoleUser}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	rec := patchCustomStatus(h, "u1", `{"custom_status":"  grinding\nranked  ","custom_status_emoji":"🎮"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	listRec := httptest.NewRecorder()
	h.GetAllUsers(listRec, httptest.NewRequest(http.MethodGet, "/api/users", nil))
	var users []models.PublicUser
	if err := json.Unmarshal(listRec.Body.Bytes(), &users); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("got %d users, want 1", len(users))
	}
	if users[0].CustomStatusEmoji != "🎮" {
		t.Errorf("custom_status_emoji = %q, want 🎮", users[0].CustomStatusEmoji)
	}
	if users[0].CustomStatus != "grinding ranked" {
		t.Errorf("custom_status = %q, want %q", users[0].CustomStatus, "grinding ranked")
	}
	if !users[0].CreatedAt.Equal(created) {
		t.Errorf("created_at = %v, want %v", users[0].CreatedAt, created)
	}

	// Clearing the status
	if rec := patchCustomStatus(h, "u1", `{"custom_status":""}`); rec.Code != http.StatusOK {
		t.Fatalf("clear status = %d", rec.Code)
	}
	user, _ := repo.GetByID("u1")
	if user.CustomStatus != "" || user.CustomStatusEmoji != "" {
		t.Errorf("status after clear = %q %q, want empty", user.CustomStatus, user.CustomStatusEmoji)
	}
}

func TestUpdateCustomStatusValidation(t *testing.T) {
	h, _ := newUsersHandlerForTest(t)

	if rec := patchCustomStatus(h, "", `{"custom_status":"x"}`); rec.Code != http.StatusUnauthorized {
		t.Errorf("no auth: status = %d, want 401", rec.Code)
	}

	tooLong := strings.Repeat("я", models.MaxCustomStatusLength+1)
	if rec := patchCustomStatus(h, "u1", `{"custom_status":"`+tooLong+`"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("too long: status = %d, want 400", rec.Code)
	}

	if rec := patchCustomStatus(h, "u1", `not json`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad json: status = %d, want 400", rec.Code)
	}
}

func TestNormalizeCustomStatus(t *testing.T) {
	cases := map[string]string{
		"  hi  ":    "hi",
		"a\nb\tc":   "a b c",
		"bell\x07":  "bell",
		"🎮 playing": "🎮 playing",
		"\n\n":      "",
	}
	for in, want := range cases {
		if got := normalizeCustomStatus(in); got != want {
			t.Errorf("normalizeCustomStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUpdateCustomStatusRejectsBadEmoji(t *testing.T) {
	h, _ := newUsersHandlerForTest(t)
	for _, emoji := range []string{"abc", "custom:party", "🎮 🎮", "!!"} {
		rec := patchCustomStatus(h, "u1", `{"custom_status":"hi","custom_status_emoji":"`+emoji+`"}`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("emoji %q: status = %d, want 400", emoji, rec.Code)
		}
	}
}

type fakeEmojiLookup map[string]bool

func (f fakeEmojiLookup) EmojiExists(id string) bool { return f[id] }

func TestUpdateCustomStatusAcceptsKnownCustomEmoji(t *testing.T) {
	h, repo := newUsersHandlerForTest(t)
	now := time.Now()
	if err := repo.Create(&models.User{ID: "u1", Nickname: "alice", CreatedAt: now, LastSeen: now, Role: models.RoleUser}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	h.SetEmojiLookup(fakeEmojiLookup{"party": true})
	if rec := patchCustomStatus(h, "u1", `{"custom_status":"hi","custom_status_emoji":"custom:party"}`); rec.Code != http.StatusOK {
		t.Fatalf("known custom emoji: %d %s", rec.Code, rec.Body.String())
	}
	if rec := patchCustomStatus(h, "u1", `{"custom_status":"hi","custom_status_emoji":"custom:nope"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown custom emoji: %d, want 400", rec.Code)
	}
}

func TestValidateStatusEmojiAcceptsCommonForms(t *testing.T) {
	valid := []string{
		"",
		"🎮",
		"❤️",      // variation selector
		"👍🏽",      // skin tone modifier
		"👨‍👩‍👧‍👦", // ZWJ family
		"🇺🇦",      // regional indicator flag
		"1️⃣",     // keycap
		"🏴\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F", // England tag flag
		"☕",
	}
	for _, emoji := range valid {
		if err := validateStatusEmoji(emoji); err != nil {
			t.Errorf("validateStatusEmoji(%q) = %v, want nil", emoji, err)
		}
	}
}
