package handlers

import (
	"bytes"
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
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func newTestAdminHandler(t *testing.T) (*AdminHandler, *repository.UserRepository, *models.User) {
	t.Helper()
	return newTestAdminHandlerWithDebugQuota(t, 100*1024*1024)
}

func newTestAdminHandlerWithDebugQuota(t *testing.T, quota int64) (*AdminHandler, *repository.UserRepository, *models.User) {
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
	user := &models.User{
		ID:               "user-1",
		Nickname:         "Alice",
		OriginalNickname: "Alice",
		CreatedAt:        time.Now(),
		LastSeen:         time.Now(),
		AuthProvider:     models.AuthProviderPassword,
		Role:             models.RoleUser,
	}
	if err := userRepo.Create(user); err != nil {
		t.Fatalf("Create user: %v", err)
	}

	debugService := service.NewDebugLogService(repository.NewDebugLogRepository(db), t.TempDir(), quota)
	return NewAdminHandlerWithHub(nil, userRepo, debugService, nil, nil, nil), userRepo, user
}

func TestUploadDebugLogUsesAuthenticatedIdentity(t *testing.T) {
	handler, _, user := newTestAdminHandler(t)

	body, err := json.Marshal(models.DebugLogUploadRequest{
		UserID:     "victim",
		Username:   "Mallory",
		Version:    "1.0",
		SystemInfo: "test",
		Logs:       "log contents",
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/logs", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{
		UserID:   user.ID,
		Nickname: user.Nickname,
	}))
	rec := httptest.NewRecorder()
	handler.UploadDebugLog(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}

	logs, err := handler.debugLogService.GetAllLogs()
	if err != nil {
		t.Fatalf("GetAllLogs: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("log count = %d, want 1", len(logs))
	}
	if logs[0].UserID != user.ID {
		t.Errorf("log user_id = %q, want %q", logs[0].UserID, user.ID)
	}
	if logs[0].Username != user.Nickname {
		t.Errorf("log username = %q, want %q", logs[0].Username, user.Nickname)
	}
}

func TestUploadDebugLogRejectsQuotaExceeded(t *testing.T) {
	handler, _, user := newTestAdminHandlerWithDebugQuota(t, 4)

	body, err := json.Marshal(models.DebugLogUploadRequest{
		Version:    "1.0",
		SystemInfo: "test",
		Logs:       "12345",
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/logs", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{
		UserID:   user.ID,
		Nickname: user.Nickname,
	}))
	rec := httptest.NewRecorder()
	handler.UploadDebugLog(rec, req)

	if rec.Code != http.StatusInsufficientStorage {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusInsufficientStorage, rec.Body.String())
	}
}

func TestUploadDebugLogRejectsOversizedBody(t *testing.T) {
	handler, _, user := newTestAdminHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/logs", strings.NewReader("{}"))
	req.ContentLength = service.MaxDebugLogSize + 1
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{
		UserID:   user.ID,
		Nickname: user.Nickname,
	}))
	rec := httptest.NewRecorder()
	handler.UploadDebugLog(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
}
