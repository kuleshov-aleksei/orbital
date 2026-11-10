package chatstore

import "sync"

// overlay holds writes Meilisearch has accepted (task enqueued) but not yet
// applied. Reads merge it in, so a client that refetches right after sending
// never sees stale data. Entries are dropped once all their tasks finish.
type overlay struct {
	mu   sync.Mutex
	byID map[string]*pendingEntry
}

type pendingEntry struct {
	msg   *Message
	tasks []int64
	// isAdd: the document's creation is among the unconfirmed tasks.
	isAdd bool
}

func newOverlay() *overlay {
	return &overlay{byID: map[string]*pendingEntry{}}
}

func (o *overlay) put(m *Message, task int64, isAdd bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if p, ok := o.byID[m.ID]; ok {
		p.msg = m.clone()
		p.tasks = append(p.tasks, task)
		p.isAdd = p.isAdd || isAdd
		return
	}
	o.byID[m.ID] = &pendingEntry{msg: m.clone(), tasks: []int64{task}, isAdd: isAdd}
}

// get returns the pending version of a message, or nil.
func (o *overlay) get(id string) *Message {
	o.mu.Lock()
	defer o.mu.Unlock()
	if p, ok := o.byID[id]; ok {
		return p.msg.clone()
	}
	return nil
}

// room returns copies of every pending message of a room.
func (o *overlay) room(roomID string) []*Message {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []*Message
	for _, p := range o.byID {
		if p.msg.RoomID == roomID {
			out = append(out, p.msg.clone())
		}
	}
	return out
}

type pendingSnapshot struct {
	roomID   string
	senderID string
	tasks    []int64
	isAdd    bool
}

func (o *overlay) snapshot() map[string]pendingSnapshot {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make(map[string]pendingSnapshot, len(o.byID))
	for id, p := range o.byID {
		out[id] = pendingSnapshot{roomID: p.msg.RoomID, senderID: p.msg.SenderID, tasks: append([]int64(nil), p.tasks...), isAdd: p.isAdd}
	}
	return out
}

// confirm drops the first n tasks of an entry (they succeeded), and the entry
// itself when nothing newer was queued meanwhile.
func (o *overlay) confirm(id string, n int) {
	o.mu.Lock()
	defer o.mu.Unlock()
	p, ok := o.byID[id]
	if !ok {
		return
	}
	if n >= len(p.tasks) {
		delete(o.byID, id)
		return
	}
	p.tasks = p.tasks[n:]
	p.isAdd = false
}

func (o *overlay) drop(id string) {
	o.mu.Lock()
	delete(o.byID, id)
	o.mu.Unlock()
}

func (o *overlay) dropRoom(roomID string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for id, p := range o.byID {
		if p.msg.RoomID == roomID {
			delete(o.byID, id)
		}
	}
}

func (o *overlay) len() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.byID)
}
