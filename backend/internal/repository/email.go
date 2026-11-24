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
// only the newest link works. data is stored with the token (e.g. the new
// address of an email change).
func (r *EmailTokenRepository) Replace(userID, purpose, tokenHash, data string, expiresAt, now time.Time) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?`, userID, purpose); err != nil {
			return err
		}
		return insertEmailToken(tx, userID, purpose, tokenHash, data, expiresAt, now)
	})
}

// Add stores a token without dropping older ones of the same purpose. Used for
// email-change undo links, which a later change must not cancel.
func (r *EmailTokenRepository) Add(userID, purpose, tokenHash, data string, expiresAt, now time.Time) error {
	return r.db.Transaction(func(tx *sql.Tx) error {
		return insertEmailToken(tx, userID, purpose, tokenHash, data, expiresAt, now)
	})
}

func insertEmailToken(tx *sql.Tx, userID, purpose, tokenHash, data string, expiresAt, now time.Time) error {
	_, err := tx.Exec(
		`INSERT INTO email_tokens (token_hash, user_id, purpose, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		tokenHash, userID, purpose, data, expiresAt, now,
	)
	return err
}

// EmailToken is a redeemed email token.
type EmailToken struct {
	UserID    string
	Data      string
	CreatedAt time.Time
}

// Consume deletes the token and returns it. It returns nil when the token is
// unknown, of another purpose, or expired.
func (r *EmailTokenRepository) Consume(tokenHash, purpose string, now time.Time) (*EmailToken, error) {
	var tok EmailToken
	ok := false
	err := r.db.Transaction(func(tx *sql.Tx) error {
		var expiresAt time.Time
		scanErr := tx.QueryRow(
			`SELECT user_id, data, expires_at, created_at FROM email_tokens WHERE token_hash = ? AND purpose = ?`,
			tokenHash, purpose,
		).Scan(&tok.UserID, &tok.Data, &expiresAt, &tok.CreatedAt)
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
		return nil, err
	}
	return &tok, nil
}

// DeleteCreatedSince drops a user's tokens of a purpose created at or after
// since.
func (r *EmailTokenRepository) DeleteCreatedSince(userID, purpose string, since time.Time) error {
	_, err := r.db.Exec(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND created_at >= ?`, userID, purpose, since)
	return err
}

// DeleteForUser drops every token of the given purposes (e.g. reset links once
// the password changed).
func (r *EmailTokenRepository) DeleteForUser(userID string, purposes ...string) error {
	for _, purpose := range purposes {
		if _, err := r.db.Exec(`DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?`, userID, purpose); err != nil {
			return err
		}
	}
	return nil
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
