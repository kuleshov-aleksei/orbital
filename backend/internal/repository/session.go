package repository

import (
	"database/sql"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type SessionRepository struct {
	db *storage.DB
}

func NewSessionRepository(db *storage.DB) *SessionRepository {
	return &SessionRepository{db: db}
}

func (r *SessionRepository) Create(session *models.UserSession) error {
	result, err := r.db.Exec(
		`INSERT INTO user_sessions (user_id, room_id, first_seen, last_seen, platform, system_name, device_info) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		session.UserID, session.RoomID, session.FirstSeen, session.LastSeen, session.Platform, session.SystemName, session.DeviceInfo,
	)
	if err != nil {
		return err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return err
	}

	session.ID = id
	return nil
}

// FindRecentByUserRoom returns the most recent session for a user in a room
// whose last activity is within the given window (used to dedupe reconnects).
func (r *SessionRepository) FindRecentByUserRoom(userID, roomID string, since time.Time) (*models.UserSession, error) {
	session := &models.UserSession{}
	var firstSeen, lastSeen time.Time

	err := r.db.QueryRow(
		`SELECT id, user_id, room_id, first_seen, last_seen, platform, system_name, device_info FROM user_sessions WHERE user_id = ? AND room_id = ? AND last_seen >= ? ORDER BY last_seen DESC LIMIT 1`,
		userID, roomID, since,
	).Scan(&session.ID, &session.UserID, &session.RoomID, &firstSeen, &lastSeen, &session.Platform, &session.SystemName, &session.DeviceInfo)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	session.FirstSeen = firstSeen
	session.LastSeen = lastSeen
	return session, nil
}

func (r *SessionRepository) UpdateLastSeen(userID, roomID string, ts time.Time) error {
	_, err := r.db.Exec(
		`UPDATE user_sessions SET last_seen = ? WHERE id = (SELECT id FROM user_sessions WHERE user_id = ? AND room_id = ? ORDER BY last_seen DESC LIMIT 1)`,
		ts, userID, roomID,
	)
	return err
}

func (r *SessionRepository) GetAll() ([]*models.UserSession, error) {
	rows, err := r.db.Query(
		`SELECT id, user_id, room_id, first_seen, last_seen, platform, system_name, device_info FROM user_sessions ORDER BY first_seen DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*models.UserSession
	for rows.Next() {
		session := &models.UserSession{}
		var firstSeen, lastSeen time.Time

		err := rows.Scan(&session.ID, &session.UserID, &session.RoomID, &firstSeen, &lastSeen, &session.Platform, &session.SystemName, &session.DeviceInfo)
		if err != nil {
			return nil, err
		}

		session.FirstSeen = firstSeen
		session.LastSeen = lastSeen
		sessions = append(sessions, session)
	}

	return sessions, rows.Err()
}
