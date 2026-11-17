package chatstore

import (
	"sort"
	"sync"
)

// SystemSenderID is the sender of messages the server posts itself (fired
// reminders). Real user ids are 24-character base64, so it cannot collide.
const SystemSenderID = "system"

// Command names (service/chatcmd).
const (
	CommandRandom   = "random"
	CommandVRandom  = "vrandom"
	CommandD20      = "d20"
	CommandRemindMe = "remindme"
	// CommandReminder marks the message a fired reminder posts.
	CommandReminder = "reminder"
)

// d20 labels.
const (
	LabelCriticalSuccess = "critical_success"
	LabelCriticalFailure = "critical_failure"
)

// Command is the server-computed result of a slash command. It is set when
// the message is created and never changes (command messages can't be
// edited), so every client shows the same roll.
type Command struct {
	Name string `json:"name"`
	// Numeric range (random, vrandom, d20) and the value drawn from it.
	Min    *int64 `json:"min,omitempty"`
	Max    *int64 `json:"max,omitempty"`
	Result *int64 `json:"result,omitempty"`
	// Option pick (random, vrandom): ResultIndex points into Options.
	Options     []string `json:"options,omitempty"`
	ResultIndex *int     `json:"result_index,omitempty"`
	// Label is a d20 critical (LabelCritical*).
	Label string `json:"label,omitempty"`
	// Reminders: when it fires (unix ms, UTC), the sender's IANA time zone
	// at send time, and the note.
	DueAtTS     int64  `json:"due_at_ts,omitempty"`
	TZ          string `json:"tz,omitempty"`
	Note        string `json:"note,omitempty"`
	ReminderFor string `json:"reminder_for,omitempty"`
}

func (c *Command) clone() *Command {
	if c == nil {
		return nil
	}
	out := *c
	out.Options = append([]string(nil), c.Options...)
	return &out
}

// Reminder is a pending /remindme.
type Reminder struct {
	ID        int64
	UserID    string
	RoomID    string
	MessageID string
	DueAtMS   int64
	TZ        string
	Note      string
}

// ReminderStore persists pending reminders (SQLite in production,
// repository.TextReminderRepository).
type ReminderStore interface {
	Add(r Reminder) error
	CountPending(userID string) (int, error)
	// TakeDue deletes reminders with due_at <= nowMS and returns them.
	TakeDue(nowMS int64) ([]Reminder, error)
	// DeleteByMessage cancels the reminder a /remindme message created.
	DeleteByMessage(messageID string) error
}

// MemoryReminders is a ReminderStore for memory-only mode and tests.
type MemoryReminders struct {
	mu     sync.Mutex
	nextID int64
	items  []Reminder
}

func NewMemoryReminders() *MemoryReminders { return &MemoryReminders{} }

func (m *MemoryReminders) Add(r Reminder) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextID++
	r.ID = m.nextID
	m.items = append(m.items, r)
	return nil
}

func (m *MemoryReminders) CountPending(userID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.items {
		if r.UserID == userID {
			n++
		}
	}
	return n, nil
}

func (m *MemoryReminders) TakeDue(nowMS int64) ([]Reminder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var due, keep []Reminder
	for _, r := range m.items {
		if r.DueAtMS <= nowMS {
			due = append(due, r)
		} else {
			keep = append(keep, r)
		}
	}
	m.items = keep
	sort.Slice(due, func(i, j int) bool { return due[i].DueAtMS < due[j].DueAtMS })
	return due, nil
}

func (m *MemoryReminders) DeleteByMessage(messageID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	keep := m.items[:0]
	for _, r := range m.items {
		if r.MessageID != messageID {
			keep = append(keep, r)
		}
	}
	m.items = keep
	return nil
}
