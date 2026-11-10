package chatstore

import (
	"context"
	"errors"
	"hash/fnv"
	"log"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultCallTimeout   = 2 * time.Second
	defaultWatchInterval = 100 * time.Millisecond
	// DefaultPageSize is the history page size.
	DefaultPageSize = 50
	// MaxPageSize caps limit on history requests.
	MaxPageSize = 100
	lockShards  = 64
)

// Options tune a Service; zero values pick the defaults.
type Options struct {
	CallTimeout   time.Duration
	WatchInterval time.Duration
	Now           func() time.Time
}

// Revert describes a write Meilisearch accepted but then failed to apply.
// Message is the authoritative current state, or nil when the message does
// not exist (a lost create). SenderID is the message author, to notify.
type Revert struct {
	RoomID   string
	ID       string
	Message  *Message
	SenderID string
}

// Service is the text channel message store (docs/specs/CHAT_SYSTEM.md §6).
// The backend is the single writer to the index.
type Service struct {
	eng  Engine
	opts Options

	ready atomic.Bool

	createMu sync.Mutex
	lastSeq  int64

	locks [lockShards]sync.Mutex
	ov    *overlay

	newestMu sync.RWMutex
	newest   map[string]int64

	revertMu        sync.RWMutex
	onRevert        func(Revert)
	resolveMentions MentionResolver

	// pinMu serializes pin changes so the per-channel limit holds.
	pinMu sync.Mutex
}

// New creates a Service. Call Start to bootstrap it in the background.
func New(eng Engine, opts Options) *Service {
	if opts.CallTimeout <= 0 {
		opts.CallTimeout = defaultCallTimeout
	}
	if opts.WatchInterval <= 0 {
		opts.WatchInterval = defaultWatchInterval
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Service{eng: eng, opts: opts, ov: newOverlay(), newest: map[string]int64{}}
}

// SetRevertHandler registers the callback for failed writes (to broadcast a
// correction to clients).
func (s *Service) SetRevertHandler(fn func(Revert)) {
	s.revertMu.Lock()
	s.onRevert = fn
	s.revertMu.Unlock()
}

// Ready reports whether the store finished bootstrapping.
func (s *Service) Ready() bool { return s.ready.Load() }

// Start bootstraps in the background, retrying until Meilisearch answers,
// then runs the task watcher until ctx ends. textRooms lists the text channel
// ids whose newest seq is preloaded for unread badges.
func (s *Service) Start(ctx context.Context, textRooms func() []string) {
	go func() {
		delay := time.Second
		for {
			err := s.Bootstrap(ctx, textRooms())
			if err == nil {
				break
			}
			log.Printf("[Chat] Meilisearch bootstrap failed (retrying in %s): %v", delay, err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			delay = min(delay*2, 30*time.Second)
		}
		log.Printf("[Chat] Text channel store ready")
		ticker := time.NewTicker(s.opts.WatchInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.Flush(ctx)
			}
		}
	}()
}

// Bootstrap applies index settings and loads the seq and newest-seq caches.
func (s *Service) Bootstrap(ctx context.Context, textRooms []string) error {
	bctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err := s.eng.Bootstrap(bctx); err != nil {
		return err
	}
	maxSeq, err := s.eng.MaxSeq(bctx)
	if err != nil {
		return err
	}
	newest, err := s.eng.NewestSeqs(bctx, textRooms)
	if err != nil {
		return err
	}
	s.createMu.Lock()
	s.lastSeq = max(s.lastSeq, maxSeq)
	s.createMu.Unlock()
	s.newestMu.Lock()
	for room, seq := range newest {
		s.newest[room] = max(s.newest[room], seq)
	}
	s.newestMu.Unlock()
	s.ready.Store(true)
	return nil
}

// Health checks Meilisearch directly.
func (s *Service) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, s.opts.CallTimeout)
	defer cancel()
	return s.eng.Health(ctx)
}

func (s *Service) begin(ctx context.Context) (context.Context, context.CancelFunc, error) {
	if !s.ready.Load() {
		return ctx, func() {}, ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, s.opts.CallTimeout)
	return ctx, cancel, nil
}

// engineErr maps engine failures onto ErrUnavailable unless already typed.
func engineErr(err error) error {
	if err == nil || errors.Is(err, ErrUnavailable) {
		return err
	}
	return errors.Join(ErrUnavailable, err)
}

func (s *Service) lockFor(id string) *sync.Mutex {
	h := fnv.New32a()
	_, _ = h.Write([]byte(id))
	return &s.locks[h.Sum32()%lockShards]
}

// lookup returns the newest known state of a message, deleted or not.
func (s *Service) lookup(ctx context.Context, id string) (*Message, error) {
	if m := s.ov.get(id); m != nil {
		return m, nil
	}
	m, err := s.eng.Get(ctx, id)
	return m, engineErr(err)
}

// Get returns a non-deleted message.
func (s *Service) Get(ctx context.Context, id string) (*Message, error) {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	m, err := s.lookup(ctx, id)
	if err != nil {
		return nil, err
	}
	if m == nil || m.IsDeleted {
		return nil, ErrNotFound
	}
	return m, nil
}

// CreateInput is a new message.
type CreateInput struct {
	RoomID    string
	SenderID  string
	Content   string
	ReplyToID string
	// ReplyPing adds the replied-to author to mention_user_ids.
	ReplyPing bool
}

// Create stores a message and returns it once Meilisearch accepted the write.
func (s *Service) Create(ctx context.Context, in CreateInput) (*Message, error) {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	content, err := NormalizeContent(in.Content, false)
	if err != nil {
		return nil, err
	}
	var replyTo *string
	var replyPing []string
	if in.ReplyToID != "" {
		parent, err := s.lookup(ctx, in.ReplyToID)
		if err != nil {
			return nil, err
		}
		if parent == nil || parent.IsDeleted || parent.RoomID != in.RoomID {
			return nil, invalid("the replied message no longer exists")
		}
		id := parent.ID
		replyTo = &id
		if in.ReplyPing && parent.SenderID != in.SenderID {
			replyPing = append(replyPing, parent.SenderID)
		}
	}
	mentionUsers, mentionRoles := s.mentionsFor(in.RoomID, content, replyPing)

	// Serialize creates so seq order equals enqueue order.
	s.createMu.Lock()
	defer s.createMu.Unlock()
	now := s.opts.Now()
	seq := max(now.UnixMilli()*1000, s.lastSeq+1)
	// Advance even if the write fails: a timed-out request may still have
	// been enqueued, and reusing its id would overwrite that message.
	s.lastSeq = seq
	msg := &Message{
		ID:             strconv.FormatInt(seq, 10),
		Seq:            seq,
		RoomID:         in.RoomID,
		SenderID:       in.SenderID,
		Content:        content,
		ContentSearch:  SearchText(content),
		CreatedAtTS:    now.UnixMilli(),
		ReplyToID:      replyTo,
		MentionUserIDs: mentionUsers,
		MentionRoleIDs: mentionRoles,
	}
	msg.normalize()
	task, err := s.eng.Add(ctx, msg)
	if err != nil {
		return nil, engineErr(err)
	}
	s.ov.put(msg, task, true)
	s.bumpNewest(in.RoomID, seq)
	return msg.clone(), nil
}

// mutate runs a read-modify-write on one message under its lock. fn edits
// the copy and returns the changed top-level fields; Meilisearch merges only
// those, so concurrent edits of different fields never clobber each other.
func (s *Service) mutate(ctx context.Context, id string, fn func(m *Message) (map[string]any, error)) (*Message, error) {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()

	cur, err := s.lookup(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur == nil || cur.IsDeleted {
		return nil, ErrNotFound
	}
	next := cur.clone()
	fields, err := fn(next)
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return next, nil
	}
	task, err := s.eng.Patch(ctx, id, fields)
	if err != nil {
		return nil, engineErr(err)
	}
	s.ov.put(next, task, false)
	return next.clone(), nil
}

// Edit changes a message's text. Only the author may edit.
func (s *Service) Edit(ctx context.Context, id, actorID, content string) (*Message, error) {
	return s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		if m.SenderID != actorID {
			return nil, ErrForbidden
		}
		text, err := NormalizeContent(content, len(m.Attachments) > 0)
		if err != nil {
			return nil, err
		}
		if text == m.Content {
			return nil, nil
		}
		now := s.opts.Now().UnixMilli()
		// Mentions follow the new text; a reply ping stays. Edits never ping.
		users, roles := s.mentionsFor(m.RoomID, text, replyPinged(m))
		m.Content = text
		m.ContentSearch = SearchText(text)
		m.EditedAtTS = &now
		m.MentionUserIDs, m.MentionRoleIDs = users, roles
		return map[string]any{
			"content": m.Content, "content_search": m.ContentSearch, "edited_at_ts": now,
			"mention_user_ids": users, "mention_role_ids": roles,
		}, nil
	})
}

// Delete soft-deletes a message. The author may always delete; others need
// canManage(roomID) (ManageMessages in that channel).
func (s *Service) Delete(ctx context.Context, id, actorID string, canManage func(roomID string) bool) (*Message, error) {
	m, err := s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		if m.SenderID != actorID && (canManage == nil || !canManage(m.RoomID)) {
			return nil, ErrForbidden
		}
		now := s.opts.Now().UnixMilli()
		actor := actorID
		m.IsDeleted, m.DeletedAtTS, m.DeletedBy = true, &now, &actor
		m.Pinned, m.PinnedAtTS, m.PinnedBy = false, nil, nil
		return map[string]any{
			"is_deleted": true, "deleted_at_ts": now, "deleted_by": actor,
			"pinned": false, "pinned_at_ts": nil, "pinned_by": nil,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if s.NewestSeq(m.RoomID) == m.Seq {
		rctx, cancel := context.WithTimeout(ctx, s.opts.CallTimeout)
		s.recomputeNewest(rctx, m.RoomID)
		cancel()
	}
	return m, nil
}

// DeleteRoom removes every message of a deleted channel.
func (s *Service) DeleteRoom(ctx context.Context, roomID string) error {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return err
	}
	if _, err := s.eng.DeleteRoom(ctx, roomID); err != nil {
		return engineErr(err)
	}
	s.ov.dropRoom(roomID)
	s.newestMu.Lock()
	delete(s.newest, roomID)
	s.newestMu.Unlock()
	return nil
}

// list reads a page from Meilisearch and merges pending writes into it.
func (s *Service) list(ctx context.Context, q ListQuery) ([]*Message, error) {
	pending := s.ov.room(q.RoomID)
	eq := q
	if eq.Limit > 0 {
		// Pending deletes may remove rows from the page; over-fetch to cover.
		eq.Limit += len(pending)
	}
	docs, err := s.eng.List(ctx, eq)
	if err != nil {
		return nil, engineErr(err)
	}
	byID := make(map[string]*Message, len(docs)+len(pending))
	for _, d := range docs {
		byID[d.ID] = d
	}
	for _, p := range pending {
		delete(byID, p.ID)
		if q.matches(p) {
			byID[p.ID] = p
		}
	}
	out := make([]*Message, 0, len(byID))
	for _, m := range byID {
		out = append(out, m)
	}
	sortBySeq(out, q.Asc)
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

// HistoryQuery selects a history window. At most one cursor is used, in
// order: AroundSeq, AfterSeq, BeforeSeq, BeforeTS; none means newest.
type HistoryQuery struct {
	RoomID    string
	BeforeSeq int64
	AfterSeq  int64
	AroundSeq int64
	BeforeTS  int64
	Limit     int
}

// Page is a history window, oldest first, plus previews of replied messages.
type Page struct {
	Messages      []PublicMessage          `json:"messages"`
	Replied       map[string]PublicMessage `json:"replied"`
	HasMoreBefore bool                     `json:"has_more_before"`
	HasMoreAfter  bool                     `json:"has_more_after"`
}

// History returns a page of a channel.
func (s *Service) History(ctx context.Context, q HistoryQuery) (*Page, error) {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	limit := q.Limit
	if limit <= 0 {
		limit = DefaultPageSize
	}
	limit = min(limit, MaxPageSize)

	var msgs []*Message
	page := &Page{}
	switch {
	case q.AroundSeq > 0:
		half := max(limit/2, 1)
		before, err := s.list(ctx, ListQuery{RoomID: q.RoomID, BeforeSeq: q.AroundSeq + 1, Limit: half + 1})
		if err != nil {
			return nil, err
		}
		after, err := s.list(ctx, ListQuery{RoomID: q.RoomID, AfterSeq: q.AroundSeq, Asc: true, Limit: half + 1})
		if err != nil {
			return nil, err
		}
		page.HasMoreBefore = len(before) > half
		page.HasMoreAfter = len(after) > half
		before = before[:min(len(before), half)]
		after = after[:min(len(after), half)]
		msgs = append(reversed(before), after...)
	case q.AfterSeq > 0:
		after, err := s.list(ctx, ListQuery{RoomID: q.RoomID, AfterSeq: q.AfterSeq, Asc: true, Limit: limit + 1})
		if err != nil {
			return nil, err
		}
		page.HasMoreAfter = len(after) > limit
		page.HasMoreBefore = true
		msgs = after[:min(len(after), limit)]
	default:
		before, err := s.list(ctx, ListQuery{RoomID: q.RoomID, BeforeSeq: q.BeforeSeq, BeforeTS: q.BeforeTS, Limit: limit + 1})
		if err != nil {
			return nil, err
		}
		page.HasMoreBefore = len(before) > limit
		before = before[:min(len(before), limit)]
		msgs = reversed(before)
		if q.BeforeSeq > 0 || q.BeforeTS > 0 {
			newest := s.NewestSeq(q.RoomID)
			last := q.BeforeSeq - 1
			if len(msgs) > 0 {
				last = msgs[len(msgs)-1].Seq
			}
			page.HasMoreAfter = newest > last
		}
	}

	page.Messages = make([]PublicMessage, len(msgs))
	for i, m := range msgs {
		page.Messages[i] = m.Public()
	}
	replied, err := s.replied(ctx, msgs)
	if err != nil {
		return nil, err
	}
	page.Replied = replied
	return page, nil
}

// replied fetches the parents of replies in one request. Deleted or missing
// parents are left out; clients render them as "Original message was deleted".
func (s *Service) replied(ctx context.Context, msgs []*Message) (map[string]PublicMessage, error) {
	out := map[string]PublicMessage{}
	var ids []string
	seen := map[string]bool{}
	for _, m := range msgs {
		if m.ReplyToID == nil || seen[*m.ReplyToID] {
			continue
		}
		id := *m.ReplyToID
		seen[id] = true
		if p := s.ov.get(id); p != nil {
			if !p.IsDeleted {
				out[id] = p.Public()
			}
			continue
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return out, nil
	}
	parents, err := s.eng.Fetch(ctx, ids)
	if err != nil {
		return nil, engineErr(err)
	}
	for _, p := range parents {
		if !p.IsDeleted {
			out[p.ID] = p.Public()
		}
	}
	return out, nil
}

// Replied returns parent previews for a set of messages (used for live events).
func (s *Service) Replied(ctx context.Context, msgs ...*Message) (map[string]PublicMessage, error) {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	return s.replied(ctx, msgs)
}

func reversed(msgs []*Message) []*Message {
	out := make([]*Message, len(msgs))
	for i, m := range msgs {
		out[len(msgs)-1-i] = m
	}
	return out
}

// NewestSeq is the newest message seq of a channel (0 = empty).
func (s *Service) NewestSeq(roomID string) int64 {
	s.newestMu.RLock()
	defer s.newestMu.RUnlock()
	return s.newest[roomID]
}

func (s *Service) bumpNewest(roomID string, seq int64) {
	s.newestMu.Lock()
	s.newest[roomID] = max(s.newest[roomID], seq)
	s.newestMu.Unlock()
}

func (s *Service) recomputeNewest(ctx context.Context, roomID string) {
	page, err := s.list(ctx, ListQuery{RoomID: roomID, Limit: 1})
	if err != nil {
		log.Printf("[Chat] Failed to recompute newest message of %s: %v", roomID, err)
		return
	}
	s.newestMu.Lock()
	defer s.newestMu.Unlock()
	if len(page) == 0 {
		delete(s.newest, roomID)
	} else {
		s.newest[roomID] = page[0].Seq
	}
}

// Flush checks pending tasks once: confirmed writes leave the overlay, failed
// ones are reverted and reported. Start calls it on a ticker; tests call it
// directly.
func (s *Service) Flush(ctx context.Context) {
	snap := s.ov.snapshot()
	if len(snap) == 0 {
		return
	}
	seen := map[int64]bool{}
	var uids []int64
	for _, p := range snap {
		for _, t := range p.tasks {
			if !seen[t] {
				seen[t] = true
				uids = append(uids, t)
			}
		}
	}
	tctx, cancel := context.WithTimeout(ctx, s.opts.CallTimeout)
	defer cancel()
	status, err := s.eng.Tasks(tctx, uids)
	if err != nil {
		return // Meilisearch is down; acknowledged writes are in its queue.
	}
	for id, p := range snap {
		failed, done := false, 0
		for _, t := range p.tasks {
			st := status[t]
			if st == TaskFailed || st == TaskCanceled {
				failed = true
				break
			}
			if st != TaskSucceeded {
				break
			}
			done++
		}
		switch {
		case failed:
			s.revert(ctx, id, p)
		case done > 0:
			s.ov.confirm(id, done)
		}
	}
}

// revert restores clients to Meilisearch's actual state after a failed task.
func (s *Service) revert(ctx context.Context, id string, p pendingSnapshot) {
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, cancel := context.WithTimeout(ctx, s.opts.CallTimeout)
	defer cancel()
	s.ov.drop(id)
	actual, err := s.eng.Get(ctx, id)
	if err != nil {
		log.Printf("[Chat] Failed to reload message %s after a failed write: %v", id, err)
		return
	}
	if p.isAdd {
		// A later partial PUT may have upserted a stub document; remove it.
		if actual != nil && actual.Content == "" && actual.SenderID == "" {
			if _, err := s.eng.DeleteDocument(ctx, id); err != nil {
				log.Printf("[Chat] Failed to delete stub message %s: %v", id, err)
			}
			actual = nil
		}
	}
	log.Printf("[Chat] Meilisearch rejected a write for message %s in room %s; reverting", id, p.roomID)
	rv := Revert{RoomID: p.roomID, ID: id, SenderID: p.senderID}
	if actual != nil && !actual.IsDeleted {
		rv.Message = actual
	}
	s.recomputeNewest(ctx, p.roomID)

	s.revertMu.RLock()
	fn := s.onRevert
	s.revertMu.RUnlock()
	if fn != nil {
		fn(rv)
	}
}

// PendingCount is the number of messages with unconfirmed writes.
func (s *Service) PendingCount() int { return s.ov.len() }
