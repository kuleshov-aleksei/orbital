package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// QRLoginRepository persists single-use QR device-linking challenges
type QRLoginRepository struct {
	db *storage.DB
}

// NewQRLoginRepository creates a new QR login repository
func NewQRLoginRepository(db *storage.DB) *QRLoginRepository {
	return &QRLoginRepository{db: db}
}

// Create inserts a new pending challenge
func (r *QRLoginRepository) Create(ch *models.QRLoginChallenge) error {
	_, err := r.db.Exec(
		`INSERT INTO qr_login_challenges (id, public_key, device_name, device_info, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		ch.ID, ch.PublicKey, ch.DeviceName, ch.DeviceInfo, ch.Status, ch.CreatedAt, ch.ExpiresAt,
	)
	return err
}

// scanChallenge scans a full challenge row, handling NULL values properly
func scanChallenge(scanner interface {
	Scan(dest ...interface{}) error
}) (*models.QRLoginChallenge, error) {
	ch := &models.QRLoginChallenge{}
	var approvedBy, sealed sql.NullString
	var consumedAt sql.NullTime
	var createdAt, expiresAt time.Time

	err := scanner.Scan(
		&ch.ID,
		&ch.PublicKey,
		&ch.DeviceName,
		&ch.DeviceInfo,
		&ch.Status,
		&approvedBy,
		&sealed,
		&createdAt,
		&expiresAt,
		&consumedAt,
	)
	if err != nil {
		return nil, err
	}

	if approvedBy.Valid {
		ch.ApprovedByUserID = approvedBy.String
	}
	if sealed.Valid {
		ch.SealedPayload = sealed.String
	}
	ch.CreatedAt = createdAt
	ch.ExpiresAt = expiresAt
	if consumedAt.Valid {
		ts := consumedAt.Time
		ch.ConsumedAt = &ts
	}

	return ch, nil
}

// GetByID retrieves a challenge by ID, or (nil, nil) when it does not exist
func (r *QRLoginRepository) GetByID(id string) (*models.QRLoginChallenge, error) {
	ch, err := scanChallenge(r.db.QueryRow(
		`SELECT id, public_key, device_name, device_info, status, approved_by_user_id, sealed_payload, created_at, expires_at, consumed_at
		 FROM qr_login_challenges WHERE id = ?`,
		id,
	))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return ch, nil
}

// Approve atomically marks a pending, unexpired challenge as approved and
// stores the sealed payload. It reports whether the row was transitioned,
// so concurrent approve/claim races have exactly one winner.
func (r *QRLoginRepository) Approve(id, publicKey, userID, sealedPayload string, now time.Time) (bool, error) {
	res, err := r.db.Exec(
		`UPDATE qr_login_challenges SET status = ?, approved_by_user_id = ?, sealed_payload = ?
		 WHERE id = ? AND public_key = ? AND status = ? AND expires_at > ?`,
		models.QRLoginChallengeApproved, userID, sealedPayload,
		id, publicKey, models.QRLoginChallengePending, now,
	)
	if err != nil {
		return false, err
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return false, err
	}

	return rows == 1, nil
}

// Consume atomically marks an approved challenge as consumed. Only the first
// caller wins; everyone else must treat the challenge as already used.
func (r *QRLoginRepository) Consume(id string, now time.Time) (bool, error) {
	res, err := r.db.Exec(
		`UPDATE qr_login_challenges SET status = ?, consumed_at = ? WHERE id = ? AND status = ?`,
		models.QRLoginChallengeConsumed, now, id, models.QRLoginChallengeApproved,
	)
	if err != nil {
		return false, err
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return false, err
	}

	return rows == 1, nil
}

// MarkExpired marks a pending or approved challenge as expired (best effort,
// used for lazy expiry on read paths)
func (r *QRLoginRepository) MarkExpired(id string) error {
	_, err := r.db.Exec(
		`UPDATE qr_login_challenges SET status = ? WHERE id = ? AND status IN (?, ?)`,
		models.QRLoginChallengeExpired, id,
		models.QRLoginChallengePending, models.QRLoginChallengeApproved,
	)
	return err
}

// DeleteExpired removes challenges that expired before the cutoff and
// returns the number of deleted rows
func (r *QRLoginRepository) DeleteExpired(cutoff time.Time) (int64, error) {
	res, err := r.db.Exec(
		`DELETE FROM qr_login_challenges WHERE expires_at < ?`,
		cutoff,
	)
	if err != nil {
		return 0, err
	}

	return res.RowsAffected()
}
