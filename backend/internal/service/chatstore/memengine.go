package chatstore

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
)

// MemoryEngine is an in-memory Engine for tests. By default every write
// applies immediately and its task succeeds; Hold delays application so
// tests can observe the pending overlay, and FailNext makes a task fail.
type MemoryEngine struct {
	mu       sync.Mutex
	docs     map[string]*Message
	tasks    map[int64]TaskStatus
	held     []heldWrite
	nextTask int64
	hold     bool
	failNext bool
	down     bool
}

type heldWrite struct {
	uid   int64
	apply func()
	fail  bool
}

// NewMemoryEngine returns an empty engine.
func NewMemoryEngine() *MemoryEngine {
	return &MemoryEngine{docs: map[string]*Message{}, tasks: map[int64]TaskStatus{}}
}

// Hold queues writes instead of applying them until Release.
func (e *MemoryEngine) Hold() { e.mu.Lock(); e.hold = true; e.mu.Unlock() }

// Release applies queued writes in order and resumes immediate writes.
func (e *MemoryEngine) Release() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.hold = false
	for _, w := range e.held {
		e.finishLocked(w)
	}
	e.held = nil
}

// FailNext makes the next write's task fail (the write is not applied).
func (e *MemoryEngine) FailNext() { e.mu.Lock(); e.failNext = true; e.mu.Unlock() }

// SetDown makes every call fail with ErrUnavailable.
func (e *MemoryEngine) SetDown(down bool) { e.mu.Lock(); e.down = down; e.mu.Unlock() }

func (e *MemoryEngine) finishLocked(w heldWrite) {
	if w.fail {
		e.tasks[w.uid] = TaskFailed
		return
	}
	w.apply()
	e.tasks[w.uid] = TaskSucceeded
}

func (e *MemoryEngine) write(apply func()) (int64, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.down {
		return 0, ErrUnavailable
	}
	e.nextTask++
	w := heldWrite{uid: e.nextTask, apply: apply, fail: e.failNext}
	e.failNext = false
	if e.hold {
		e.tasks[w.uid] = TaskEnqueued
		e.held = append(e.held, w)
	} else {
		e.finishLocked(w)
	}
	return w.uid, nil
}

func (e *MemoryEngine) check() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.down {
		return ErrUnavailable
	}
	return nil
}

func (e *MemoryEngine) Bootstrap(context.Context) error { return e.check() }
func (e *MemoryEngine) Health(context.Context) error    { return e.check() }

func (e *MemoryEngine) Add(_ context.Context, m *Message) (int64, error) {
	c := m.clone()
	return e.write(func() { e.docs[c.ID] = c })
}

func (e *MemoryEngine) Patch(_ context.Context, id string, fields map[string]any) (int64, error) {
	raw, err := json.Marshal(fields)
	if err != nil {
		return 0, err
	}
	return e.write(func() {
		doc, ok := e.docs[id]
		if !ok {
			doc = &Message{ID: id}
		}
		// Same semantics as Meilisearch PUT /documents: top-level merge.
		_ = json.Unmarshal(raw, doc)
		doc.normalize()
		e.docs[id] = doc
	})
}

func (e *MemoryEngine) DeleteDocument(_ context.Context, id string) (int64, error) {
	return e.write(func() { delete(e.docs, id) })
}

func (e *MemoryEngine) DeleteRoom(_ context.Context, roomID string) (int64, error) {
	return e.write(func() {
		for id, d := range e.docs {
			if d.RoomID == roomID {
				delete(e.docs, id)
			}
		}
	})
}

func (e *MemoryEngine) Get(_ context.Context, id string) (*Message, error) {
	if err := e.check(); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if d, ok := e.docs[id]; ok {
		return d.clone(), nil
	}
	return nil, nil
}

func (e *MemoryEngine) Fetch(_ context.Context, ids []string) ([]*Message, error) {
	if err := e.check(); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []*Message
	for _, id := range ids {
		if d, ok := e.docs[id]; ok {
			out = append(out, d.clone())
		}
	}
	return out, nil
}

func (e *MemoryEngine) List(_ context.Context, q ListQuery) ([]*Message, error) {
	if err := e.check(); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []*Message
	for _, d := range e.docs {
		if q.matches(d) {
			out = append(out, d.clone())
		}
	}
	sortBySeq(out, q.Asc)
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

func (e *MemoryEngine) NewestSeqs(ctx context.Context, roomIDs []string) (map[string]int64, error) {
	out := map[string]int64{}
	for _, id := range roomIDs {
		page, err := e.List(ctx, ListQuery{RoomID: id, Limit: 1})
		if err != nil {
			return nil, err
		}
		if len(page) > 0 {
			out[id] = page[0].Seq
		}
	}
	return out, nil
}

func (e *MemoryEngine) MaxSeq(context.Context) (int64, error) {
	if err := e.check(); err != nil {
		return 0, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	var maxSeq int64
	for _, d := range e.docs {
		maxSeq = max(maxSeq, d.Seq)
	}
	return maxSeq, nil
}

func (e *MemoryEngine) Tasks(_ context.Context, uids []int64) (map[int64]TaskStatus, error) {
	if err := e.check(); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	out := map[int64]TaskStatus{}
	for _, u := range uids {
		if s, ok := e.tasks[u]; ok {
			out[u] = s
		} else {
			return nil, errors.New("unknown task")
		}
	}
	return out, nil
}

func sortBySeq(msgs []*Message, asc bool) {
	sort.Slice(msgs, func(i, j int) bool {
		if asc {
			return msgs[i].Seq < msgs[j].Seq
		}
		return msgs[i].Seq > msgs[j].Seq
	})
}

func (e *MemoryEngine) all() ([]*Message, error) {
	if err := e.check(); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]*Message, 0, len(e.docs))
	for _, d := range e.docs {
		out = append(out, d.clone())
	}
	return out, nil
}

func (e *MemoryEngine) Pins(_ context.Context, roomID string, limit int) ([]*Message, error) {
	docs, err := e.all()
	if err != nil {
		return nil, err
	}
	var out []*Message
	for _, d := range docs {
		if d.RoomID == roomID && d.Pinned && !d.IsDeleted {
			out = append(out, d)
		}
	}
	sortByPinned(out)
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// Search is a naive case-insensitive word match (every query word must be a
// substring of content_search); good enough to test filters and plumbing.
func (e *MemoryEngine) Search(_ context.Context, req SearchRequest) (*SearchResult, error) {
	docs, err := e.all()
	if err != nil {
		return nil, err
	}
	words := strings.Fields(strings.ToLower(strings.ReplaceAll(req.Text, `"`, "")))
	var matched []*Message
	for _, d := range docs {
		if d.IsDeleted || !contains(req.RoomIDs, d.RoomID) {
			continue
		}
		if len(req.SenderIDs) > 0 && !contains(req.SenderIDs, d.SenderID) {
			continue
		}
		if len(req.MentionUserIDs) > 0 && !anyIn(req.MentionUserIDs, d.MentionUserIDs) {
			continue
		}
		if (req.FromTS > 0 && d.CreatedAtTS < req.FromTS) || (req.ToTS > 0 && d.CreatedAtTS >= req.ToTS) {
			continue
		}
		if req.Pinned != nil && d.Pinned != *req.Pinned {
			continue
		}
		if !hasAll(d.AttachmentKinds, req.HasKinds) || (req.HasAttachment && len(d.AttachmentKinds) == 0) {
			continue
		}
		text := strings.ToLower(d.ContentSearch)
		ok := true
		for _, w := range words {
			if !strings.Contains(text, w) {
				ok = false
				break
			}
		}
		if ok {
			matched = append(matched, d)
		}
	}
	sortBySeq(matched, false)
	res := &SearchResult{Total: len(matched), Hits: []SearchHit{}}
	for i := req.Offset; i < len(matched) && i < req.Offset+req.Limit; i++ {
		hit := SearchHit{Message: matched[i]}
		if len(words) > 0 {
			hit.Snippet = highlightWords(matched[i].ContentSearch, words)
		}
		res.Hits = append(res.Hits, hit)
	}
	return res, nil
}

func highlightWords(text string, words []string) string {
	lower := strings.ToLower(text)
	if len(lower) != len(text) {
		return text // case mapping changed byte offsets; skip highlighting
	}
	var b strings.Builder
	for i := 0; i < len(text); {
		hit := ""
		for _, w := range words {
			if strings.HasPrefix(lower[i:], w) && len(w) > len(hit) {
				hit = w
			}
		}
		if hit == "" {
			b.WriteByte(text[i])
			i++
			continue
		}
		b.WriteString(HighlightPre + text[i:i+len(hit)] + HighlightPost)
		i += len(hit)
	}
	return b.String()
}

func anyIn(want, have []string) bool {
	for _, w := range want {
		if contains(have, w) {
			return true
		}
	}
	return false
}

func (e *MemoryEngine) CountMentions(_ context.Context, qs []MentionCountQuery) ([]int, error) {
	docs, err := e.all()
	if err != nil {
		return nil, err
	}
	out := make([]int, len(qs))
	for i, q := range qs {
		for _, d := range docs {
			if d.RoomID != q.RoomID || d.IsDeleted || d.Seq <= q.AfterSeq || d.SenderID == q.UserID {
				continue
			}
			if contains(d.MentionUserIDs, q.UserID) || anyIn(q.RoleIDs, d.MentionRoleIDs) {
				out[i]++
			}
		}
	}
	return out, nil
}

// hasAll reports whether every value of want is in have.
func hasAll(have, want []string) bool {
	for _, w := range want {
		if !contains(have, w) {
			return false
		}
	}
	return true
}
