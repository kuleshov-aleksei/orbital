package service

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func newQuotaTestDB(t *testing.T) *storage.DB {
	t.Helper()

	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	return db
}

func TestAudioUploadQuota(t *testing.T) {
	db := newQuotaTestDB(t)
	svc := NewAudioService(repository.NewAudioRepository(db), t.TempDir(), 10)

	if _, err := svc.UploadAudio("user-1", []byte("ID3abc"), "first"); err != nil {
		t.Fatalf("first upload: %v", err)
	}
	if _, err := svc.UploadAudio("user-1", []byte("ID3abc"), "second"); !errors.Is(err, ErrAudioQuotaExceeded) {
		t.Fatalf("second upload error = %v, want %v", err, ErrAudioQuotaExceeded)
	}
}

func TestDebugLogUploadQuota(t *testing.T) {
	db := newQuotaTestDB(t)
	svc := NewDebugLogService(repository.NewDebugLogRepository(db), t.TempDir(), 10)

	if _, err := svc.SaveLog("user-1", "Alice", "1", "test", "123456"); err != nil {
		t.Fatalf("first save: %v", err)
	}
	if _, err := svc.SaveLog("user-1", "Alice", "1", "test", "123456"); !errors.Is(err, ErrDebugLogQuotaExceeded) {
		t.Fatalf("second save error = %v, want %v", err, ErrDebugLogQuotaExceeded)
	}
}

func TestDebugLogBackfillCountsExistingFiles(t *testing.T) {
	db := newQuotaTestDB(t)
	dataDir := t.TempDir()
	repo := repository.NewDebugLogRepository(db)

	logsDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	filename := "legacy.log"
	if err := os.WriteFile(filepath.Join(logsDir, filename), []byte("1234567890"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	legacy := &models.DebugLog{
		UserID:      "user-1",
		Username:    "Alice",
		Version:     "1",
		SystemInfo:  "test",
		LogFilename: filename,
		FileSize:    -1,
	}
	if err := repo.Create(legacy); err != nil {
		t.Fatalf("Create: %v", err)
	}

	svc := NewDebugLogService(repo, dataDir, 10)
	if err := svc.BackfillFileSizes(); err != nil {
		t.Fatalf("BackfillFileSizes: %v", err)
	}

	updated, err := repo.GetByID(legacy.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if updated.FileSize != 10 {
		t.Fatalf("FileSize = %d, want 10", updated.FileSize)
	}

	if _, err := svc.SaveLog("user-1", "Alice", "1", "test", "x"); !errors.Is(err, ErrDebugLogQuotaExceeded) {
		t.Fatalf("save after backfill error = %v, want %v", err, ErrDebugLogQuotaExceeded)
	}
}
