package repository

import (
	"database/sql"
	"errors"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// AppSettingsRepository stores server-wide key/value settings.
type AppSettingsRepository struct {
	db *storage.DB
}

func NewAppSettingsRepository(db *storage.DB) *AppSettingsRepository {
	return &AppSettingsRepository{db: db}
}

// Get returns a setting's value, or "" when it was never set.
func (r *AppSettingsRepository) Get(key string) (string, error) {
	var value string
	err := r.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

// Set stores a setting's value; an empty value deletes the setting.
func (r *AppSettingsRepository) Set(key, value string) error {
	if value == "" {
		_, err := r.db.Exec(`DELETE FROM app_settings WHERE key = ?`, key)
		return err
	}
	_, err := r.db.Exec(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, time.Now().UnixMilli())
	return err
}
