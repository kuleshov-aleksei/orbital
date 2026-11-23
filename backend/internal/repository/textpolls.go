package repository

import (
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// TextPollRepository stores the due dates of open polls
// (docs/specs/CHAT_SYSTEM.md §7.18).
type TextPollRepository struct {
	db *storage.DB
}

func NewTextPollRepository(db *storage.DB) *TextPollRepository {
	return &TextPollRepository{db: db}
}

func (r *TextPollRepository) Add(d chatstore.PollDeadline) error {
	_, err := r.db.Exec(`INSERT INTO chat_poll_deadlines (message_id, room_id, due_at) VALUES (?, ?, ?)
		ON CONFLICT(message_id) DO UPDATE SET room_id = excluded.room_id, due_at = excluded.due_at`,
		d.MessageID, d.RoomID, d.DueAtMS)
	return err
}

// TakeDue selects and deletes due deadlines in one transaction, so a poll
// is closed (and announced) once even if two ticks overlap.
func (r *TextPollRepository) TakeDue(nowMS int64) ([]chatstore.PollDeadline, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.Query(`SELECT message_id, room_id, due_at FROM chat_poll_deadlines
		WHERE due_at <= ? ORDER BY due_at`, nowMS)
	if err != nil {
		return nil, err
	}
	var out []chatstore.PollDeadline
	for rows.Next() {
		var d chatstore.PollDeadline
		if err := rows.Scan(&d.MessageID, &d.RoomID, &d.DueAtMS); err != nil {
			_ = rows.Close()
			return nil, err
		}
		out = append(out, d)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	for _, d := range out {
		if _, err := tx.Exec(`DELETE FROM chat_poll_deadlines WHERE message_id = ?`, d.MessageID); err != nil {
			return nil, err
		}
	}
	return out, tx.Commit()
}

func (r *TextPollRepository) DeleteByMessage(messageID string) error {
	_, err := r.db.Exec(`DELETE FROM chat_poll_deadlines WHERE message_id = ?`, messageID)
	return err
}
