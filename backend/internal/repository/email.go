package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// EmailTokenRepository stores single-use email tokens (verification,
// password reset). Only the SHA-256 of a token is stored.
type EmailTokenRepository struct {
	db *storage.DB
}

func NewEmailTokenRepository(db *storage.DB) *EmailTokenRepository {
	return &EmailTokenRepository{db: db}
}

// Replace stores a new token for (user, purpose), dropping older ones, so
// only the newest link works.
func (r *EmailTokenRepository) Replace(userID, purpose, tokenHash string, expiresAt, now time.Time) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?`, userID, purpose); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
			tokenHash, userID, purpose, expiresAt, now,
		)
		return err
	})
}

// Consume deletes the token and returns its user. ok is false when the token
// is unknown, of another purpose, or expired.
func (r *EmailTokenRepository) Consume(tokenHash, purpose string, now time.Time) (userID string, ok bool, err error) {
	err = r.db.Transaction(func(tx *sql.Tx) error {
		var expiresAt time.Time
		scanErr := tx.QueryRow(
			`SELECT user_id, expires_at FROM email_tokens WHERE token_hash = ? AND purpose = ?`,
			tokenHash, purpose,
		).Scan(&userID, &expiresAt)
		if scanErr == sql.ErrNoRows {
			return nil
		}
		if scanErr != nil {
			return scanErr
		}
		if _, err := tx.Exec(`DELETE FROM email_tokens WHERE token_hash = ?`, tokenHash); err != nil {
			return err
		}
		ok = now.Before(expiresAt)
		return nil
	})
	if err != nil || !ok {
		return "", false, err
	}
	return userID, true, nil
}

// DeleteForUser drops every token of a purpose (e.g. reset links once the
// password changed).
func (r *EmailTokenRepository) DeleteForUser(userID, purpose string) error {
	_, err := r.db.Exec(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?`, userID, purpose)
	return err
}

// DeleteExpired removes expired tokens.
func (r *EmailTokenRepository) DeleteExpired(now time.Time) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM email_tokens WHERE expires_at <= ?`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// EmailLogRepository stores the super-admin log of sent mail.
type EmailLogRepository struct {
	db *storage.DB
}

func NewEmailLogRepository(db *storage.DB) *EmailLogRepository {
	return &EmailLogRepository{db: db}
}

// Add records one send attempt.
func (r *EmailLogRepository) Add(e *models.EmailLogEntry) error {
	var userID interface{}
	if e.UserID != "" {
		userID = e.UserID
	}
	res, err := r.db.Exec(
		`INSERT INTO email_log (user_id, to_address, purpose, subject, body_text, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, e.To, e.Purpose, e.Subject, e.Body, e.Status, e.Error, e.CreatedAt,
	)
	if err != nil {
		return err
	}
	e.ID, err = res.LastInsertId()
	return err
}

// List returns entries newest first. beforeID > 0 pages past that entry.
func (r *EmailLogRepository) List(limit int, beforeID int64) ([]models.EmailLogEntry, error) {
	query := `SELECT id, user_id, to_address, purpose, subject, body_text, status, error, created_at FROM email_log`
	args := []interface{}{}
	if beforeID > 0 {
		query += ` WHERE id < ?`
		args = append(args, beforeID)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	entries := []models.EmailLogEntry{}
	for rows.Next() {
		var e models.EmailLogEntry
		var userID sql.NullString
		if err := rows.Scan(&e.ID, &userID, &e.To, &e.Purpose, &e.Subject, &e.Body, &e.Status, &e.Error, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.UserID = userID.String
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// DeleteOlderThan prunes entries past the retention period.
func (r *EmailLogRepository) DeleteOlderThan(cutoff time.Time) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM email_log WHERE created_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
