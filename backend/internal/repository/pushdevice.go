package repository

import (
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// PushDeviceRepository stores FCM registration tokens of the mobile app.
type PushDeviceRepository struct {
	db *storage.DB
}

func NewPushDeviceRepository(db *storage.DB) *PushDeviceRepository {
	return &PushDeviceRepository{db: db}
}

// Upsert registers a token for a user. A token already registered by
// another user moves to this one (shared device, account switch).
func (r *PushDeviceRepository) Upsert(token, userID, platform string) error {
	now := time.Now().UnixMilli()
	_, err := r.db.Exec(`INSERT INTO push_devices (token, user_id, platform, created_at, last_seen_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(token) DO UPDATE SET
			user_id = excluded.user_id, platform = excluded.platform, last_seen_at = excluded.last_seen_at`,
		token, userID, platform, now, now)
	return err
}

// DeleteForUser removes a token only if it belongs to userID (logout).
func (r *PushDeviceRepository) DeleteForUser(userID, token string) error {
	_, err := r.db.Exec(`DELETE FROM push_devices WHERE token = ? AND user_id = ?`, token, userID)
	return err
}

// Delete removes a token FCM reported as no longer valid.
func (r *PushDeviceRepository) Delete(token string) error {
	_, err := r.db.Exec(`DELETE FROM push_devices WHERE token = ?`, token)
	return err
}

// TokensForUser lists the tokens registered by a user.
func (r *PushDeviceRepository) TokensForUser(userID string) ([]string, error) {
	rows, err := r.db.Query(`SELECT token FROM push_devices WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
