package chatstore

import "sync"

// ReadStateStore persists per-user read positions (SQLite in production,
// repository.TextReadStateRepository).
type ReadStateStore interface {
	// Advance stores max(current, seq) and returns the stored value.
	Advance(userID, roomID string, seq int64) (int64, error)
	ForUser(userID string) (map[string]int64, error)
	DeleteRoom(roomID string) error
}

// MemoryReadState is a ReadStateStore for memory-only mode and tests.
type MemoryReadState struct {
	mu sync.Mutex
	m  map[string]map[string]int64 // user -> room -> seq
}

func NewMemoryReadState() *MemoryReadState {
	return &MemoryReadState{m: map[string]map[string]int64{}}
}

func (r *MemoryReadState) Advance(userID, roomID string, seq int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.m[userID] == nil {
		r.m[userID] = map[string]int64{}
	}
	r.m[userID][roomID] = max(r.m[userID][roomID], seq)
	return r.m[userID][roomID], nil
}

func (r *MemoryReadState) ForUser(userID string) (map[string]int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]int64{}
	for room, seq := range r.m[userID] {
		out[room] = seq
	}
	return out, nil
}

func (r *MemoryReadState) DeleteRoom(roomID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, rooms := range r.m {
		delete(rooms, roomID)
	}
	return nil
}
