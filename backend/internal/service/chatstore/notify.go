package chatstore

import (
	"sort"
	"sync"
	"time"
)

// Notification modes per user and text channel (docs/specs/CHAT_SYSTEM.md §7.14).
const (
	NotifyAll        = "all"
	NotifyNoMentions = "no_mentions"
	NotifyMuted      = "muted"
)

// NotifySetting is a user's notification mode for one channel. MutedUntil is
// unix ms; nil with mode muted means forever.
type NotifySetting struct {
	Mode       string `json:"mode"`
	MutedUntil *int64 `json:"muted_until"`
}

// Effective applies lazy expiry: an expired mute reads as "all".
func (s NotifySetting) Effective(now time.Time) NotifySetting {
	if s.Mode == "" {
		return NotifySetting{Mode: NotifyAll}
	}
	if s.Mode == NotifyMuted && s.MutedUntil != nil && *s.MutedUntil <= now.UnixMilli() {
		return NotifySetting{Mode: NotifyAll}
	}
	return s
}

// WantsMentions reports whether mention pings and badges apply.
func (s NotifySetting) WantsMentions(now time.Time) bool {
	return s.Effective(now).Mode == NotifyAll
}

// MuteDurations are the choices of the mute modal; "forever" maps to nil.
var MuteDurations = map[string]time.Duration{
	"1h": time.Hour,
	"4h": 4 * time.Hour,
	"1d": 24 * time.Hour,
	"1w": 7 * 24 * time.Hour,
}

// ExpiredMute is a mute that ran out (to push the change to the user).
type ExpiredMute struct {
	UserID string
	RoomID string
}

// NotifyStore persists notification settings (SQLite in production,
// repository.TextNotifyRepository). Setting mode "all" removes the row.
type NotifyStore interface {
	Get(userID, roomID string) (NotifySetting, error)
	ForUser(userID string) (map[string]NotifySetting, error)
	Set(userID, roomID string, s NotifySetting) error
	// TakeExpired deletes mutes whose muted_until <= nowMS and returns them.
	TakeExpired(nowMS int64) ([]ExpiredMute, error)
	DeleteRoom(roomID string) error
}

// MemoryNotify is a NotifyStore for memory-only mode and tests.
type MemoryNotify struct {
	mu sync.Mutex
	m  map[string]map[string]NotifySetting // user -> room -> setting
}

func NewMemoryNotify() *MemoryNotify {
	return &MemoryNotify{m: map[string]map[string]NotifySetting{}}
}

func (n *MemoryNotify) Get(userID, roomID string) (NotifySetting, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if s, ok := n.m[userID][roomID]; ok {
		return s, nil
	}
	return NotifySetting{Mode: NotifyAll}, nil
}

func (n *MemoryNotify) ForUser(userID string) (map[string]NotifySetting, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := map[string]NotifySetting{}
	for room, s := range n.m[userID] {
		out[room] = s
	}
	return out, nil
}

func (n *MemoryNotify) Set(userID, roomID string, s NotifySetting) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if s.Mode == NotifyAll || s.Mode == "" {
		delete(n.m[userID], roomID)
		return nil
	}
	if n.m[userID] == nil {
		n.m[userID] = map[string]NotifySetting{}
	}
	n.m[userID][roomID] = s
	return nil
}

func (n *MemoryNotify) TakeExpired(nowMS int64) ([]ExpiredMute, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	var out []ExpiredMute
	for user, rooms := range n.m {
		for room, s := range rooms {
			if s.Mode == NotifyMuted && s.MutedUntil != nil && *s.MutedUntil <= nowMS {
				delete(rooms, room)
				out = append(out, ExpiredMute{UserID: user, RoomID: room})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UserID+out[i].RoomID < out[j].UserID+out[j].RoomID })
	return out, nil
}

func (n *MemoryNotify) DeleteRoom(roomID string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, rooms := range n.m {
		delete(rooms, roomID)
	}
	return nil
}
