package chatmedia

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

var (
	ErrNotFound    = errors.New("attachment not found")
	ErrForbidden   = errors.New("not allowed")
	ErrUnsupported = errors.New("unsupported file type")
	ErrTooLarge    = errors.New("file is too large")
	ErrBadImage    = errors.New("the image could not be read")
	// ErrFileExceedsQuota: the file alone is larger than the quota.
	ErrFileExceedsQuota = errors.New("file_exceeds_quota")
	// ErrQuotaProtectedFull: protected and pending files leave no room.
	ErrQuotaProtectedFull = errors.New("quota_protected_full")
	// ErrNotAttached: the operation needs a file attached to a message.
	ErrNotAttached = errors.New("attachment is not attached to a message")
	// ErrUnavailable: object storage failed.
	ErrUnavailable = errors.New("attachment storage unavailable")
)

// invalidError carries a user-facing reason (send with stale upload ids).
type invalidError struct{ msg string }

func (e invalidError) Error() string { return e.msg }

// ErrInvalid matches invalidError.
var ErrInvalid = errors.New("invalid attachments")

func (e invalidError) Is(target error) bool { return target == ErrInvalid }

const (
	pendingTTL       = 24 * time.Hour
	tombstoneTTL     = 90 * 24 * time.Hour
	janitorInterval  = time.Minute
	purgeBatch       = 200
	urlTTL           = 15 * time.Minute
	maxPeaks         = 200
	maxDurationMS    = 6 * 60 * 60 * 1000
	maxFilenameRunes = 200
	userLockShards   = 64
	// nextRemovalShare marks files removed next: the oldest unprotected
	// ones adding up to this share of the quota.
	nextRemovalShare = 10
)

// Limits are the upload limits in bytes.
type Limits struct {
	MaxImageBytes int64
	MaxAudioBytes int64
	MaxVideoBytes int64
	QuotaBytes    int64
}

// MessageHook updates the display copy of an attachment in its message
// document (and broadcasts the change). Errors are the hook's to log.
type MessageHook func(ctx context.Context, rec *Record, apply func(a *chatstore.Attachment) bool)

// Service manages attachments.
type Service struct {
	db     *storage.DB
	media  MediaStore
	limits Limits
	now    func() time.Time
	// async runs follow-up work (message document updates); tests make it
	// synchronous.
	async func(func())

	userLocks [userLockShards]sync.Mutex

	hookMu sync.RWMutex
	hook   MessageHook

	kick chan struct{}

	// Content extraction (extract.go); nil when disabled.
	extractor   Extractor
	contentHook ContentHook
	extractKick chan struct{}
	worker      workerState
}

// New creates a Service. Call Start to run the janitor.
func New(db *storage.DB, media MediaStore, limits Limits) *Service {
	return &Service{
		db: db, media: media, limits: limits, now: time.Now,
		async: func(f func()) { go f() },
		kick:  make(chan struct{}, 1),
	}
}

// SetMessageHook registers the message document updater.
func (s *Service) SetMessageHook(h MessageHook) {
	s.hookMu.Lock()
	s.hook = h
	s.hookMu.Unlock()
}

// Limits returns the configured limits.
func (s *Service) Limits() Limits { return s.limits }

func (s *Service) userLock(userID string) *sync.Mutex {
	h := fnv.New32a()
	_, _ = h.Write([]byte(userID))
	return &s.userLocks[h.Sum32()%userLockShards]
}

func (s *Service) maxFor(kind string) int64 {
	switch kind {
	case KindImage:
		return s.limits.MaxImageBytes
	case KindAudio:
		return s.limits.MaxAudioBytes
	default:
		return s.limits.MaxVideoBytes
	}
}

// MaxUploadBytes is the largest file any kind accepts.
func (s *Service) MaxUploadBytes() int64 {
	return max(s.limits.MaxImageBytes, s.limits.MaxAudioBytes, s.limits.MaxVideoBytes)
}

// File is an uploaded file (multipart.File satisfies it).
type File interface {
	io.Reader
	io.ReaderAt
	io.Seeker
}

// ClientMeta is display metadata measured by the client; never trusted
// beyond display (clamped, dropped when malformed).
type ClientMeta struct {
	Peaks      []int
	DurationMS int64
	Width      int
	Height     int
}

// UploadInput is one uploaded file.
type UploadInput struct {
	RoomID     string
	UploaderID string
	Filename   string
	File       File
	Size       int64
	Meta       ClientMeta
}

// UploadResult is a stored pending upload plus the files evicted for it.
type UploadResult struct {
	Record  *Record
	Evicted []*Record
	Usage   Usage
}

type object struct {
	key, contentType string
	body             io.ReadSeeker
	size             int64
}

// Upload stores a pending attachment. The objects are written first and
// the quota is reserved afterwards, so a failed write never evicts files.
func (s *Service) Upload(ctx context.Context, in UploadInput) (*UploadResult, error) {
	head := make([]byte, 512)
	n, err := in.File.ReadAt(head, 0)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	ft, ok := sniff(head[:n])
	if !ok {
		return nil, ErrUnsupported
	}
	if in.Size <= 0 || in.Size > s.maxFor(ft.kind) {
		return nil, ErrTooLarge
	}
	if in.Size > s.limits.QuotaBytes {
		return nil, ErrFileExceedsQuota
	}

	rec := &Record{
		ID: newID(), RoomID: in.RoomID, UploaderID: in.UploaderID,
		Kind: ft.kind, Mime: ft.mime, Ext: ft.ext, Filename: cleanFilename(in.Filename, ft.ext),
		Status: StatusPending, CreatedAt: s.now().UnixMilli(),
	}
	var objs []object
	switch ft.kind {
	case KindImage:
		data, err := io.ReadAll(io.NewSectionReader(in.File, 0, in.Size))
		if err != nil {
			return nil, err
		}
		img, err := processImage(data, ft)
		if err != nil {
			return nil, ErrBadImage
		}
		rec.Width, rec.Height, rec.HasThumb = img.width, img.height, true
		rec.SizeBytes = int64(len(img.original))
		objs = append(objs,
			object{rec.originalKey(), ft.mime, bytes.NewReader(img.original), int64(len(img.original))},
			object{rec.thumbKey(), "image/webp", bytes.NewReader(img.thumb), int64(len(img.thumb))})
	case KindAudio:
		rec.Peaks = validPeaks(in.Meta.Peaks)
		rec.DurationMS = clampDuration(in.Meta.DurationMS)
		rec.SizeBytes = in.Size
		objs = append(objs, object{rec.originalKey(), ft.mime, io.NewSectionReader(in.File, 0, in.Size), in.Size})
	case KindVideo:
		rec.DurationMS = clampDuration(in.Meta.DurationMS)
		if w, h := in.Meta.Width, in.Meta.Height; w > 0 && h > 0 && w <= maxImageDimension && h <= maxImageDimension {
			rec.Width, rec.Height = w, h
		}
		rec.SizeBytes = in.Size
		objs = append(objs, object{rec.originalKey(), ft.mime, io.NewSectionReader(in.File, 0, in.Size), in.Size})
	}
	for _, o := range objs {
		rec.StoredBytes += o.size
	}

	var written []string
	for _, o := range objs {
		if err := s.media.Put(ctx, o.key, o.body, o.size, o.contentType); err != nil {
			s.deleteObjects(written)
			return nil, errors.Join(ErrUnavailable, err)
		}
		written = append(written, o.key)
	}

	evicted, usage, err := s.reserve(rec)
	if err != nil {
		s.deleteObjects(written)
		return nil, err
	}
	s.afterRemoval(evicted)
	return &UploadResult{Record: rec, Evicted: evicted, Usage: usage}, nil
}

func (s *Service) deleteObjects(keys []string) {
	if len(keys) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := s.media.Delete(ctx, keys); err != nil {
		log.Printf("[ChatMedia] Failed to delete unreserved objects: %v", err)
	}
}

// reserve checks the quota, evicts the oldest unprotected attached files
// as needed and inserts the pending row, all in one transaction under the
// uploader's lock (docs/specs/CHAT_SYSTEM.md §7.12.3).
func (s *Service) reserve(rec *Record) (evicted []*Record, usage Usage, err error) {
	lock := s.userLock(rec.UploaderID)
	lock.Lock()
	defer lock.Unlock()
	quota := s.limits.QuotaBytes
	err = s.db.Transaction(func(tx *sql.Tx) error {
		u, err := usageOf(tx, rec.UploaderID)
		if err != nil {
			return err
		}
		need := rec.StoredBytes
		if need > quota {
			return ErrFileExceedsQuota
		}
		if need > quota-u.ProtectedBytes-u.PendingBytes {
			return ErrQuotaProtectedFull
		}
		if over := u.UsedBytes + need - quota; over > 0 {
			cands, err := queryRecords(tx, `uploader_id = ? AND status = 'attached' AND protected = 0
				ORDER BY created_at, id`, rec.UploaderID)
			if err != nil {
				return err
			}
			var pick []*Record
			var freed int64
			for _, c := range cands {
				if freed >= over {
					break
				}
				pick = append(pick, c)
				freed += c.StoredBytes
			}
			if evicted, err = markRemoved(tx, pick, ReasonQuota, s.now().UnixMilli()); err != nil {
				return err
			}
		}
		if err := insertRecord(tx, rec); err != nil {
			return err
		}
		usage, err = usageOf(tx, rec.UploaderID)
		return err
	})
	usage.QuotaBytes = quota
	return evicted, usage, err
}

// afterRemoval updates message documents of removed files (for removals of
// files whose message still exists) and wakes the janitor to purge them.
func (s *Service) afterRemoval(recs []*Record) {
	if len(recs) == 0 {
		return
	}
	select {
	case s.kick <- struct{}{}:
	default:
	}
	var docs []*Record
	for _, r := range recs {
		if r.MessageID != "" && r.RemovedReason != ReasonMessageDeleted && r.RemovedReason != ReasonChannelDeleted {
			docs = append(docs, r)
		}
	}
	if len(docs) == 0 {
		return
	}
	s.async(func() {
		messages := map[string]bool{}
		for _, r := range docs {
			reason := r.RemovedReason
			s.callHook(r, func(a *chatstore.Attachment) bool {
				if a.Removed == reason {
					return false
				}
				a.Removed = reason
				return true
			})
			messages[r.MessageID] = true
		}
		if s.extractor != nil {
			for id := range messages {
				s.refreshContent(id) // drop the removed files' text and vectors
			}
		}
	})
}

func (s *Service) callHook(rec *Record, apply func(a *chatstore.Attachment) bool) {
	s.hookMu.RLock()
	h := s.hook
	s.hookMu.RUnlock()
	if h == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	h(ctx, rec, apply)
}

// Attach validates pending uploads of uploaderID in roomID, runs create
// (which stores the message and returns its id) and marks the uploads
// attached. The uploader's lock is held throughout, so an upload id can be
// attached only once.
func (s *Service) Attach(ctx context.Context, uploaderID, roomID string, ids []string,
	create func(atts []chatstore.Attachment) (messageID string, err error)) error {
	if len(ids) > chatstore.MaxAttachmentsPerMessage {
		return invalidError{"too many attachments"}
	}
	lock := s.userLock(uploaderID)
	lock.Lock()
	defer lock.Unlock()

	seen := map[string]bool{}
	var atts []chatstore.Attachment
	var keep []string
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		rec, err := getRecord(s.db, id)
		if err != nil {
			return err
		}
		if rec == nil || rec.UploaderID != uploaderID || rec.RoomID != roomID || rec.Status != StatusPending {
			return invalidError{"an attachment is no longer available, remove it and try again"}
		}
		atts = append(atts, rec.display())
		keep = append(keep, id)
	}
	messageID, err := create(atts)
	if err != nil || len(keep) == 0 {
		return err
	}
	args := []any{messageID, s.now().UnixMilli()}
	for _, id := range keep {
		args = append(args, id)
	}
	_, err = s.db.Exec(`UPDATE chat_attachments SET status = 'attached', message_id = ?, attached_at = ?
		WHERE status = 'pending' AND id IN (`+placeholders(len(keep))+`)`, args...)
	if err == nil {
		s.kickExtractor()
	}
	return err
}

// display is the message document copy of a record.
func (r *Record) display() chatstore.Attachment {
	return chatstore.Attachment{
		ID: r.ID, Kind: r.Kind, Mime: r.Mime, Size: r.SizeBytes, Filename: r.Filename,
		Width: r.Width, Height: r.Height, DurationMS: r.DurationMS, HasThumb: r.HasThumb,
		Peaks: r.Peaks, Protected: r.Protected,
	}
}

// Get returns a record (any status) or ErrNotFound.
func (s *Service) Get(id string) (*Record, error) {
	rec, err := getRecord(s.db, id)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

// SetProtected protects a file from auto-removal (or allows it again).
// Callers check that the actor is the uploader.
func (s *Service) SetProtected(rec *Record, protected bool) (*Record, error) {
	if rec.Status != StatusAttached {
		return nil, ErrNotAttached
	}
	if rec.Protected == protected {
		return rec, nil
	}
	res, err := s.db.Exec(`UPDATE chat_attachments SET protected = ? WHERE id = ? AND status = 'attached'`,
		protected, rec.ID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotAttached
	}
	out := *rec
	out.Protected = protected
	s.async(func() {
		s.callHook(&out, func(a *chatstore.Attachment) bool {
			if a.Protected == protected {
				return false
			}
			a.Protected = protected
			return true
		})
	})
	return &out, nil
}

// Remove removes files (owner or moderator delete). Already removed files
// are skipped; the returned slice has the ones that changed.
func (s *Service) Remove(recs []*Record, reason string) ([]*Record, error) {
	changed, err := markRemoved(s.db, recs, reason, s.now().UnixMilli())
	if err != nil {
		return nil, err
	}
	s.afterRemoval(changed)
	return changed, nil
}

// RemoveForMessage removes the files of a deleted message.
func (s *Service) RemoveForMessage(messageID string) error {
	if messageID == "" {
		return nil
	}
	recs, err := queryRecords(s.db, `message_id = ? AND status != 'removed'`, messageID)
	if err != nil {
		return err
	}
	_, err = s.Remove(recs, ReasonMessageDeleted)
	return err
}

// RemoveRoom removes every file of a deleted channel.
func (s *Service) RemoveRoom(roomID string) error {
	recs, err := queryRecords(s.db, `room_id = ? AND status != 'removed'`, roomID)
	if err != nil {
		return err
	}
	_, err = s.Remove(recs, ReasonChannelDeleted)
	return err
}

// Usage returns a user's storage.
func (s *Service) Usage(userID string) (Usage, error) {
	u, err := usageOf(s.db, userID)
	u.QuotaBytes = s.limits.QuotaBytes
	return u, err
}

// ListFilter selects a user's own files for the storage page.
type ListFilter struct {
	Kind          string
	RoomID        string
	Sort          string // oldest (default) | newest | largest
	Query         string
	ProtectedOnly bool
	Offset        int
	Limit         int
}

// List returns a page of the user's pending and attached files and the
// next offset (0 = no more).
func (s *Service) List(userID string, f ListFilter) ([]*Record, int, error) {
	where := `uploader_id = ? AND status IN ('pending', 'attached')`
	args := []any{userID}
	if f.Kind != "" {
		where += ` AND kind = ?`
		args = append(args, f.Kind)
	}
	if f.RoomID != "" {
		where += ` AND room_id = ?`
		args = append(args, f.RoomID)
	}
	if f.ProtectedOnly {
		where += ` AND protected = 1`
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		where += ` AND filename LIKE ? ESCAPE '\'`
		args = append(args, "%"+likeEscaper.Replace(q)+"%")
	}
	switch f.Sort {
	case "newest":
		where += ` ORDER BY created_at DESC, id DESC`
	case "largest":
		where += ` ORDER BY stored_bytes DESC, id`
	default:
		where += ` ORDER BY created_at, id`
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := max(f.Offset, 0)
	where += ` LIMIT ? OFFSET ?`
	args = append(args, limit+1, offset)
	recs, err := queryRecords(s.db, where, args...)
	if err != nil {
		return nil, 0, err
	}
	next := 0
	if len(recs) > limit {
		recs = recs[:limit]
		next = offset + limit
	}
	return recs, next, nil
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// NextRemovalIDs are the user's oldest unprotected attached files that add
// up to about a tenth of the quota: the next ones auto-removal takes.
func (s *Service) NextRemovalIDs(userID string) (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT id, stored_bytes FROM chat_attachments
		WHERE uploader_id = ? AND status = 'attached' AND protected = 0
		ORDER BY created_at, id LIMIT 500`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	target := s.limits.QuotaBytes / nextRemovalShare
	out := map[string]bool{}
	var sum int64
	for rows.Next() && sum < target {
		var id string
		var size int64
		if err := rows.Scan(&id, &size); err != nil {
			return nil, err
		}
		out[id] = true
		sum += size
	}
	return out, rows.Err()
}

// URL presigns a download of a file. variant is original, thumb or
// download (original with Content-Disposition: attachment).
func (s *Service) URL(ctx context.Context, rec *Record, variant string) (string, time.Time, error) {
	key, disposition := rec.originalKey(), ""
	switch variant {
	case "thumb":
		if rec.HasThumb {
			key = rec.thumbKey()
		}
	case "download":
		disposition = "attachment; filename*=UTF-8''" + url.PathEscape(rec.Filename)
	}
	u, err := s.media.PresignGet(ctx, key, urlTTL, disposition)
	if err != nil {
		return "", time.Time{}, errors.Join(ErrUnavailable, err)
	}
	return u, s.now().Add(urlTTL), nil
}

// Start runs the janitor (and the extraction worker, when an Extractor is
// set) until ctx ends.
func (s *Service) Start(ctx context.Context) {
	s.startExtractor(ctx)
	go func() {
		ticker := time.NewTicker(janitorInterval)
		defer ticker.Stop()
		for {
			s.RunJanitor(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-s.kick:
			}
		}
	}()
}

// RunJanitor expires stale pending uploads, deletes the objects of removed
// files (retrying failures on the next run) and prunes old tombstones.
func (s *Service) RunJanitor(ctx context.Context) {
	now := s.now()
	stale, err := queryRecords(s.db, `status = 'pending' AND created_at < ?`, now.Add(-pendingTTL).UnixMilli())
	if err != nil {
		log.Printf("[ChatMedia] Janitor: failed to list stale uploads: %v", err)
	} else if _, err := s.Remove(stale, ReasonPendingExpired); err != nil {
		log.Printf("[ChatMedia] Janitor: failed to expire uploads: %v", err)
	}

	for {
		recs, err := queryRecords(s.db, `status = 'removed' AND purged_at IS NULL ORDER BY removed_at LIMIT ?`, purgeBatch)
		if err != nil {
			log.Printf("[ChatMedia] Janitor: failed to list removed files: %v", err)
			break
		}
		if len(recs) == 0 {
			break
		}
		var keys []string
		args := []any{s.now().UnixMilli()}
		for _, r := range recs {
			keys = append(keys, r.keys()...)
			args = append(args, r.ID)
		}
		dctx, cancel := context.WithTimeout(ctx, time.Minute)
		err = s.media.Delete(dctx, keys)
		cancel()
		if err != nil {
			log.Printf("[ChatMedia] Janitor: failed to delete %d objects (will retry): %v", len(keys), err)
			break
		}
		if _, err := s.db.Exec(`UPDATE chat_attachments SET purged_at = ? WHERE id IN (`+placeholders(len(recs))+`)`, args...); err != nil {
			log.Printf("[ChatMedia] Janitor: failed to mark purged files: %v", err)
			break
		}
		if len(recs) < purgeBatch {
			break
		}
	}

	s.pruneJobs()
	if _, err := s.db.Exec(`DELETE FROM chat_attachments WHERE status = 'removed' AND purged_at IS NOT NULL AND purged_at < ?`,
		now.Add(-tombstoneTTL).UnixMilli()); err != nil {
		log.Printf("[ChatMedia] Janitor: failed to prune tombstones: %v", err)
	}
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// cleanFilename keeps a safe display name: base name only, no control
// characters, bounded length; empty names get "file.<ext>".
func cleanFilename(name, ext string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(strings.ToValidUTF8(name, ""))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '"' {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == "/" {
		return "file." + ext
	}
	if utf8.RuneCountInString(name) > maxFilenameRunes {
		r := []rune(name)
		name = string(r[:maxFilenameRunes])
	}
	return name
}

func validPeaks(p []int) []int {
	if len(p) == 0 || len(p) > maxPeaks {
		return nil
	}
	for _, v := range p {
		if v < 0 || v > 255 {
			return nil
		}
	}
	return append([]int(nil), p...)
}

func clampDuration(ms int64) int64 {
	if ms <= 0 {
		return 0
	}
	return min(ms, maxDurationMS)
}

// String is for logs.
func (r *Record) String() string {
	return fmt.Sprintf("%s (%s, %d bytes, %s)", r.ID, r.Kind, r.StoredBytes, r.Status)
}
