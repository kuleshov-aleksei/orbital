package linkpreview

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

const (
	// concurrency bounds the messages processed at once.
	concurrency = 4
	// messageTimeout bounds all fetches of one message.
	messageTimeout = 20 * time.Second
	cacheTTL       = 24 * time.Hour
	failureTTL     = time.Hour
	// cacheRetention: rows older than this are pruned.
	cacheRetention = 7 * 24 * time.Hour
	pruneEvery     = time.Hour
)

// ErrNotFound: no such preview image.
var ErrNotFound = errors.New("not found")

var imageIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

// imageKey is the S3 key of a preview thumbnail.
func imageKey(id string) string { return "embeds/" + id + ".webp" }

// Options configure a Service.
type Options struct {
	DB       *storage.DB
	Messages *chatstore.Service
	// Media keeps the thumbnails; nil means previews without images.
	Media   chatmedia.MediaStore
	Fetcher *Fetcher
	Now     func() time.Time
}

// Service makes link previews in the background.
type Service struct {
	opts Options
	sem  chan struct{}

	pruneMu   sync.Mutex
	lastPrune time.Time
}

// New creates a Service.
func New(o Options) *Service {
	if o.Fetcher == nil {
		o.Fetcher = NewFetcher(false, nil)
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Service{opts: o, sem: make(chan struct{}, concurrency)}
}

// Schedule makes the previews of a new or edited message in the background
// and calls done with the updated message when they were stored. Messages
// without links (or whose previews are current) cost nothing.
func (s *Service) Schedule(msg *chatstore.Message, done func(*chatstore.Message)) {
	if s == nil || msg == nil {
		return
	}
	urls := chatstore.PreviewURLs(msg.Content)
	if chatstore.EmbedsCurrent(msg, urls) {
		return
	}
	id, content, existing := msg.ID, msg.Content, append([]chatstore.Embed(nil), msg.Embeds...)
	go func() {
		s.sem <- struct{}{}
		defer func() { <-s.sem }()
		ctx, cancel := context.WithTimeout(context.Background(), messageTimeout)
		defer cancel()

		embeds := s.Build(ctx, urls, existing)
		updated, err := s.opts.Messages.SetEmbeds(context.Background(), id, content, embeds)
		switch {
		case err == nil:
			if done != nil {
				done(updated)
			}
		case errors.Is(err, chatstore.ErrStale), errors.Is(err, chatstore.ErrNotFound):
			// Edited (a new run follows), previews removed, or deleted.
		default:
			log.Printf("[LinkPreview] Failed to store previews of %s: %v", id, err)
		}
		s.maybePrune()
	}()
}

// Build returns the previews of urls, in order. existing previews are
// reused; links without a usable preview are left out.
func (s *Service) Build(ctx context.Context, urls []string, existing []chatstore.Embed) []chatstore.Embed {
	have := map[string]chatstore.Embed{}
	for _, e := range existing {
		have[e.URL] = e
	}
	out := []chatstore.Embed{}
	for _, u := range urls {
		if e, ok := have[u]; ok {
			out = append(out, e)
			continue
		}
		if e, ok := s.preview(ctx, u); ok {
			out = append(out, e)
		}
	}
	return out
}

// preview returns the preview of one link, from the cache or fetched.
func (s *Service) preview(ctx context.Context, rawURL string) (chatstore.Embed, bool) {
	if e, ok, hit := s.cached(rawURL); hit {
		return e, ok
	}
	e, ok := s.fetch(ctx, rawURL)
	if ctx.Err() == nil { // a timeout says nothing about the link
		s.store(rawURL, e, ok)
	}
	return e, ok
}

func (s *Service) fetch(ctx context.Context, rawURL string) (chatstore.Embed, bool) {
	u, err := url.Parse(rawURL)
	if err != nil || !allowedURL(u) {
		return chatstore.Embed{}, false
	}
	e := chatstore.Embed{URL: rawURL, Kind: chatstore.EmbedLink}
	ytID := youtubeID(u)

	resp, err := s.opts.Fetcher.get(ctx, rawURL, "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5")
	var imageURL string
	switch {
	case err != nil:
		if ytID == "" {
			return e, false
		}
	case strings.HasPrefix(resp.contentType, "image/"):
		e.Kind = chatstore.EmbedImage
		e.SiteName = siteName(resp.finalURL)
		if !s.attachImage(ctx, &e, resp.body) {
			return e, false
		}
		return e, true
	case resp.contentType == "text/html" || resp.contentType == "application/xhtml+xml" || resp.contentType == "":
		meta := parseHead(resp.body, resp.contentType, resp.charset)
		e.Title, e.Description, e.SiteName = meta.title, meta.description, meta.siteName
		imageURL = resolveRef(resp.finalURL, meta.image)
		if e.SiteName == "" {
			e.SiteName = siteName(resp.finalURL)
		}
	default:
		return e, false // PDFs, archives, ...
	}

	if ytID != "" {
		e.Kind, e.VideoProvider, e.VideoID = chatstore.EmbedVideo, "youtube", ytID
		if e.SiteName == "" {
			e.SiteName = "YouTube"
		}
		if imageURL == "" {
			imageURL = "https://i.ytimg.com/vi/" + ytID + "/hqdefault.jpg"
		}
	}
	if imageURL != "" {
		if img, err := s.opts.Fetcher.get(ctx, imageURL, "image/*"); err == nil && strings.HasPrefix(img.contentType, "image/") {
			s.attachImage(ctx, &e, img.body)
		}
	}
	if e.Title == "" && e.Description == "" && e.ImageID == "" && e.Kind != chatstore.EmbedVideo {
		return e, false
	}
	return e, true
}

// attachImage stores a thumbnail of data and sets the embed's image.
func (s *Service) attachImage(ctx context.Context, e *chatstore.Embed, data []byte) bool {
	if s.opts.Media == nil {
		return false
	}
	thumb, w, h, err := chatmedia.EmbedThumbnail(data)
	if err != nil {
		return false
	}
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return false
	}
	id := base64.RawURLEncoding.EncodeToString(raw[:])
	if err := s.opts.Media.Put(ctx, imageKey(id), bytes.NewReader(thumb), int64(len(thumb)), "image/webp"); err != nil {
		log.Printf("[LinkPreview] Failed to store a thumbnail: %v", err)
		return false
	}
	e.ImageID, e.ImageWidth, e.ImageHeight = id, w, h
	return true
}

// Image returns a stored thumbnail (WebP).
func (s *Service) Image(ctx context.Context, id string) ([]byte, error) {
	if s == nil || s.opts.Media == nil || !imageIDRe.MatchString(id) {
		return nil, ErrNotFound
	}
	data, err := s.opts.Media.Get(ctx, imageKey(id))
	if err != nil {
		return nil, ErrNotFound
	}
	return data, nil
}

func siteName(u *url.URL) string {
	if u == nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

// cached returns a cached preview. hit is false when there is none or it
// expired.
func (s *Service) cached(rawURL string) (e chatstore.Embed, ok, hit bool) {
	if s.opts.DB == nil {
		return e, false, false
	}
	var data string
	var fetchedAt int64
	err := s.opts.DB.QueryRow(`SELECT embed, fetched_at FROM link_previews WHERE url = ?`, rawURL).Scan(&data, &fetchedAt)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("[LinkPreview] Cache read failed: %v", err)
		}
		return e, false, false
	}
	age := s.opts.Now().Sub(time.UnixMilli(fetchedAt))
	if data == "" {
		return e, false, age < failureTTL
	}
	if age >= cacheTTL || json.Unmarshal([]byte(data), &e) != nil {
		return e, false, false
	}
	return e, true, true
}

func (s *Service) store(rawURL string, e chatstore.Embed, ok bool) {
	if s.opts.DB == nil {
		return
	}
	data := ""
	if ok {
		b, err := json.Marshal(e)
		if err != nil {
			return
		}
		data = string(b)
	}
	_, err := s.opts.DB.Exec(`INSERT INTO link_previews (url, embed, fetched_at) VALUES (?, ?, ?)
		ON CONFLICT(url) DO UPDATE SET embed = excluded.embed, fetched_at = excluded.fetched_at`,
		rawURL, data, s.opts.Now().UnixMilli())
	if err != nil {
		log.Printf("[LinkPreview] Cache write failed: %v", err)
	}
}

// maybePrune drops old cache rows (at most once per pruneEvery). The
// thumbnails stay: messages keep pointing at them.
func (s *Service) maybePrune() {
	if s.opts.DB == nil {
		return
	}
	s.pruneMu.Lock()
	now := s.opts.Now()
	if now.Sub(s.lastPrune) < pruneEvery {
		s.pruneMu.Unlock()
		return
	}
	s.lastPrune = now
	s.pruneMu.Unlock()
	if _, err := s.opts.DB.Exec(`DELETE FROM link_previews WHERE fetched_at < ?`, now.Add(-cacheRetention).UnixMilli()); err != nil {
		log.Printf("[LinkPreview] Cache prune failed: %v", err)
	}
}
