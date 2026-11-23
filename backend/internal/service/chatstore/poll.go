package chatstore

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Polls (docs/specs/CHAT_SYSTEM.md §7.18). A poll is part of its message
// document, like reactions. Votes are stored with user ids (so a vote can
// be changed), but clients only ever get a per-viewer view (PublicFor):
// results stay hidden until the viewer voted or the poll closed, and the
// voters of an anonymous poll are never sent to anyone.

const (
	MaxPollQuestionRunes = 300
	MaxPollOptionRunes   = 100
	MinPollOptions       = 2
	MaxPollOptions       = 10
	// MinPollDuration / MaxPollDuration bound a due date.
	MinPollDuration = 30 * time.Second
	MaxPollDuration = 31 * 24 * time.Hour
)

// PollOption is one answer.
type PollOption struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// PollVote is one option with the users who picked it.
type PollVote struct {
	OptionID string   `json:"option_id"`
	UserIDs  []string `json:"user_ids"`
}

// Poll is the stored poll (never sent to clients as-is).
type Poll struct {
	Question    string       `json:"question"`
	Options     []PollOption `json:"options"`
	Multiple    bool         `json:"multiple"`
	Anonymous   bool         `json:"anonymous"`
	AllowChange bool         `json:"allow_change"`
	// ClosesAtTS is the due date (unix ms); nil means no due date.
	ClosesAtTS *int64     `json:"closes_at_ts"`
	Closed     bool       `json:"closed"`
	ClosedAtTS *int64     `json:"closed_at_ts"`
	ClosedBy   *string    `json:"closed_by"`
	Votes      []PollVote `json:"votes"`
}

// PollInput is a poll as a client sends it.
type PollInput struct {
	Question    string   `json:"question"`
	Options     []string `json:"options"`
	Multiple    bool     `json:"multiple"`
	Anonymous   bool     `json:"anonymous"`
	AllowChange bool     `json:"allow_change"`
	ClosesAtTS  *int64   `json:"closes_at_ts"`
}

// PublicPollOption is an option as one viewer sees it. Count is set only
// when results are visible to the viewer; UserIDs also needs a public poll.
type PublicPollOption struct {
	ID      string   `json:"id"`
	Text    string   `json:"text"`
	Count   *int     `json:"count,omitempty"`
	UserIDs []string `json:"user_ids,omitempty"`
}

// PublicPoll is the per-viewer client view of a poll.
type PublicPoll struct {
	Question    string             `json:"question"`
	Options     []PublicPollOption `json:"options"`
	Multiple    bool               `json:"multiple"`
	Anonymous   bool               `json:"anonymous"`
	AllowChange bool               `json:"allow_change"`
	ClosesAtTS  *int64             `json:"closes_at_ts"`
	Closed      bool               `json:"closed"`
	ClosedAtTS  *int64             `json:"closed_at_ts"`
	ClosedBy    *string            `json:"closed_by"`
	// VoterCount is the number of distinct users who voted.
	VoterCount int `json:"voter_count"`
	// MyVotes are the option ids the viewer picked.
	MyVotes []string `json:"my_votes"`
	// ResultsVisible: the viewer voted or the poll is closed.
	ResultsVisible bool `json:"results_visible"`
}

// NormalizePoll validates a client poll. A nil input stays nil.
func NormalizePoll(in *PollInput, now time.Time) (*Poll, error) {
	if in == nil {
		return nil, nil
	}
	question := oneLine(in.Question)
	if question == "" {
		return nil, invalid("the poll needs a question")
	}
	if len(question) > maxContentBytes || EmojiTextLength(question) > MaxPollQuestionRunes {
		return nil, invalid("the poll question is too long")
	}
	var options []PollOption
	seen := map[string]bool{}
	for _, raw := range in.Options {
		text := oneLine(raw)
		if text == "" {
			continue
		}
		if len(text) > 4*1024 || EmojiTextLength(text) > MaxPollOptionRunes {
			return nil, invalid("a poll option is too long")
		}
		key := strings.ToLower(text)
		if seen[key] {
			return nil, invalid("poll options must be different")
		}
		seen[key] = true
		options = append(options, PollOption{ID: "o" + strconv.Itoa(len(options)+1), Text: text})
	}
	if len(options) < MinPollOptions {
		return nil, invalid("a poll needs at least 2 options")
	}
	if len(options) > MaxPollOptions {
		return nil, invalid("a poll can have at most 10 options")
	}
	p := &Poll{
		Question: question, Options: options,
		Multiple: in.Multiple, Anonymous: in.Anonymous, AllowChange: in.AllowChange,
	}
	if in.ClosesAtTS != nil {
		at := *in.ClosesAtTS
		if at < now.Add(MinPollDuration).UnixMilli() {
			return nil, invalid("the poll's end time must be in the future")
		}
		if at > now.Add(MaxPollDuration).UnixMilli() {
			return nil, invalid("a poll can run for at most 31 days")
		}
		p.ClosesAtTS = &at
	}
	p.normalize()
	return p, nil
}

// searchText is what makes a poll findable by search.
func (p *Poll) searchText() string {
	parts := []string{p.Question}
	for _, o := range p.Options {
		parts = append(parts, o.Text)
	}
	return strings.Join(parts, "\n")
}

// normalize keeps one vote entry per option, in option order.
func (p *Poll) normalize() {
	byID := make(map[string][]string, len(p.Votes))
	for _, v := range p.Votes {
		byID[v.OptionID] = v.UserIDs
	}
	votes := make([]PollVote, len(p.Options))
	for i, o := range p.Options {
		votes[i] = PollVote{OptionID: o.ID, UserIDs: nonNil(byID[o.ID])}
	}
	p.Votes = votes
}

func (p *Poll) clone() *Poll {
	if p == nil {
		return nil
	}
	c := *p
	c.Options = append([]PollOption(nil), p.Options...)
	c.Votes = make([]PollVote, len(p.Votes))
	for i, v := range p.Votes {
		c.Votes[i] = PollVote{OptionID: v.OptionID, UserIDs: append([]string(nil), v.UserIDs...)}
	}
	if p.ClosesAtTS != nil {
		v := *p.ClosesAtTS
		c.ClosesAtTS = &v
	}
	if p.ClosedAtTS != nil {
		v := *p.ClosedAtTS
		c.ClosedAtTS = &v
	}
	if p.ClosedBy != nil {
		v := *p.ClosedBy
		c.ClosedBy = &v
	}
	return &c
}

// Ended: closed, or past its due date (the closer may not have run yet).
func (p *Poll) Ended(now time.Time) bool {
	return p.Closed || (p.ClosesAtTS != nil && now.UnixMilli() >= *p.ClosesAtTS)
}

// votesOf returns the option ids a user picked.
func (p *Poll) votesOf(userID string) []string {
	out := []string{}
	if userID == "" {
		return out
	}
	for _, v := range p.Votes {
		if contains(v.UserIDs, userID) {
			out = append(out, v.OptionID)
		}
	}
	return out
}

// VoterCount counts distinct voters.
func (p *Poll) VoterCount() int {
	seen := map[string]bool{}
	for _, v := range p.Votes {
		for _, u := range v.UserIDs {
			seen[u] = true
		}
	}
	return len(seen)
}

// public builds the view of one viewer ("" = nobody in particular: results
// hidden unless the poll is closed).
func (p *Poll) public(viewerID string) *PublicPoll {
	if p == nil {
		return nil
	}
	c := p.clone()
	c.normalize()
	mine := c.votesOf(viewerID)
	visible := c.Closed || len(mine) > 0
	out := &PublicPoll{
		Question: c.Question, Multiple: c.Multiple, Anonymous: c.Anonymous, AllowChange: c.AllowChange,
		ClosesAtTS: c.ClosesAtTS, Closed: c.Closed, ClosedAtTS: c.ClosedAtTS, ClosedBy: c.ClosedBy,
		VoterCount: c.VoterCount(), MyVotes: mine, ResultsVisible: visible,
		Options: make([]PublicPollOption, len(c.Options)),
	}
	for i, o := range c.Options {
		po := PublicPollOption{ID: o.ID, Text: o.Text}
		if visible {
			n := len(c.Votes[i].UserIDs)
			po.Count = &n
			if !c.Anonymous && n > 0 {
				po.UserIDs = c.Votes[i].UserIDs
			}
		}
		out.Options[i] = po
	}
	return out
}

// PollResult summarizes a closed poll: the leading option(s), their vote
// count and the number of voters. No winners when nobody voted.
func (p *Poll) PollResult() (winners []string, top int, voters int) {
	c := p.clone()
	c.normalize()
	for i, v := range c.Votes {
		n := len(v.UserIDs)
		switch {
		case n == 0:
		case n > top:
			top, winners = n, []string{c.Options[i].Text}
		case n == top:
			winners = append(winners, c.Options[i].Text)
		}
	}
	return winners, top, c.VoterCount()
}

// Vote replaces a user's choice in a poll; no options retracts the vote.
func (s *Service) Vote(ctx context.Context, id, userID string, optionIDs []string) (*Message, error) {
	return s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		p := m.Poll
		if p == nil {
			return nil, invalid("this message is not a poll")
		}
		if p.Ended(s.opts.Now()) {
			return nil, invalid("this poll has ended")
		}
		p.normalize()
		want := map[string]bool{}
		for _, oid := range optionIDs {
			found := false
			for _, o := range p.Options {
				if o.ID == oid {
					found = true
					break
				}
			}
			if !found {
				return nil, invalid("unknown poll option")
			}
			want[oid] = true
		}
		if !p.Multiple && len(want) > 1 {
			return nil, invalid("this poll allows only one answer")
		}
		prev := p.votesOf(userID)
		if sameSet(prev, want) {
			return nil, nil
		}
		if len(prev) > 0 && !p.AllowChange {
			return nil, invalid("votes in this poll can't be changed")
		}
		for i := range p.Votes {
			users := p.Votes[i].UserIDs[:0:0]
			for _, u := range p.Votes[i].UserIDs {
				if u != userID {
					users = append(users, u)
				}
			}
			if want[p.Votes[i].OptionID] {
				users = append(users, userID)
			}
			p.Votes[i].UserIDs = users
		}
		return map[string]any{"poll": p}, nil
	})
}

func sameSet(have []string, want map[string]bool) bool {
	if len(have) != len(want) {
		return false
	}
	for _, h := range have {
		if !want[h] {
			return false
		}
	}
	return true
}

// ClosePoll ends a poll. The author may always; the server closes it as
// SystemSenderID at its due date; others need canManage(roomID).
// changed is false when it was already closed.
func (s *Service) ClosePoll(ctx context.Context, id, actorID string, canManage func(roomID string) bool) (msg *Message, changed bool, err error) {
	msg, err = s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		if m.Poll == nil {
			return nil, invalid("this message is not a poll")
		}
		if actorID != SystemSenderID && m.SenderID != actorID && (canManage == nil || !canManage(m.RoomID)) {
			return nil, ErrForbidden
		}
		if m.Poll.Closed {
			return nil, nil
		}
		changed = true
		now := s.opts.Now().UnixMilli()
		actor := actorID
		m.Poll.normalize()
		m.Poll.Closed, m.Poll.ClosedAtTS, m.Poll.ClosedBy = true, &now, &actor
		return map[string]any{"poll": m.Poll}, nil
	})
	return msg, changed, err
}

// PollDeadline is a poll with a due date that hasn't closed yet.
type PollDeadline struct {
	MessageID string
	RoomID    string
	DueAtMS   int64
}

// PollDeadlineStore persists due dates (SQLite in production,
// repository.TextPollRepository).
type PollDeadlineStore interface {
	Add(d PollDeadline) error
	// TakeDue deletes deadlines with due_at <= nowMS and returns them.
	TakeDue(nowMS int64) ([]PollDeadline, error)
	DeleteByMessage(messageID string) error
}

// MemoryPollDeadlines is a PollDeadlineStore for memory-only mode and tests.
type MemoryPollDeadlines struct {
	mu    sync.Mutex
	items map[string]PollDeadline
}

func NewMemoryPollDeadlines() *MemoryPollDeadlines {
	return &MemoryPollDeadlines{items: map[string]PollDeadline{}}
}

func (m *MemoryPollDeadlines) Add(d PollDeadline) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.items[d.MessageID] = d
	return nil
}

func (m *MemoryPollDeadlines) TakeDue(nowMS int64) ([]PollDeadline, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var due []PollDeadline
	for id, d := range m.items {
		if d.DueAtMS <= nowMS {
			due = append(due, d)
			delete(m.items, id)
		}
	}
	sort.Slice(due, func(i, j int) bool { return due[i].DueAtMS < due[j].DueAtMS })
	return due, nil
}

func (m *MemoryPollDeadlines) DeleteByMessage(messageID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.items, messageID)
	return nil
}
