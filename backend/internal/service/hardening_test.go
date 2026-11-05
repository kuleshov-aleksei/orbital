package service

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func TestNormalizeAvatarGUID(t *testing.T) {
	id := uuid.New().String()
	for _, input := range []string{id, id + ".jpg", "/api/avatars/" + id} {
		if got, ok := normalizeAvatarGUID(input); !ok || got != id {
			t.Fatalf("normalizeAvatarGUID(%q) = %q, %v; want %q, true", input, got, ok, id)
		}
	}

	for _, input := range []string{"", "not-a-uuid", "../" + id + "/evil.jpg", "/tmp/" + id + ".png"} {
		if _, ok := normalizeAvatarGUID(input); ok {
			t.Fatalf("normalizeAvatarGUID(%q) unexpectedly succeeded", input)
		}
	}
}

func TestSafeAudioFilename(t *testing.T) {
	id := uuid.New().String()
	for _, name := range []string{id + ".mp3", id + ".opus"} {
		if got, ok := safeAudioFilename(name); !ok || got != name {
			t.Fatalf("safeAudioFilename(%q) = %q, %v", name, got, ok)
		}
	}
	for _, name := range []string{"../x.mp3", id + ".wav", "/tmp/" + id + ".mp3", ""} {
		if _, ok := safeAudioFilename(name); ok {
			t.Fatalf("safeAudioFilename(%q) unexpectedly succeeded", name)
		}
	}
}

func TestPumpkinAssetPathRejectsTraversal(t *testing.T) {
	svc := NewPumpkinAssetService(t.TempDir(), t.TempDir())
	if _, err := svc.AssetPath("../../etc/passwd"); err == nil {
		t.Fatal("expected traversal asset id to be rejected")
	}
	if !ValidPumpkinAssetID("base_1-ok") {
		t.Fatal("expected valid catalog id")
	}
	for _, id := range []string{"../x", "a/b", "a\\b", "", strings.Repeat("a", 65)} {
		if ValidPumpkinAssetID(id) {
			t.Fatalf("ValidPumpkinAssetID(%q) unexpectedly succeeded", id)
		}
	}
}

func TestDebugLogStoredFilenameTraversalRejected(t *testing.T) {
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	repo := repository.NewDebugLogRepository(db)
	svc := NewDebugLogService(repo, t.TempDir(), 100*1024*1024)
	log := &models.DebugLog{
		UserID:      "user-1",
		Username:    "Alice",
		Version:     "1",
		SystemInfo:  "test",
		CreatedAt:   time.Now(),
		LogFilename: "../../escape.log",
	}
	if err := repo.Create(log); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, _, err := svc.GetLog(log.ID); err == nil {
		t.Fatal("expected unsafe stored filename to be rejected")
	}
	if err := svc.DeleteLog(log.ID); err == nil {
		t.Fatal("expected unsafe stored filename deletion to be rejected")
	}
}

func TestDebugLogFilenameIgnoresUserInput(t *testing.T) {
	dataDir := t.TempDir()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	repo := repository.NewDebugLogRepository(db)
	svc := NewDebugLogService(repo, dataDir, 100*1024*1024)
	log, err := svc.SaveLog("../../evil", "Mallory", "1", "test", "log contents")
	if err != nil {
		t.Fatalf("SaveLog: %v", err)
	}
	if strings.Contains(log.LogFilename, "..") || strings.ContainsAny(log.LogFilename, `/\`) {
		t.Fatalf("unsafe generated filename: %q", log.LogFilename)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "logs", log.LogFilename)); err != nil {
		t.Fatalf("generated log file missing: %v", err)
	}
}

func TestLiveKitTokenMetadataAndTTL(t *testing.T) {
	svc, err := NewLiveKitService(&config.LiveKitConfig{
		URL:       "ws://localhost:7880",
		APIKey:    "key",
		APISecret: "secret",
	})
	if err != nil {
		t.Fatalf("NewLiveKitService: %v", err)
	}

	token, err := svc.GenerateAccessToken(LiveKitTokenData{
		UserID:   "user-1",
		Nickname: `Alice "Admin" \`,
		Avatar:   "http://example/avatar.jpg",
		Role:     "user",
		RoomID:   "room-1",
	})
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d parts", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("decode claims: %v", err)
	}

	metadata, ok := claims["metadata"].(string)
	if !ok {
		t.Fatal("metadata claim missing")
	}
	var md struct {
		Nickname string `json:"nickname"`
		Avatar   string `json:"avatar"`
		Role     string `json:"role"`
	}
	if err := json.Unmarshal([]byte(metadata), &md); err != nil {
		t.Fatalf("metadata is not valid JSON: %v", err)
	}
	if md.Nickname != `Alice "Admin" \` {
		t.Fatalf("metadata nickname = %q", md.Nickname)
	}

	exp, ok := claims["exp"].(float64)
	if !ok {
		t.Fatal("exp claim missing")
	}
	iat, ok := claims["iat"].(float64)
	if !ok {
		t.Fatal("iat claim missing")
	}
	if int64(exp-iat) != int64(LiveKitTokenTTL/time.Second) {
		t.Fatalf("token ttl = %ds, want %ds", int64(exp-iat), int64(LiveKitTokenTTL/time.Second))
	}
}
