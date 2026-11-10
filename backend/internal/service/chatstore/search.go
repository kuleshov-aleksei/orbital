package chatstore

import (
	"context"
	"time"
)

// Highlight markers in snippets: control characters, so they can never come
// from user text; clients replace them after rendering (§15 gotchas).
const (
	HighlightPre  = "\u0001"
	HighlightPost = "\u0002"
)

const (
	// DefaultSearchLimit is the search page size.
	DefaultSearchLimit = 25
	// MaxSearchLimit caps limit on search requests.
	MaxSearchLimit = 50
)

// SearchRequest is a resolved search. RoomIDs must be non-empty: it is the
// caller's set of channels the user may view (intersected with in:).
type SearchRequest struct {
	Text           string
	RoomIDs        []string
	SenderIDs      []string
	MentionUserIDs []string
	FromTS, ToTS   int64 // created_at_ts >= FromTS, < ToTS; 0 = unbounded
	Pinned         *bool
	SortNewest     bool
	Limit, Offset  int
}

// SearchHit is one result: the message plus a highlighted snippet of
// content_search (empty without free text).
type SearchHit struct {
	Message *Message
	Snippet string
}

// SearchResult is a page of hits; Total is an estimate.
type SearchResult struct {
	Hits  []SearchHit
	Total int
}

// MentionCountQuery counts a user's unread mentions in one channel.
type MentionCountQuery struct {
	RoomID   string
	AfterSeq int64
	UserID   string
	RoleIDs  []string
}

// Search runs a full-text/filter search. Pending deletes are hidden and
// pending edits replace the stored message (the snippet may lag behind).
func (s *Service) Search(ctx context.Context, req SearchRequest) (*SearchResult, error) {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	if len(req.RoomIDs) == 0 {
		return &SearchResult{Hits: []SearchHit{}}, nil
	}
	if req.Limit <= 0 {
		req.Limit = DefaultSearchLimit
	}
	req.Limit = min(req.Limit, MaxSearchLimit)
	req.Offset = max(req.Offset, 0)
	res, err := s.eng.Search(ctx, req)
	if err != nil {
		return nil, engineErr(err)
	}
	hits := make([]SearchHit, 0, len(res.Hits))
	for _, h := range res.Hits {
		if p := s.ov.get(h.Message.ID); p != nil {
			if p.IsDeleted {
				continue
			}
			h.Message = p
		}
		hits = append(hits, h)
	}
	res.Hits = hits
	return res, nil
}

// MentionCounts returns unread mention counts, one per query, in one request.
func (s *Service) MentionCounts(ctx context.Context, qs []MentionCountQuery) ([]int, error) {
	if len(qs) == 0 {
		return nil, nil
	}
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	counts, err := s.eng.CountMentions(ctx, qs)
	return counts, engineErr(err)
}

// Now is the service clock (for callers that need the same time source).
func (s *Service) Now() time.Time { return s.opts.Now() }
