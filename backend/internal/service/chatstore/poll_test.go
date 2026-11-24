package chatstore

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const (
	pollAuthor = "qkUrdzLDoqslx8EEy2cM7Q=="
	pollBob    = "Z9n-x_2LDoqslx8EEy2cM7Q="
	pollCarol  = "c4rol_LDoqslx8EEy2cM7Q=="
	pollRoom   = "20261110145113MiTbtB"
)

func mustPoll(t *testing.T, s *Service, in PollInput) *Message {
	t.Helper()
	p, err := NormalizePoll(&in, s.Now())
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.Create(context.Background(), CreateInput{RoomID: pollRoom, SenderID: pollAuthor, Poll: p})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestNormalizePoll(t *testing.T) {
	now := time.UnixMilli(1_762_770_000_000)
	in := func(mut func(*PollInput)) *PollInput {
		p := &PollInput{Question: "  Pizza\nor sushi? ", Options: []string{"Pizza", " ", "Sushi"}}
		if mut != nil {
			mut(p)
		}
		return p
	}
	p, err := NormalizePoll(in(nil), now)
	if err != nil {
		t.Fatal(err)
	}
	if p.Question != "Pizza or sushi?" || len(p.Options) != 2 || p.Options[1].ID != "o2" || p.Options[1].Text != "Sushi" {
		t.Fatalf("poll = %+v", p)
	}
	if len(p.Votes) != 2 {
		t.Fatalf("votes not normalized: %+v", p.Votes)
	}
	future := now.Add(time.Hour).UnixMilli()
	if p, err := NormalizePoll(in(func(p *PollInput) { p.ClosesAtTS = &future }), now); err != nil || *p.ClosesAtTS != future {
		t.Fatalf("due date: %v %v", p, err)
	}

	past, far := now.Add(-time.Minute).UnixMilli(), now.Add(40*24*time.Hour).UnixMilli()
	many := make([]string, MaxPollOptions+1)
	for i := range many {
		many[i] = strings.Repeat("x", i+1)
	}
	bad := map[string]func(*PollInput){
		"no question":   func(p *PollInput) { p.Question = " " },
		"long question": func(p *PollInput) { p.Question = strings.Repeat("q", MaxPollQuestionRunes+1) },
		"one option":    func(p *PollInput) { p.Options = []string{"a", ""} },
		"duplicates":    func(p *PollInput) { p.Options = []string{"Yes", "yes"} },
		"long option":   func(p *PollInput) { p.Options = []string{"a", strings.Repeat("o", MaxPollOptionRunes+1)} },
		"too many":      func(p *PollInput) { p.Options = many },
		"past due":      func(p *PollInput) { p.ClosesAtTS = &past },
		"too far":       func(p *PollInput) { p.ClosesAtTS = &far },
	}
	for name, mut := range bad {
		if _, err := NormalizePoll(in(mut), now); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if p, err := NormalizePoll(nil, now); p != nil || err != nil {
		t.Fatal("nil input must stay nil")
	}
}

func TestPollVoteRules(t *testing.T) {
	s, _, clock := newTestService(t)
	ctx := context.Background()
	single := mustPoll(t, s, PollInput{Question: "Lunch?", Options: []string{"Pizza", "Sushi", "Soup"}, AllowChange: true})

	if _, err := s.Vote(ctx, single.ID, pollBob, []string{"o1", "o2"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("two answers in a single-choice poll: %v", err)
	}
	if _, err := s.Vote(ctx, single.ID, pollBob, []string{"o9"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown option: %v", err)
	}
	if _, err := s.Vote(ctx, single.ID, pollBob, []string{"o1"}); err != nil {
		t.Fatal(err)
	}
	// Changing the vote moves it.
	m, err := s.Vote(ctx, single.ID, pollBob, []string{"o2"})
	if err != nil {
		t.Fatal(err)
	}
	if got := m.Poll.votesOf(pollBob); len(got) != 1 || got[0] != "o2" || len(m.Poll.Votes[0].UserIDs) != 0 {
		t.Fatalf("after change: %+v", m.Poll.Votes)
	}
	// Retract.
	if m, err = s.Vote(ctx, single.ID, pollBob, nil); err != nil || m.Poll.VoterCount() != 0 {
		t.Fatalf("retract: %v %+v", err, m.Poll.Votes)
	}

	multi := mustPoll(t, s, PollInput{Question: "Days?", Options: []string{"Mon", "Tue", "Wed"}, Multiple: true})
	if m, err = s.Vote(ctx, multi.ID, pollBob, []string{"o1", "o3", "o1"}); err != nil {
		t.Fatal(err)
	}
	if got := m.Poll.votesOf(pollBob); len(got) != 2 {
		t.Fatalf("multi votes = %v", got)
	}
	// AllowChange off: the first vote is final (resending it is fine).
	if _, err := s.Vote(ctx, multi.ID, pollBob, []string{"o1", "o3"}); err != nil {
		t.Fatalf("same vote again: %v", err)
	}
	if _, err := s.Vote(ctx, multi.ID, pollBob, []string{"o2"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("changed a final vote: %v", err)
	}
	if _, err := s.Vote(ctx, multi.ID, pollBob, nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("retracted a final vote: %v", err)
	}

	// Past its due date a poll takes no votes, even before the closer ran.
	due := clock.Now().Add(time.Hour).UnixMilli()
	timed := mustPoll(t, s, PollInput{Question: "Soon?", Options: []string{"a", "b"}, ClosesAtTS: &due})
	clock.mu.Lock()
	clock.t = clock.t.Add(2 * time.Hour)
	clock.mu.Unlock()
	if _, err := s.Vote(ctx, timed.ID, pollBob, []string{"o1"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("vote after due date: %v", err)
	}

	plain := mustCreate(t, s, pollRoom, pollAuthor, "not a poll")
	if _, err := s.Vote(ctx, plain.ID, pollBob, []string{"o1"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("vote on a plain message: %v", err)
	}
	if _, err := s.Edit(ctx, single.ID, pollAuthor, "edited"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("poll edited: %v", err)
	}
}

func TestPollPublicView(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	pub := mustPoll(t, s, PollInput{Question: "Public?", Options: []string{"a", "b"}})
	anon := mustPoll(t, s, PollInput{Question: "Secret?", Options: []string{"a", "b"}, Anonymous: true})
	for _, id := range []string{pub.ID, anon.ID} {
		if _, err := s.Vote(ctx, id, pollBob, []string{"o1"}); err != nil {
			t.Fatal(err)
		}
	}
	pub, _ = s.Get(ctx, pub.ID)
	anon, _ = s.Get(ctx, anon.ID)

	// A viewer who hasn't voted sees only the voter count.
	v := pub.PublicFor(pollCarol).Poll
	if v.ResultsVisible || v.Options[0].Count != nil || v.Options[0].UserIDs != nil || v.VoterCount != 1 || len(v.MyVotes) != 0 {
		t.Fatalf("non-voter view = %+v", v)
	}
	raw, _ := json.Marshal(pub.Public())
	if strings.Contains(string(raw), pollBob) || strings.Contains(string(raw), `"votes"`) {
		t.Fatalf("Public() leaks votes: %s", raw)
	}
	// The voter sees counts and, in a public poll, who voted.
	v = pub.PublicFor(pollBob).Poll
	if !v.ResultsVisible || *v.Options[0].Count != 1 || *v.Options[1].Count != 0 || v.Options[0].UserIDs[0] != pollBob || v.MyVotes[0] != "o1" {
		t.Fatalf("voter view = %+v", v)
	}
	// Anonymous: counts but never user ids, for anyone.
	raw, _ = json.Marshal(anon.PublicFor(pollBob))
	if strings.Contains(string(raw), pollBob) {
		t.Fatalf("anonymous poll leaks the voter: %s", raw)
	}
	if v := anon.PublicFor(pollBob).Poll; *v.Options[0].Count != 1 {
		t.Fatalf("anonymous voter view = %+v", v)
	}

	// Closing shows results to everyone.
	closed, changed, err := s.ClosePoll(ctx, pub.ID, pollAuthor, nil)
	if err != nil || !changed {
		t.Fatalf("close: %v %v", changed, err)
	}
	if v := closed.PublicFor(pollCarol).Poll; !v.Closed || !v.ResultsVisible || *v.Options[0].Count != 1 {
		t.Fatalf("closed view = %+v", v)
	}
	if _, err := s.Vote(ctx, pub.ID, pollCarol, []string{"o2"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("vote on a closed poll: %v", err)
	}
}

func TestClosePollPermissionAndIdempotence(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustPoll(t, s, PollInput{Question: "Q?", Options: []string{"a", "b"}})
	if _, _, err := s.ClosePoll(ctx, m.ID, pollBob, func(string) bool { return false }); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-author closed it: %v", err)
	}
	if _, changed, err := s.ClosePoll(ctx, m.ID, pollBob, func(string) bool { return true }); err != nil || !changed {
		t.Fatalf("moderator close: %v %v", changed, err)
	}
	if _, changed, err := s.ClosePoll(ctx, m.ID, SystemSenderID, nil); err != nil || changed {
		t.Fatalf("second close: changed=%v err=%v", changed, err)
	}
}

func TestPollResult(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustPoll(t, s, PollInput{Question: "Q?", Options: []string{"a", "b", "c"}, Multiple: true})
	if w, top, voters := m.Poll.PollResult(); len(w) != 0 || top != 0 || voters != 0 {
		t.Fatalf("empty result = %v %d %d", w, top, voters)
	}
	_, _ = s.Vote(ctx, m.ID, pollBob, []string{"o1", "o2"})
	m, _ = s.Vote(ctx, m.ID, pollCarol, []string{"o2"})
	if w, top, voters := m.Poll.PollResult(); len(w) != 1 || w[0] != "b" || top != 2 || voters != 2 {
		t.Fatalf("result = %v %d %d", w, top, voters)
	}
	m, _ = s.Vote(ctx, m.ID, pollAuthor, []string{"o1"})
	if w, _, _ := m.Poll.PollResult(); len(w) != 2 {
		t.Fatalf("tie = %v", w)
	}
}

func TestPollIsSearchable(t *testing.T) {
	s, _, _ := newTestService(t)
	m := mustPoll(t, s, PollInput{Question: "Where to go?", Options: []string{"Mountains", "Seaside"}})
	if !strings.Contains(m.ContentSearch, "Mountains") || !strings.Contains(m.ContentSearch, "Where to go?") {
		t.Fatalf("content_search = %q", m.ContentSearch)
	}
}
