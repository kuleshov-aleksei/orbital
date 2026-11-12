package chatmedia

import (
	"bytes"
	"context"
	"errors"
	"image/jpeg"
	"sync"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

type fakeExtractor struct {
	mu    sync.Mutex
	sig   string
	err   error
	calls int
	seen  [][]byte
}

func (e *fakeExtractor) Signature() string { return e.sig }

func (e *fakeExtractor) Extract(_ context.Context, img []byte) (Extraction, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls++
	e.seen = append(e.seen, img)
	if e.err != nil {
		return Extraction{}, e.err
	}
	n := float32(e.calls)
	return Extraction{Text: "  текст на картинке  ", Vector: []float32{n, 0.5}}, nil
}

type contentCall struct {
	messageID, text string
	vectors         [][]float32
}

type extractFixture struct {
	*fixture
	ex       *fakeExtractor
	mu       sync.Mutex
	contents []contentCall
}

func newExtractFixture(t *testing.T) *extractFixture {
	f := &extractFixture{fixture: newFixture(t, 10<<20), ex: &fakeExtractor{sig: "immich;ocr=a;clip=b"}}
	f.svc.SetExtractor(f.ex, func(_ context.Context, messageID, text string, vectors [][]float32) error {
		f.mu.Lock()
		f.contents = append(f.contents, contentCall{messageID, text, vectors})
		f.mu.Unlock()
		return nil
	})
	return f
}

func (f *extractFixture) last(t *testing.T) contentCall {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.contents) == 0 {
		t.Fatal("content hook was not called")
	}
	return f.contents[len(f.contents)-1]
}

// sendImages uploads images and attaches them all to one message.
func (f *extractFixture) sendImages(t *testing.T, n int) (string, []*Record) {
	t.Helper()
	var ids []string
	for i := 0; i < n; i++ {
		data := pngImage(2000, 100) // wider than extractBox
		res, err := f.svc.Upload(context.Background(), UploadInput{
			RoomID: testRoom, UploaderID: testUser, Filename: "shot.png",
			File: bytes.NewReader(data), Size: int64(len(data)),
		})
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
		ids = append(ids, res.Record.ID)
	}
	msgID := "20261112093000000001"
	if err := f.svc.Attach(context.Background(), testUser, testRoom, ids,
		func([]chatstore.Attachment) (string, error) { return msgID, nil }); err != nil {
		t.Fatalf("attach: %v", err)
	}
	var recs []*Record
	for _, id := range ids {
		rec, _ := f.svc.Get(id)
		recs = append(recs, rec)
	}
	return msgID, recs
}

func (f *extractFixture) job(t *testing.T, id string) (status string, attempts int) {
	t.Helper()
	if err := f.svc.db.QueryRow(`SELECT status, attempts FROM chat_attachment_jobs WHERE attachment_id = ?`, id).
		Scan(&status, &attempts); err != nil {
		t.Fatalf("job %s: %v", id, err)
	}
	return status, attempts
}

func TestExtractionWritesContentOfAllImagesOfAMessage(t *testing.T) {
	f := newExtractFixture(t)
	// Audio files are not extracted.
	f.sent(t, testUser, 100)
	msgID, recs := f.sendImages(t, 2)

	if !f.svc.RunExtraction(context.Background()) {
		t.Fatal("RunExtraction reported the extractor unavailable")
	}
	if f.ex.calls != 2 {
		t.Fatalf("extractor calls = %d, want 2 (images only)", f.ex.calls)
	}
	for _, img := range f.ex.seen {
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(img))
		if err != nil || cfg.Width != extractBox || cfg.Height != 72 {
			t.Fatalf("extractor image = %+v (%v), want a %dx72 JPEG", cfg, err, extractBox)
		}
	}
	c := f.last(t)
	if c.messageID != msgID || c.text != "текст на картинке\nтекст на картинке" || len(c.vectors) != 2 {
		t.Fatalf("content = %+v", c)
	}
	for _, r := range recs {
		if st, _ := f.job(t, r.ID); st != "done" {
			t.Fatalf("job %s = %s, want done", r.ID, st)
		}
	}

	// Done jobs do not run again.
	f.svc.RunExtraction(context.Background())
	if f.ex.calls != 2 {
		t.Fatalf("extractor calls = %d after a second run, want 2", f.ex.calls)
	}

	// Removing one file rebuilds the content from the remaining one.
	if _, err := f.svc.Remove(recs[:1], ReasonOwner); err != nil {
		t.Fatal(err)
	}
	c = f.last(t)
	if c.text != "текст на картинке" || len(c.vectors) != 1 {
		t.Fatalf("content after removal = %+v", c)
	}
	f.svc.RunJanitor(context.Background())
	var n int
	_ = f.svc.db.QueryRow(`SELECT COUNT(*) FROM chat_attachment_jobs`).Scan(&n)
	if n != 1 {
		t.Fatalf("jobs after janitor = %d, want 1 (removed file's job pruned)", n)
	}
}

func TestExtractionOutageDoesNotUseAttempts(t *testing.T) {
	f := newExtractFixture(t)
	_, recs := f.sendImages(t, 1)
	f.ex.err = errors.Join(ErrExtractorUnavailable, errors.New("connection refused"))
	if f.svc.RunExtraction(context.Background()) {
		t.Fatal("RunExtraction = true, want false (pause) while the extractor is down")
	}
	if st, attempts := f.job(t, recs[0].ID); st != "pending" || attempts != 0 {
		t.Fatalf("job = %s/%d, want pending/0", st, attempts)
	}
	f.ex.err = nil
	f.svc.RunExtraction(context.Background())
	if st, _ := f.job(t, recs[0].ID); st != "done" {
		t.Fatalf("job = %s after recovery, want done", st)
	}
}

func TestExtractionGivesUpOnBadFilesWithBackoff(t *testing.T) {
	f := newExtractFixture(t)
	_, recs := f.sendImages(t, 1)
	f.ex.err = errors.New("immich ml: predict returned 422")
	f.svc.RunExtraction(context.Background())
	if st, attempts := f.job(t, recs[0].ID); st != "pending" || attempts != 1 {
		t.Fatalf("job = %s/%d, want pending/1", st, attempts)
	}
	// Backoff: an immediate re-run does not retry.
	f.svc.RunExtraction(context.Background())
	if f.ex.calls != 1 {
		t.Fatalf("extractor calls = %d, want 1 during backoff", f.ex.calls)
	}
	for i := 0; i < extractMaxAttempts; i++ {
		_, _ = f.svc.db.Exec(`UPDATE chat_attachment_jobs SET next_attempt_at = 0`)
		f.svc.RunExtraction(context.Background())
	}
	if st, attempts := f.job(t, recs[0].ID); st != "failed" || attempts != extractMaxAttempts {
		t.Fatalf("job = %s/%d, want failed/%d", st, attempts, extractMaxAttempts)
	}
}

func TestModelChangeRequeuesDoneJobs(t *testing.T) {
	f := newExtractFixture(t)
	_, recs := f.sendImages(t, 1)
	f.svc.RunExtraction(context.Background())
	f.ex.sig = "immich;ocr=a;clip=c"
	if err := f.svc.requeueChangedSignature(); err != nil {
		t.Fatal(err)
	}
	if st, _ := f.job(t, recs[0].ID); st != "pending" {
		t.Fatalf("job = %s after a model change, want pending", st)
	}
	f.svc.RunExtraction(context.Background())
	if f.ex.calls != 2 {
		t.Fatalf("extractor calls = %d, want 2", f.ex.calls)
	}
}

func TestVectorRoundTrip(t *testing.T) {
	v := []float32{1.5, -2, 0, 3.25}
	blob, _ := encodeVector(v).([]byte)
	got := decodeVector(blob)
	if len(got) != len(v) {
		t.Fatalf("got %v", got)
	}
	for i := range v {
		if got[i] != v[i] {
			t.Fatalf("got %v, want %v", got, v)
		}
	}
	if encodeVector(nil) != nil || decodeVector([]byte{1, 2, 3}) != nil {
		t.Fatal("empty or malformed vectors must map to nil")
	}
}

func TestExtractionInfoAndRetry(t *testing.T) {
	f := newExtractFixture(t)
	_, recs := f.sendImages(t, 1)
	id := recs[0].ID

	info, err := f.svc.Extraction(id)
	if err != nil || info.Status != "" {
		t.Fatalf("before the worker: info = %+v (%v), want no job", info, err)
	}
	f.svc.RunExtraction(context.Background())
	info, err = f.svc.Extraction(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.Status != "done" || info.Text != "текст на картинке" || len(info.Vector) != 2 || !info.Current ||
		info.Signature != "immich;ocr=a;clip=b" {
		t.Fatalf("after the worker: info = %+v", info)
	}

	if err := f.svc.RetryExtraction(recs[0]); err != nil {
		t.Fatal(err)
	}
	if status, attempts := f.job(t, id); status != "pending" || attempts != 0 {
		t.Fatalf("after retry: job = %s/%d, want pending/0", status, attempts)
	}
	// The old result stays until the new one is stored.
	if info, _ := f.svc.Extraction(id); info.Text == "" {
		t.Fatal("retry dropped the old result")
	}
	f.svc.RunExtraction(context.Background())
	if f.ex.calls != 2 {
		t.Fatalf("extractor calls = %d, want 2", f.ex.calls)
	}

	audio := f.sent(t, testUser, 100)
	if err := f.svc.RetryExtraction(audio); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("audio: err = %v, want ErrUnsupported", err)
	}
}

func TestExtractionStatsCountsQueueStates(t *testing.T) {
	f := newExtractFixture(t)
	f.sent(t, testUser, 100) // audio is not counted
	_, recs := f.sendImages(t, 3)

	st, err := f.svc.ExtractionStats()
	if err != nil {
		t.Fatal(err)
	}
	if !st.Enabled || st.Unqueued != 3 || st.Done != 0 {
		t.Fatalf("before the worker: %+v", st)
	}

	f.svc.RunExtraction(context.Background())
	// One image fails once (retry scheduled), one fails for good.
	f.svc.failJob(recs[0], errors.New("predict returned 422"))
	for i := 0; i < extractMaxAttempts; i++ {
		f.svc.failJob(recs[1], errors.New("bad image"))
	}
	st, err = f.svc.ExtractionStats()
	if err != nil {
		t.Fatal(err)
	}
	if st.Unqueued != 0 || st.Due != 0 || st.Waiting != 1 || st.Failed != 1 || st.Done != 1 ||
		st.WithText != 1 || st.WithVector != 1 || st.LastRunAt == 0 || st.LastDoneAt == 0 {
		t.Fatalf("after the worker: %+v", st)
	}
	if len(st.RecentProblems) != 2 || st.RecentProblems[0].Record.Filename != "shot.png" {
		t.Fatalf("problems = %+v", st.RecentProblems)
	}

	n, err := f.svc.RetryFailedExtractions()
	if err != nil || n != 1 {
		t.Fatalf("retry failed: n = %d (%v), want 1", n, err)
	}
	if status, attempts := f.job(t, recs[1].ID); status != "pending" || attempts != 0 {
		t.Fatalf("after retry: %s/%d", status, attempts)
	}
}
