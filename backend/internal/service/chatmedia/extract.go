package chatmedia

import (
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"log"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

// Content extraction (docs/specs/CHAT_SYSTEM.md §7.13): a worker sends the
// images of attached files to an Extractor (OCR text, image embedding) and
// writes the results into the message document through a ContentHook.
// Results live in chat_attachment_jobs, so removing one file of a message
// rebuilds the document fields from the files that remain.

// ErrExtractorUnavailable marks extractor failures that say nothing about
// the file (service down, timeout, 5xx). They pause the worker instead of
// using up the job's attempts.
var ErrExtractorUnavailable = errors.New("content extractor unavailable")

// Extraction is what an Extractor found in one image.
type Extraction struct {
	Text   string
	Vector []float32
}

// Extractor reads the content of images.
type Extractor interface {
	// Signature names the models in use; done jobs with another signature
	// run again (a model change re-indexes old files).
	Signature() string
	// Extract reads one image (JPEG, at most extractBox pixels per side).
	Extract(ctx context.Context, image []byte) (Extraction, error)
}

// ContentHook writes the extracted content of a message's live files into
// its document: text joined in file order and one vector per image file.
type ContentHook func(ctx context.Context, messageID, text string, vectors [][]float32) error

const (
	extractInterval    = 30 * time.Second
	extractBatch       = 20
	extractMaxAttempts = 6
	extractTimeout     = 3 * time.Minute // first use downloads and loads models
	// extractPause is the wait after ErrExtractorUnavailable.
	extractPause    = time.Minute
	extractMaxDelay = 6 * time.Hour
	maxExtractText  = 20000 // bytes of OCR text kept per file
)

// SetExtractor enables content extraction; call before Start.
func (s *Service) SetExtractor(e Extractor, hook ContentHook) {
	s.extractor, s.contentHook = e, hook
	s.extractKick = make(chan struct{}, 1)
}

func (s *Service) kickExtractor() {
	if s.extractKick == nil {
		return
	}
	select {
	case s.extractKick <- struct{}{}:
	default:
	}
}

func (s *Service) startExtractor(ctx context.Context) {
	if s.extractor == nil {
		return
	}
	log.Printf("[ChatMedia] Content extraction enabled (%s)", s.extractor.Signature())
	if err := s.requeueChangedSignature(); err != nil {
		log.Printf("[ChatMedia] Extraction: failed to re-queue files for new models: %v", err)
	}
	go func() {
		for {
			wait := extractInterval
			if !s.RunExtraction(ctx) {
				wait = extractPause
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			case <-s.extractKick:
			}
		}
	}()
}

// requeueChangedSignature re-runs jobs that were done by other models.
func (s *Service) requeueChangedSignature() error {
	_, err := s.db.Exec(`UPDATE chat_attachment_jobs SET status = 'pending', attempts = 0, next_attempt_at = 0
		WHERE status IN ('done', 'failed') AND signature != ?`, s.extractor.Signature())
	return err
}

// enqueueExtraction adds a job for every attached image without one (new
// messages, and files sent before extraction was enabled).
func (s *Service) enqueueExtraction() error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO chat_attachment_jobs (attachment_id, status, updated_at)
		SELECT id, 'pending', ? FROM chat_attachments WHERE status = 'attached' AND kind = ?`,
		s.now().UnixMilli(), KindImage)
	return err
}

// RunExtraction processes due jobs, newest files first. It returns false
// when the extractor is unavailable (the caller backs off).
func (s *Service) RunExtraction(ctx context.Context) bool {
	if s.extractor == nil {
		return true
	}
	if err := s.enqueueExtraction(); err != nil {
		log.Printf("[ChatMedia] Extraction: failed to queue files: %v", err)
		return true
	}
	var due int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM chat_attachment_jobs WHERE status = 'pending' AND next_attempt_at <= ?`,
		s.now().UnixMilli()).Scan(&due); err == nil && due > 0 {
		log.Printf("[ChatMedia] Extraction: %d file(s) to process", due)
	}
	for {
		recs, err := queryRecords(s.db, `status = 'attached' AND id IN (
				SELECT attachment_id FROM chat_attachment_jobs WHERE status = 'pending' AND next_attempt_at <= ?)
			ORDER BY created_at DESC, id LIMIT ?`, s.now().UnixMilli(), extractBatch)
		if err != nil {
			log.Printf("[ChatMedia] Extraction: failed to list jobs: %v", err)
			return true
		}
		for _, rec := range recs {
			if ctx.Err() != nil {
				return true
			}
			if !s.extractOne(ctx, rec) {
				return false
			}
		}
		if len(recs) < extractBatch {
			return true
		}
	}
}

// extractOne runs one job; false means the extractor is unavailable.
func (s *Service) extractOne(ctx context.Context, rec *Record) bool {
	ctx, cancel := context.WithTimeout(ctx, extractTimeout)
	defer cancel()
	started := time.Now()
	res, err := s.extract(ctx, rec)
	if errors.Is(err, ErrExtractorUnavailable) {
		log.Printf("[ChatMedia] Extraction paused: %v", err)
		return false
	}
	if err != nil {
		log.Printf("[ChatMedia] Extraction of %s failed: %v", rec, err)
		s.failJob(rec, err)
		return true
	}
	text := strings.ToValidUTF8(strings.TrimSpace(res.Text), "")
	if len(text) > maxExtractText {
		text = strings.ToValidUTF8(text[:maxExtractText], "")
	}
	_, err = s.db.Exec(`UPDATE chat_attachment_jobs SET status = 'done', last_error = NULL, signature = ?,
		text = ?, vector = ?, updated_at = ? WHERE attachment_id = ?`,
		s.extractor.Signature(), text, encodeVector(res.Vector), s.now().UnixMilli(), rec.ID)
	if err != nil {
		log.Printf("[ChatMedia] Extraction: failed to store the result of %s: %v", rec.ID, err)
		return true
	}
	log.Printf("[ChatMedia] Extracted %s in %s: %d characters of text, %d-dimension vector",
		rec, time.Since(started).Round(time.Millisecond), utf8.RuneCountInString(text), len(res.Vector))
	s.refreshContent(rec.MessageID)
	return true
}

func (s *Service) extract(ctx context.Context, rec *Record) (Extraction, error) {
	data, err := s.media.Get(ctx, rec.originalKey())
	if err != nil {
		return Extraction{}, errors.Join(ErrExtractorUnavailable, err) // storage is down, not the file
	}
	img, err := extractionImage(data)
	if err != nil {
		return Extraction{}, err
	}
	return s.extractor.Extract(ctx, img)
}

// failJob schedules a retry with exponential backoff, or gives up.
func (s *Service) failJob(rec *Record, cause error) {
	var attempts int
	if err := s.db.QueryRow(`SELECT attempts FROM chat_attachment_jobs WHERE attachment_id = ?`, rec.ID).
		Scan(&attempts); err != nil {
		log.Printf("[ChatMedia] Extraction: failed to read job %s: %v", rec.ID, err)
		return
	}
	attempts++
	status := "pending"
	if attempts >= extractMaxAttempts {
		status = "failed"
		log.Printf("[ChatMedia] Extraction of %s failed for good: %v", rec, cause)
	}
	delay := min(time.Minute<<attempts, extractMaxDelay)
	msg := cause.Error()
	if len(msg) > 500 {
		msg = msg[:500]
	}
	if _, err := s.db.Exec(`UPDATE chat_attachment_jobs SET status = ?, attempts = ?, next_attempt_at = ?,
		last_error = ?, updated_at = ? WHERE attachment_id = ?`,
		status, attempts, s.now().Add(delay).UnixMilli(), strings.ToValidUTF8(msg, ""), s.now().UnixMilli(), rec.ID); err != nil {
		log.Printf("[ChatMedia] Extraction: failed to update job %s: %v", rec.ID, err)
	}
}

// refreshContent rebuilds the extracted content of a message from its
// attached files and hands it to the ContentHook.
func (s *Service) refreshContent(messageID string) {
	if s.contentHook == nil || messageID == "" {
		return
	}
	rows, err := s.db.Query(`SELECT j.text, j.vector FROM chat_attachment_jobs j
		JOIN chat_attachments a ON a.id = j.attachment_id
		WHERE a.message_id = ? AND a.status = 'attached' AND j.status = 'done'
		ORDER BY a.created_at, a.id`, messageID)
	if err != nil {
		log.Printf("[ChatMedia] Extraction: failed to read results of message %s: %v", messageID, err)
		return
	}
	var texts []string
	var vectors [][]float32
	for rows.Next() {
		var text string
		var blob []byte
		if err := rows.Scan(&text, &blob); err != nil {
			_ = rows.Close()
			log.Printf("[ChatMedia] Extraction: failed to read results of message %s: %v", messageID, err)
			return
		}
		if text != "" {
			texts = append(texts, text)
		}
		if v := decodeVector(blob); len(v) > 0 {
			vectors = append(vectors, v)
		}
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("[ChatMedia] Extraction: failed to read results of message %s: %v", messageID, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute) // may (re)create the embedder
	defer cancel()
	if err := s.contentHook(ctx, messageID, strings.Join(texts, "\n"), vectors); err != nil {
		log.Printf("[ChatMedia] Extraction: failed to update message %s: %v", messageID, err)
	}
}

// ExtractionInfo is the extraction state of one file, for the UI.
type ExtractionInfo struct {
	// Status is pending, done or failed; empty when the file has no job
	// yet (the worker queues it on its next run).
	Status        string
	Attempts      int
	NextAttemptAt int64
	LastError     string
	// Signature names the models of the stored result; Current reports
	// whether they are the models in use.
	Signature string
	Current   bool
	Text      string
	Vector    []float32
	UpdatedAt int64
}

// ExtractionEnabled reports whether content extraction is configured.
func (s *Service) ExtractionEnabled() bool { return s.extractor != nil }

// Extraction returns the extraction state of a file.
func (s *Service) Extraction(id string) (*ExtractionInfo, error) {
	var info ExtractionInfo
	var lastErr, sig, text sql.NullString
	var blob []byte
	err := s.db.QueryRow(`SELECT status, attempts, next_attempt_at, last_error, signature, text, vector, updated_at
		FROM chat_attachment_jobs WHERE attachment_id = ?`, id).
		Scan(&info.Status, &info.Attempts, &info.NextAttemptAt, &lastErr, &sig, &text, &blob, &info.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return &info, nil
	}
	if err != nil {
		return nil, err
	}
	info.LastError, info.Signature, info.Text = lastErr.String, sig.String, text.String
	info.Vector = decodeVector(blob)
	info.Current = s.extractor != nil && info.Signature == s.extractor.Signature()
	return &info, nil
}

// RetryExtraction queues an attached image again (its old result stays in
// the message until the new one is stored).
func (s *Service) RetryExtraction(rec *Record) error {
	if s.extractor == nil || rec.Kind != KindImage {
		return ErrUnsupported
	}
	if rec.Status != StatusAttached {
		return ErrNotAttached
	}
	_, err := s.db.Exec(`INSERT INTO chat_attachment_jobs (attachment_id, status, updated_at) VALUES (?, 'pending', ?)
		ON CONFLICT(attachment_id) DO UPDATE SET status = 'pending', attempts = 0, next_attempt_at = 0,
		last_error = NULL, updated_at = excluded.updated_at`, rec.ID, s.now().UnixMilli())
	if err != nil {
		return err
	}
	s.kickExtractor()
	return nil
}

// pruneJobs drops the jobs of removed files.
func (s *Service) pruneJobs() {
	if s.extractor == nil {
		return
	}
	if _, err := s.db.Exec(`DELETE FROM chat_attachment_jobs WHERE attachment_id IN
		(SELECT id FROM chat_attachments WHERE status = 'removed')`); err != nil {
		log.Printf("[ChatMedia] Janitor: failed to prune extraction jobs: %v", err)
	}
}

func encodeVector(v []float32) any {
	if len(v) == 0 {
		return nil
	}
	b := make([]byte, 4*len(v))
	for i, f := range v {
		binary.LittleEndian.PutUint32(b[4*i:], math.Float32bits(f))
	}
	return b
}

func decodeVector(b []byte) []float32 {
	if len(b) == 0 || len(b)%4 != 0 {
		return nil
	}
	v := make([]float32, len(b)/4)
	for i := range v {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[4*i:]))
	}
	return v
}
