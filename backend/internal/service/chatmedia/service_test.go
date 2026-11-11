package chatmedia

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

const (
	testRoom  = "20261110145113MiTbtB"
	testUser  = "qkUrdzLDoqslx8EEy2cM7Q=="
	otherUser = "Zx9vT1mQpL0aBcDeFgHiJw=="
)

type hookCall struct {
	id    string
	after chatstore.Attachment
}

type fixture struct {
	svc   *Service
	media *MemoryStore
	clock time.Time
	mu    sync.Mutex
	hooks []hookCall
}

func newFixture(t *testing.T, quota int64) *fixture {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	f := &fixture{media: NewMemoryStore(), clock: time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)}
	f.svc = New(db, f.media, Limits{MaxImageBytes: 1 << 20, MaxAudioBytes: 1 << 20, MaxVideoBytes: 1 << 20, QuotaBytes: quota})
	f.svc.async = func(fn func()) { fn() }
	f.svc.now = func() time.Time {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.clock = f.clock.Add(time.Second) // strictly increasing created_at
		return f.clock
	}
	f.svc.SetMessageHook(func(_ context.Context, rec *Record, apply func(a *chatstore.Attachment) bool) {
		a := rec.display()
		if apply(&a) {
			f.mu.Lock()
			f.hooks = append(f.hooks, hookCall{rec.ID, a})
			f.mu.Unlock()
		}
	})
	return f
}

// audioFile is an "mp3" (ID3 tag) of exactly size bytes.
func audioFile(size int) *bytes.Reader {
	b := make([]byte, size)
	copy(b, "ID3")
	return bytes.NewReader(b)
}

func (f *fixture) upload(t *testing.T, user string, size int) (*UploadResult, error) {
	t.Helper()
	r := audioFile(size)
	return f.svc.Upload(context.Background(), UploadInput{
		RoomID: testRoom, UploaderID: user, Filename: "clip.mp3", File: r, Size: int64(size),
		Meta: ClientMeta{Peaks: []int{0, 128, 255}, DurationMS: 1500},
	})
}

// sent uploads and attaches a file to a message.
func (f *fixture) sent(t *testing.T, user string, size int) *Record {
	t.Helper()
	res, err := f.upload(t, user, size)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	err = f.svc.Attach(context.Background(), user, testRoom, []string{res.Record.ID},
		func([]chatstore.Attachment) (string, error) { return "msg-" + res.Record.ID, nil })
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	rec, _ := f.svc.Get(res.Record.ID)
	return rec
}

func TestUploadEvictsOldestUnprotectedFiles(t *testing.T) {
	f := newFixture(t, 1000)
	oldest := f.sent(t, testUser, 300)
	protected := f.sent(t, testUser, 300)
	if _, err := f.svc.SetProtected(protected, true); err != nil {
		t.Fatalf("protect: %v", err)
	}
	middle := f.sent(t, testUser, 300)
	// Someone else's files are never touched.
	other := f.sent(t, otherUser, 900)

	res, err := f.upload(t, testUser, 300) // 1200 > 1000: one file must go
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if len(res.Evicted) != 1 || res.Evicted[0].ID != oldest.ID {
		t.Fatalf("evicted = %v, want only the oldest unprotected file %s", res.Evicted, oldest.ID)
	}
	if res.Usage.UsedBytes != 900 || res.Usage.ProtectedBytes != 300 || res.Usage.PendingBytes != 300 {
		t.Fatalf("usage = %+v", res.Usage)
	}
	for _, id := range []string{protected.ID, middle.ID, other.ID} {
		if rec, _ := f.svc.Get(id); rec.Status != StatusAttached {
			t.Fatalf("%s status = %s, want attached", id, rec.Status)
		}
	}
	got, _ := f.svc.Get(oldest.ID)
	if got.Status != StatusRemoved || got.RemovedReason != ReasonQuota {
		t.Fatalf("oldest = %s/%s, want removed/quota", got.Status, got.RemovedReason)
	}
	if len(f.hooks) == 0 || f.hooks[len(f.hooks)-1].id != oldest.ID || f.hooks[len(f.hooks)-1].after.Removed != ReasonQuota {
		t.Fatalf("message document was not updated: %+v", f.hooks)
	}
}

func TestPendingUploadsAreNeverEvicted(t *testing.T) {
	f := newFixture(t, 1000)
	if _, err := f.upload(t, testUser, 600); err != nil { // pending, in a composer
		t.Fatalf("upload: %v", err)
	}
	if _, err := f.upload(t, testUser, 600); !errors.Is(err, ErrQuotaProtectedFull) {
		t.Fatalf("err = %v, want %v", err, ErrQuotaProtectedFull)
	}
	// The rejected file's objects are deleted again.
	if n := len(f.media.Keys()); n != 1 {
		t.Fatalf("objects = %v, want only the first upload", f.media.Keys())
	}
}

func TestQuotaErrors(t *testing.T) {
	f := newFixture(t, 1000)
	if _, err := f.upload(t, testUser, 1001); !errors.Is(err, ErrFileExceedsQuota) {
		t.Fatalf("err = %v, want %v", err, ErrFileExceedsQuota)
	}
	p := f.sent(t, testUser, 800)
	if _, err := f.svc.SetProtected(p, true); err != nil {
		t.Fatal(err)
	}
	if _, err := f.upload(t, testUser, 300); !errors.Is(err, ErrQuotaProtectedFull) {
		t.Fatalf("err = %v, want %v", err, ErrQuotaProtectedFull)
	}
	if _, err := f.upload(t, testUser, 200); err != nil {
		t.Fatalf("a file that fits must upload: %v", err)
	}
}

func TestConcurrentReservationsCannotOverbook(t *testing.T) {
	f := newFixture(t, 1000)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = f.upload(t, testUser, 600)
		}(i)
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		if err == nil {
			ok++
		} else if !errors.Is(err, ErrQuotaProtectedFull) {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if ok != 1 {
		t.Fatalf("%d uploads succeeded, want exactly 1", ok)
	}
}

func TestAttachValidatesAndIsSingleUse(t *testing.T) {
	f := newFixture(t, 1000)
	res, err := f.upload(t, testUser, 100)
	if err != nil {
		t.Fatal(err)
	}
	id := res.Record.ID
	create := func(atts []chatstore.Attachment) (string, error) {
		if len(atts) != 1 || atts[0].Kind != KindAudio || len(atts[0].Peaks) != 3 || atts[0].DurationMS != 1500 {
			t.Fatalf("attachments = %+v", atts)
		}
		return "m1", nil
	}
	if err := f.svc.Attach(context.Background(), otherUser, testRoom, []string{id}, create); !errors.Is(err, ErrInvalid) {
		t.Fatalf("another user's upload: err = %v", err)
	}
	if err := f.svc.Attach(context.Background(), testUser, "20261110145113OtherR", []string{id}, create); !errors.Is(err, ErrInvalid) {
		t.Fatalf("another room: err = %v", err)
	}
	if err := f.svc.Attach(context.Background(), testUser, testRoom, []string{id}, create); err != nil {
		t.Fatalf("attach: %v", err)
	}
	if err := f.svc.Attach(context.Background(), testUser, testRoom, []string{id}, create); !errors.Is(err, ErrInvalid) {
		t.Fatalf("second attach: err = %v", err)
	}
	rec, _ := f.svc.Get(id)
	if rec.Status != StatusAttached || rec.MessageID != "m1" {
		t.Fatalf("record = %+v", rec)
	}
}

func TestMessageDeletePurgesAndFreesQuota(t *testing.T) {
	f := newFixture(t, 1000)
	rec := f.sent(t, testUser, 700)
	if err := f.svc.RemoveForMessage(rec.MessageID); err != nil {
		t.Fatal(err)
	}
	u, _ := f.svc.Usage(testUser)
	if u.UsedBytes != 0 {
		t.Fatalf("used = %d, want 0", u.UsedBytes)
	}
	// Deleted messages are not patched.
	for _, h := range f.hooks {
		if h.after.Removed == ReasonMessageDeleted {
			t.Fatalf("hook ran for a deleted message")
		}
	}

	f.media.SetFailDelete(errors.New("s3 down"))
	f.svc.RunJanitor(context.Background())
	if len(f.media.Keys()) != 1 {
		t.Fatalf("objects = %v, want the file kept while S3 fails", f.media.Keys())
	}
	if got, _ := f.svc.Get(rec.ID); got.PurgedAt != 0 {
		t.Fatalf("marked purged although the delete failed")
	}
	f.media.SetFailDelete(nil)
	f.svc.RunJanitor(context.Background())
	if len(f.media.Keys()) != 0 {
		t.Fatalf("objects = %v, want none after the retry", f.media.Keys())
	}
	if got, _ := f.svc.Get(rec.ID); got.PurgedAt == 0 {
		t.Fatalf("purged_at not set")
	}
}

func TestRemoveRoomAndPendingExpiry(t *testing.T) {
	f := newFixture(t, 1000)
	attached := f.sent(t, testUser, 100)
	res, err := f.upload(t, testUser, 100)
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.clock = f.clock.Add(25 * time.Hour)
	f.mu.Unlock()
	f.svc.RunJanitor(context.Background())
	if got, _ := f.svc.Get(res.Record.ID); got.RemovedReason != ReasonPendingExpired {
		t.Fatalf("pending upload reason = %q, want %q", got.RemovedReason, ReasonPendingExpired)
	}
	if err := f.svc.RemoveRoom(testRoom); err != nil {
		t.Fatal(err)
	}
	if got, _ := f.svc.Get(attached.ID); got.RemovedReason != ReasonChannelDeleted {
		t.Fatalf("attached reason = %q, want %q", got.RemovedReason, ReasonChannelDeleted)
	}
}

func TestOwnerRemovalUpdatesMessage(t *testing.T) {
	f := newFixture(t, 1000)
	rec := f.sent(t, testUser, 100)
	changed, err := f.svc.Remove([]*Record{rec}, ReasonOwner)
	if err != nil || len(changed) != 1 {
		t.Fatalf("remove: %v %v", changed, err)
	}
	last := f.hooks[len(f.hooks)-1]
	if last.id != rec.ID || last.after.Removed != ReasonOwner {
		t.Fatalf("hook = %+v", last)
	}
	if _, err := f.svc.SetProtected(changed[0], true); !errors.Is(err, ErrNotAttached) {
		t.Fatalf("protecting a removed file: err = %v", err)
	}
}

func TestListAndNextRemoval(t *testing.T) {
	f := newFixture(t, 1000)
	a := f.sent(t, testUser, 60)
	b := f.sent(t, testUser, 60)
	c := f.sent(t, testUser, 300)
	f.sent(t, otherUser, 50)
	recs, next, err := f.svc.List(testUser, ListFilter{Limit: 2})
	if err != nil || len(recs) != 2 || next != 2 || recs[0].ID != a.ID || recs[1].ID != b.ID {
		t.Fatalf("page 1 = %v next %d err %v", recs, next, err)
	}
	recs, _, _ = f.svc.List(testUser, ListFilter{Sort: "largest"})
	if len(recs) != 3 || recs[0].ID != c.ID {
		t.Fatalf("largest = %v", recs)
	}
	ids, err := f.svc.NextRemovalIDs(testUser)
	if err != nil || !ids[a.ID] || !ids[b.ID] || ids[c.ID] {
		t.Fatalf("next removal = %v (%v), want the first two files (120 bytes ≥ 10%%)", ids, err)
	}
}

func pngImage(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		img.Set(x, x%h, color.RGBA{255, 0, 0, 255})
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func TestImageUploadMakesThumbnail(t *testing.T) {
	f := newFixture(t, 10<<20)
	data := pngImage(1280, 320)
	res, err := f.svc.Upload(context.Background(), UploadInput{
		RoomID: testRoom, UploaderID: testUser, Filename: "../../etc/shot.png",
		File: bytes.NewReader(data), Size: int64(len(data)),
	})
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	r := res.Record
	if r.Kind != KindImage || r.Width != 1280 || r.Height != 320 || !r.HasThumb || r.Filename != "shot.png" {
		t.Fatalf("record = %+v", r)
	}
	keys := f.media.Keys()
	if len(keys) != 2 || keys[0] != r.originalKey() || keys[1] != r.thumbKey() {
		t.Fatalf("objects = %v", keys)
	}
}

func TestRejectsUnsupportedAndOversized(t *testing.T) {
	f := newFixture(t, 10<<20)
	text := []byte("just some text, not media")
	if _, err := f.svc.Upload(context.Background(), UploadInput{RoomID: testRoom, UploaderID: testUser,
		File: bytes.NewReader(text), Size: int64(len(text))}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("text: err = %v", err)
	}
	m4a := append([]byte{0, 0, 0, 0x20}, []byte("ftypM4A \x00\x00\x00\x00")...)
	if _, err := f.svc.Upload(context.Background(), UploadInput{RoomID: testRoom, UploaderID: testUser,
		File: bytes.NewReader(m4a), Size: int64(len(m4a))}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("m4a: err = %v", err)
	}
	if _, err := f.upload(t, testUser, 2<<20); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversized: err = %v", err)
	}
}

func TestSniff(t *testing.T) {
	cases := map[string]string{
		"\x89PNG\r\n\x1a\n....":        "image/png",
		"\xFF\xD8\xFF\xE0":             "image/jpeg",
		"GIF89a":                       "image/gif",
		"RIFF\x00\x00\x00\x00WEBPVP8 ": "image/webp",
		"RIFF\x00\x00\x00\x00WAVEfmt ": "audio/wav",
		"OggS\x00":                     "audio/ogg",
		"ID3\x04":                      "audio/mpeg",
		"\xFF\xFB\x90\x00":             "audio/mpeg",
		"\x00\x00\x00\x18ftypisom":     "video/mp4",
	}
	for head, want := range cases {
		ft, ok := sniff([]byte(head))
		if !ok || ft.mime != want {
			t.Errorf("sniff(%q) = %v %v, want %s", head, ft, ok, want)
		}
	}
	for _, head := range []string{"%PDF-1.7", "\x00\x00\x00\x14ftypqt  ", "PK\x03\x04", "\xFF\xFF\xFF"} {
		if ft, ok := sniff([]byte(head)); ok {
			t.Errorf("sniff(%q) = %v, want rejected", head, ft)
		}
	}
}

func TestPeaksAndFilenameValidation(t *testing.T) {
	if validPeaks([]int{1, 256}) != nil || validPeaks(make([]int, 201)) != nil {
		t.Fatal("invalid peaks accepted")
	}
	if got := clampDuration(10 * maxDurationMS); got != maxDurationMS {
		t.Fatalf("duration = %d", got)
	}
	if got := cleanFilename("C:\\Users\\me\\sound\x00.mp3", "mp3"); got != "sound.mp3" {
		t.Fatalf("filename = %q", got)
	}
	if got := cleanFilename("", "png"); got != "file.png" {
		t.Fatalf("empty filename = %q", got)
	}
}
