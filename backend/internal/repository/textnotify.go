package repository

import (
	"database/sql"
	"errors"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// TextNotifyRepository stores per-user notification settings per text
// channel. No row means "all".
type TextNotifyRepository struct {
	db *storage.DB
}

func NewTextNotifyRepository(db *storage.DB) *TextNotifyRepository {
	return &TextNotifyRepository{db: db}
}

func (r *TextNotifyRepository) Get(userID, roomID string) (chatstore.NotifySetting, error) {
	var s chatstore.NotifySetting
	var until sql.NullInt64
	err := r.db.QueryRow(`SELECT mode, muted_until FROM text_notify_settings WHERE user_id = ? AND room_id = ?`,
		userID, roomID).Scan(&s.Mode, &until)
	if errors.Is(err, sql.ErrNoRows) {
		return chatstore.NotifySetting{Mode: chatstore.NotifyAll}, nil
	}
	if err != nil {
		return s, err
	}
	if until.Valid {
		s.MutedUntil = &until.Int64
	}
	return s, nil
}

func (r *TextNotifyRepository) ForUser(userID string) (map[string]chatstore.NotifySetting, error) {
	rows, err := r.db.Query(`SELECT room_id, mode, muted_until FROM text_notify_settings WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]chatstore.NotifySetting{}
	for rows.Next() {
		var room string
		var s chatstore.NotifySetting
		var until sql.NullInt64
		if err := rows.Scan(&room, &s.Mode, &until); err != nil {
			return nil, err
		}
		if until.Valid {
			v := until.Int64
			s.MutedUntil = &v
		}
		out[room] = s
	}
	return out, rows.Err()
}

func (r *TextNotifyRepository) Set(userID, roomID string, s chatstore.NotifySetting) error {
	if s.Mode == chatstore.NotifyAll || s.Mode == "" {
		_, err := r.db.Exec(`DELETE FROM text_notify_settings WHERE user_id = ? AND room_id = ?`, userID, roomID)
		return err
	}
	var until any
	if s.MutedUntil != nil {
		until = *s.MutedUntil
	}
	_, err := r.db.Exec(`INSERT INTO text_notify_settings (user_id, room_id, mode, muted_until, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id, room_id) DO UPDATE SET
			mode = excluded.mode, muted_until = excluded.muted_until, updated_at = excluded.updated_at`,
		userID, roomID, s.Mode, until, time.Now().UnixMilli())
	return err
}

func (r *TextNotifyRepository) TakeExpired(nowMS int64) ([]chatstore.ExpiredMute, error) {
	rows, err := r.db.Query(`SELECT user_id, room_id FROM text_notify_settings
		WHERE mode = 'muted' AND muted_until IS NOT NULL AND muted_until <= ?`, nowMS)
	if err != nil {
		return nil, err
	}
	var out []chatstore.ExpiredMute
	for rows.Next() {
		var e chatstore.ExpiredMute
		if err := rows.Scan(&e.UserID, &e.RoomID); err != nil {
			_ = rows.Close()
			return nil, err
		}
		out = append(out, e)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	_, err = r.db.Exec(`DELETE FROM text_notify_settings
		WHERE mode = 'muted' AND muted_until IS NOT NULL AND muted_until <= ?`, nowMS)
	return out, err
}

func (r *TextNotifyRepository) DeleteRoom(roomID string) error {
	_, err := r.db.Exec(`DELETE FROM text_notify_settings WHERE room_id = ?`, roomID)
	return err
}
