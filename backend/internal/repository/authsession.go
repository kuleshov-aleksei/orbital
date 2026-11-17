package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// AuthSessionTouchInterval throttles last_active_at writes: a session is
// rewritten at most once per interval however many requests it makes.
const AuthSessionTouchInterval = time.Minute

// AuthSessionRepository stores signed-in devices (auth_sessions).
type AuthSessionRepository struct {
	db *storage.DB
}

func NewAuthSessionRepository(db *storage.DB) *AuthSessionRepository {
	return &AuthSessionRepository{db: db}
}

const authSessionColumns = `id, user_id, created_at, last_active_at, expires_at, user_agent, client, ip`

func scanAuthSession(scan func(dest ...any) error) (*models.AuthSession, error) {
	s := &models.AuthSession{}
	var created, active, expires int64
	if err := scan(&s.ID, &s.UserID, &created, &active, &expires, &s.UserAgent, &s.Client, &s.IP); err != nil {
		return nil, err
	}
	s.CreatedAt = time.UnixMilli(created).UTC()
	s.LastActiveAt = time.UnixMilli(active).UTC()
	s.ExpiresAt = time.UnixMilli(expires).UTC()
	return s, nil
}

// Create inserts a session and drops the user's expired ones.
func (r *AuthSessionRepository) Create(s *models.AuthSession) error {
	if _, err := r.db.Exec(`DELETE FROM auth_sessions WHERE user_id = ? AND expires_at < ?`,
		s.UserID, time.Now().UnixMilli()); err != nil {
		return err
	}
	_, err := r.db.Exec(`INSERT INTO auth_sessions (`+authSessionColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, s.UserID, s.CreatedAt.UnixMilli(), s.LastActiveAt.UnixMilli(), s.ExpiresAt.UnixMilli(),
		s.UserAgent, s.Client, s.IP)
	return err
}

// Get returns a session by id, or nil when it doesn't exist.
func (r *AuthSessionRepository) Get(id string) (*models.AuthSession, error) {
	s, err := scanAuthSession(r.db.QueryRow(`SELECT `+authSessionColumns+` FROM auth_sessions WHERE id = ?`, id).Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

// ListForUser returns the user's unexpired sessions, most recently active first.
func (r *AuthSessionRepository) ListForUser(userID string) ([]*models.AuthSession, error) {
	rows, err := r.db.Query(`SELECT `+authSessionColumns+` FROM auth_sessions
		WHERE user_id = ? AND expires_at >= ? ORDER BY last_active_at DESC`,
		userID, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*models.AuthSession
	for rows.Next() {
		s, err := scanAuthSession(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Touch records activity. It writes only when the stored last_active_at is
// older than AuthSessionTouchInterval, or when the session has no device info
// yet (a QR-linked device, created by the approving device's request); empty
// metadata keeps the stored value.
func (r *AuthSessionRepository) Touch(id string, now time.Time, userAgent, client, ip string) error {
	_, err := r.db.Exec(`UPDATE auth_sessions SET
			last_active_at = ?,
			user_agent = CASE WHEN ? != '' THEN ? ELSE user_agent END,
			client = CASE WHEN ? != '' THEN ? ELSE client END,
			ip = CASE WHEN ? != '' THEN ? ELSE ip END
		WHERE id = ? AND (last_active_at < ? OR (user_agent = '' AND ? != ''))`,
		now.UnixMilli(), userAgent, userAgent, client, client, ip, ip,
		id, now.Add(-AuthSessionTouchInterval).UnixMilli(), userAgent)
	return err
}

// Extend moves a session's expiry (token refresh).
func (r *AuthSessionRepository) Extend(id string, expiresAt time.Time) error {
	_, err := r.db.Exec(`UPDATE auth_sessions SET expires_at = ? WHERE id = ?`, expiresAt.UnixMilli(), id)
	return err
}

// Delete removes one of the user's sessions. It reports whether a row was
// removed, so another user's session id reads as not found.
func (r *AuthSessionRepository) Delete(userID, id string) (bool, error) {
	res, err := r.db.Exec(`DELETE FROM auth_sessions WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// DeleteOthers removes every session of the user except keepID and returns
// the removed ids.
func (r *AuthSessionRepository) DeleteOthers(userID, keepID string) ([]string, error) {
	rows, err := r.db.Query(`DELETE FROM auth_sessions WHERE user_id = ? AND id != ? RETURNING id`, userID, keepID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
