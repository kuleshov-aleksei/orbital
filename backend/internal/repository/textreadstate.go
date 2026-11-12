package repository

import (
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// TextReadStateRepository stores each user's read position per text channel.
type TextReadStateRepository struct {
	db *storage.DB
}

func NewTextReadStateRepository(db *storage.DB) *TextReadStateRepository {
	return &TextReadStateRepository{db: db}
}

// Advance moves the read position forward (never backwards) and returns the
// stored value.
func (r *TextReadStateRepository) Advance(userID, roomID string, seq int64) (int64, error) {
	_, err := r.db.Exec(`INSERT INTO text_read_state (user_id, room_id, last_read_seq, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, room_id) DO UPDATE SET
			last_read_seq = MAX(last_read_seq, excluded.last_read_seq),
			updated_at = excluded.updated_at`,
		userID, roomID, seq, time.Now().UnixMilli())
	if err != nil {
		return 0, err
	}
	var stored int64
	err = r.db.QueryRow(`SELECT last_read_seq FROM text_read_state WHERE user_id = ? AND room_id = ?`,
		userID, roomID).Scan(&stored)
	return stored, err
}

// ForUser returns room_id -> last_read_seq for every channel the user opened.
func (r *TextReadStateRepository) ForUser(userID string) (map[string]int64, error) {
	rows, err := r.db.Query(`SELECT room_id, last_read_seq FROM text_read_state WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]int64{}
	for rows.Next() {
		var room string
		var seq int64
		if err := rows.Scan(&room, &seq); err != nil {
			return nil, err
		}
		out[room] = seq
	}
	return out, rows.Err()
}

// DeleteRoom forgets read state of a deleted channel.
func (r *TextReadStateRepository) DeleteRoom(roomID string) error {
	_, err := r.db.Exec(`DELETE FROM text_read_state WHERE room_id = ?`, roomID)
	return err
}

// DeleteUser forgets read state of a deleted user.
func (r *TextReadStateRepository) DeleteUser(userID string) error {
	_, err := r.db.Exec(`DELETE FROM text_read_state WHERE user_id = ?`, userID)
	return err
}
