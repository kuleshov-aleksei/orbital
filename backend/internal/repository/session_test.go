package repository

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func newSession(userID, appVersion, deviceInfo string, lastSeen time.Time) *models.UserSession {
	return &models.UserSession{
		UserID:     userID,
		RoomID:     "room",
		FirstSeen:  lastSeen.Add(-time.Minute),
		LastSeen:   lastSeen,
		Platform:   "electron",
		SystemName: "linux",
		AppVersion: appVersion,
		DeviceInfo: deviceInfo,
	}
}

func TestGetLatestElectronSessionsAndBackfill(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := storage.NewDB(dbPath)
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()

	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	for id, nick := range map[string]string{"u1": "Alice", "u2": "Bob"} {
		if _, err := db.Exec(
			`INSERT INTO users (id, nickname, created_at, last_seen) VALUES (?, ?, ?, ?)`,
			id, nick, time.Now(), time.Now(),
		); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}

	repo := NewSessionRepository(db)

	// u1: old electron session on 2.42.0, newer one on 2.43.0 (latest wins)
	if err := repo.Create(newSession("u1", "2.42.0", `{"app_version":"2.42.0"}`, time.Now().Add(-2*time.Hour))); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := repo.Create(newSession("u1", "2.43.0", `{"app_version":"2.43.0"}`, time.Now())); err != nil {
		t.Fatalf("create: %v", err)
	}
	// u2: electron 2.42.0
	if err := repo.Create(newSession("u2", "2.42.0", `{"app_version":"2.42.0"}`, time.Now())); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Simulate a legacy row with empty app_version but device_info JSON, then run
	// the backfill portion of migration 20 to confirm it populates.
	if _, err := db.Exec(
		`INSERT INTO user_sessions (user_id, room_id, first_seen, last_seen, platform, system_name, app_version, device_info) VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
		"u3", "room", time.Now(), time.Now(), "electron", "linux", `{"app_version":"2.41.0"}`,
	); err != nil {
		t.Fatalf("insert legacy: %v", err)
	}
	if _, err := db.Exec(
		`UPDATE user_sessions SET app_version = COALESCE(json_extract(device_info, '$.app_version'), '') WHERE json_valid(device_info) AND device_info != '' AND app_version = ''`,
	); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	rows, err := repo.GetLatestElectronSessions()
	if err != nil {
		t.Fatalf("GetLatestElectronSessions: %v", err)
	}

	got := map[string]string{}
	for _, r := range rows {
		got[r.Nickname] = r.Version
	}
	if got["Alice"] != "2.43.0" {
		t.Errorf("Alice latest version = %q, want 2.43.0", got["Alice"])
	}
	if got["Bob"] != "2.42.0" {
		t.Errorf("Bob latest version = %q, want 2.42.0", got["Bob"])
	}
	if got[""] != "2.41.0" {
		t.Errorf("legacy backfilled version = %q, want 2.41.0 (deleted/unknown user)", got[""])
	}
}
