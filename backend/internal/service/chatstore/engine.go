package chatstore

import "context"

// ListQuery selects a page of a channel's non-deleted messages ordered by seq.
// Bounds are exclusive; zero means unbounded.
type ListQuery struct {
	RoomID    string
	BeforeSeq int64
	AfterSeq  int64
	BeforeTS  int64 // created_at_ts < BeforeTS
	Asc       bool
	Limit     int
}

// matches reports whether m falls inside q's room and bounds (ignores Limit).
func (q ListQuery) matches(m *Message) bool {
	if m.RoomID != q.RoomID || m.IsDeleted {
		return false
	}
	if q.BeforeSeq > 0 && m.Seq >= q.BeforeSeq {
		return false
	}
	if q.AfterSeq > 0 && m.Seq <= q.AfterSeq {
		return false
	}
	if q.BeforeTS > 0 && m.CreatedAtTS >= q.BeforeTS {
		return false
	}
	return true
}

// TaskStatus is the state of an asynchronous Meilisearch write.
type TaskStatus string

const (
	TaskEnqueued   TaskStatus = "enqueued"
	TaskProcessing TaskStatus = "processing"
	TaskSucceeded  TaskStatus = "succeeded"
	TaskFailed     TaskStatus = "failed"
	TaskCanceled   TaskStatus = "canceled"
)

// Done reports whether the task reached a final state.
func (s TaskStatus) Done() bool {
	return s == TaskSucceeded || s == TaskFailed || s == TaskCanceled
}

// Engine is the storage the Service writes to. Writes are asynchronous: they
// return once the task is enqueued (and persisted), with its task id.
// The production implementation is Meili; MemoryEngine backs tests.
type Engine interface {
	// Bootstrap creates the index and applies settings (idempotent).
	Bootstrap(ctx context.Context) error
	Health(ctx context.Context) error

	Add(ctx context.Context, m *Message) (int64, error)
	// Patch merges top-level fields into an existing document.
	Patch(ctx context.Context, id string, fields map[string]any) (int64, error)
	DeleteDocument(ctx context.Context, id string) (int64, error)
	DeleteRoom(ctx context.Context, roomID string) (int64, error)

	// Get returns the stored document (deleted or not); nil when missing.
	Get(ctx context.Context, id string) (*Message, error)
	// Fetch returns the documents that exist among ids, in any order.
	Fetch(ctx context.Context, ids []string) ([]*Message, error)
	List(ctx context.Context, q ListQuery) ([]*Message, error)
	// NewestSeqs returns the newest non-deleted seq per room (absent = empty).
	NewestSeqs(ctx context.Context, roomIDs []string) (map[string]int64, error)
	// MaxSeq returns the highest seq ever stored, deleted messages included.
	MaxSeq(ctx context.Context) (int64, error)

	// Pins lists pinned, non-deleted messages of a room, newest pin first.
	Pins(ctx context.Context, roomID string, limit int) ([]*Message, error)
	// Search runs a search over non-deleted messages of req.RoomIDs.
	Search(ctx context.Context, req SearchRequest) (*SearchResult, error)
	// ImageEmbedderDims returns the size of the ImageEmbedder, 0 if absent.
	ImageEmbedderDims(ctx context.Context) (int, error)
	// SetImageEmbedder creates or replaces the ImageEmbedder.
	SetImageEmbedder(ctx context.Context, dims int) error
	// CountMentions counts non-deleted messages after AfterSeq that mention
	// the user directly or through one of RoleIDs, per query.
	CountMentions(ctx context.Context, qs []MentionCountQuery) ([]int, error)

	Tasks(ctx context.Context, uids []int64) (map[int64]TaskStatus, error)
}
