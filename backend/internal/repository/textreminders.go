package repository

import (
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// TextReminderRepository stores pending /remindme reminders.
type TextReminderRepository struct {
	db *storage.DB
}

func NewTextReminderRepository(db *storage.DB) *TextReminderRepository {
	return &TextReminderRepository{db: db}
}

func (r *TextReminderRepository) Add(rem chatstore.Reminder) error {
	_, err := r.db.Exec(`INSERT INTO chat_reminders (user_id, room_id, message_id, due_at, tz, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		rem.UserID, rem.RoomID, rem.MessageID, rem.DueAtMS, rem.TZ, rem.Note, time.Now().UnixMilli())
	return err
}

func (r *TextReminderRepository) CountPending(userID string) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM chat_reminders WHERE user_id = ?`, userID).Scan(&n)
	return n, err
}

// TakeDue selects and deletes due reminders in one transaction, so a
// reminder fires once even if two ticks overlap.
func (r *TextReminderRepository) TakeDue(nowMS int64) ([]chatstore.Reminder, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.Query(`SELECT id, user_id, room_id, message_id, due_at, tz, note
		FROM chat_reminders WHERE due_at <= ? ORDER BY due_at`, nowMS)
	if err != nil {
		return nil, err
	}
	var out []chatstore.Reminder
	for rows.Next() {
		var rem chatstore.Reminder
		if err := rows.Scan(&rem.ID, &rem.UserID, &rem.RoomID, &rem.MessageID, &rem.DueAtMS, &rem.TZ, &rem.Note); err != nil {
			_ = rows.Close()
			return nil, err
		}
		out = append(out, rem)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	for _, rem := range out {
		if _, err := tx.Exec(`DELETE FROM chat_reminders WHERE id = ?`, rem.ID); err != nil {
			return nil, err
		}
	}
	return out, tx.Commit()
}

func (r *TextReminderRepository) DeleteByMessage(messageID string) error {
	_, err := r.db.Exec(`DELETE FROM chat_reminders WHERE message_id = ?`, messageID)
	return err
}
