package chatmedia

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// Statuses of a chat_attachments row.
const (
	StatusPending  = "pending"
	StatusAttached = "attached"
	StatusRemoved  = "removed"
)

// Removal reasons (docs/specs/CHAT_SYSTEM.md §7.12.4).
const (
	ReasonQuota          = "quota"
	ReasonOwner          = "owner"
	ReasonModerator      = "moderator"
	ReasonMessageDeleted = "message_deleted"
	ReasonChannelDeleted = "channel_deleted"
	ReasonPendingExpired = "pending_expired"
)

// Record is one chat_attachments row. Times are unix ms.
type Record struct {
	ID            string
	RoomID        string
	UploaderID    string
	MessageID     string
	Kind          string
	Mime          string
	Ext           string
	Filename      string
	SizeBytes     int64
	StoredBytes   int64
	Width         int
	Height        int
	DurationMS    int64
	HasThumb      bool
	Peaks         []int
	Status        string
	Protected     bool
	RemovedReason string
	CreatedAt     int64
	AttachedAt    int64
	RemovedAt     int64
	PurgedAt      int64
}

func (r *Record) originalKey() string {
	return "rooms/" + r.RoomID + "/" + r.ID + "/original." + r.Ext
}

func (r *Record) thumbKey() string {
	return "rooms/" + r.RoomID + "/" + r.ID + "/thumb.webp"
}

func (r *Record) keys() []string {
	keys := []string{r.originalKey()}
	if r.HasThumb {
		keys = append(keys, r.thumbKey())
	}
	return keys
}

const recordColumns = `id, room_id, uploader_id, COALESCE(message_id, ''), kind, mime, ext, filename,
	size_bytes, stored_bytes, COALESCE(width, 0), COALESCE(height, 0), COALESCE(duration_ms, 0),
	has_thumb, COALESCE(peaks, ''), status, protected, COALESCE(removed_reason, ''), created_at,
	COALESCE(attached_at, 0), COALESCE(removed_at, 0), COALESCE(purged_at, 0)`

type scanner interface{ Scan(dest ...any) error }

func scanRecord(s scanner) (*Record, error) {
	var r Record
	var peaks string
	if err := s.Scan(&r.ID, &r.RoomID, &r.UploaderID, &r.MessageID, &r.Kind, &r.Mime, &r.Ext, &r.Filename,
		&r.SizeBytes, &r.StoredBytes, &r.Width, &r.Height, &r.DurationMS,
		&r.HasThumb, &peaks, &r.Status, &r.Protected, &r.RemovedReason, &r.CreatedAt,
		&r.AttachedAt, &r.RemovedAt, &r.PurgedAt); err != nil {
		return nil, err
	}
	if peaks != "" {
		_ = json.Unmarshal([]byte(peaks), &r.Peaks)
	}
	return &r, nil
}

// querier is *sql.DB or *sql.Tx.
type querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func nullable[T comparable](v T) any {
	var zero T
	if v == zero {
		return nil
	}
	return v
}

func insertRecord(q querier, r *Record) error {
	var peaks any
	if len(r.Peaks) > 0 {
		b, _ := json.Marshal(r.Peaks)
		peaks = string(b)
	}
	_, err := q.Exec(`INSERT INTO chat_attachments (id, room_id, uploader_id, message_id, kind, mime, ext,
		filename, size_bytes, stored_bytes, width, height, duration_ms, has_thumb, peaks, status,
		protected, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		r.ID, r.RoomID, r.UploaderID, r.Kind, r.Mime, r.Ext, r.Filename, r.SizeBytes, r.StoredBytes,
		nullable(r.Width), nullable(r.Height), nullable(r.DurationMS), r.HasThumb, peaks, r.Status, r.CreatedAt)
	return err
}

func getRecord(q querier, id string) (*Record, error) {
	r, err := scanRecord(q.QueryRow(`SELECT `+recordColumns+` FROM chat_attachments WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func queryRecords(q querier, where string, args ...any) ([]*Record, error) {
	rows, err := q.Query(`SELECT `+recordColumns+` FROM chat_attachments WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*Record
	for rows.Next() {
		r, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Usage is a user's attachment storage.
type Usage struct {
	QuotaBytes     int64 `json:"quota_bytes"`
	UsedBytes      int64 `json:"used_bytes"`
	ProtectedBytes int64 `json:"protected_bytes"`
	PendingBytes   int64 `json:"pending_bytes"`
	Count          int   `json:"count"`
}

func usageOf(q querier, userID string) (Usage, error) {
	var u Usage
	err := q.QueryRow(`SELECT
			COALESCE(SUM(stored_bytes), 0),
			COALESCE(SUM(CASE WHEN status = 'attached' AND protected = 1 THEN stored_bytes ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'pending' THEN stored_bytes ELSE 0 END), 0),
			COUNT(*)
		FROM chat_attachments WHERE uploader_id = ? AND status IN ('pending', 'attached')`, userID).
		Scan(&u.UsedBytes, &u.ProtectedBytes, &u.PendingBytes, &u.Count)
	return u, err
}

// markRemoved sets rows to removed; only rows not yet removed change. It
// returns the rows that changed.
func markRemoved(q querier, recs []*Record, reason string, now int64) ([]*Record, error) {
	var changed []*Record
	for _, r := range recs {
		res, err := q.Exec(`UPDATE chat_attachments SET status = 'removed', removed_reason = ?, removed_at = ?
			WHERE id = ? AND status != 'removed'`, reason, now, r.ID)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			c := *r
			c.Status, c.RemovedReason, c.RemovedAt = StatusRemoved, reason, now
			changed = append(changed, &c)
		}
	}
	return changed, nil
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}
