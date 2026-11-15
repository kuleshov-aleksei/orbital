package linkpreview

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/text/encoding/charmap"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func TestParseHeadFallbacks(t *testing.T) {
	page := `<!doctype html><html><head>
		<title> Plain   title </title>
		<meta name="description" content="Plain &amp; simple">
		<meta property="og:title" content="OG title">
		<meta name="twitter:image" content="/img.png">
		</head><body><meta property="og:description" content="from body, ignored"></body></html>`
	m := parseHead([]byte(page), "text/html", "")
	if m.title != "OG title" || m.description != "Plain & simple" || m.image != "/img.png" {
		t.Fatalf("meta = %+v", m)
	}

	m = parseHead([]byte(`<html><head><title>Only   a
		title</title></head></html>`), "text/html", "")
	if m.title != "Only a title" {
		t.Fatalf("title = %q", m.title)
	}
}

func TestParseHeadWindows1251(t *testing.T) {
	src := `<html><head><meta charset="windows-1251"><title>Новости дня</title></head></html>`
	enc, err := charmap.Windows1251.NewEncoder().String(src)
	if err != nil {
		t.Fatal(err)
	}
	if m := parseHead([]byte(enc), "text/html", ""); m.title != "Новости дня" {
		t.Fatalf("title = %q", m.title)
	}
	// Declared in the Content-Type header only.
	enc2, _ := charmap.Windows1251.NewEncoder().String(`<title>Привет</title>`)
	if m := parseHead([]byte(enc2), "text/html", "windows-1251"); m.title != "Привет" {
		t.Fatalf("title = %q", m.title)
	}
}

func TestClip(t *testing.T) {
	long := strings.Repeat("я", 400)
	if got := clip(long, "", maxDescriptionRunes); len([]rune(got)) != maxDescriptionRunes || !strings.HasSuffix(got, "…") {
		t.Fatalf("clip len = %d", len([]rune(got)))
	}
}

func TestYouTubeID(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10":     "dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ?si=abc":                  "dQw4w9WgXcQ",
		"https://m.youtube.com/shorts/dQw4w9WgXcQ":             "dQw4w9WgXcQ",
		"https://youtube.com/live/dQw4w9WgXcQ":                 "dQw4w9WgXcQ",
		"https://www.youtube.com/@channel":                     "",
		"https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ": "",
		"https://www.youtube.com/watch?v=short":                "",
	}
	for in, want := range cases {
		u, _ := url.Parse(in)
		if got := youtubeID(u); got != want {
			t.Errorf("youtubeID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPublicAddr(t *testing.T) {
	blocked := []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
		"100.111.0.8", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"}
	for _, a := range blocked {
		if publicAddr(netip.MustParseAddr(a)) {
			t.Errorf("%s should be blocked", a)
		}
	}
	for _, a := range []string{"93.184.216.34", "2606:2800:220:1::1"} {
		if !publicAddr(netip.MustParseAddr(a)) {
			t.Errorf("%s should be allowed", a)
		}
	}
}

func TestFetcherBlocksPrivateAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<title>secret</title>"))
	}))
	defer srv.Close()
	f := NewFetcher(false)
	if _, err := f.get(context.Background(), srv.URL, "text/html"); err == nil {
		t.Fatal("fetching a loopback server must fail")
	}
	// The dialer runs for every connection (redirects included).
	if _, err := f.get(context.Background(), "http://localhost:1/x", "text/html"); err == nil {
		t.Fatal("localhost must fail")
	}
	if _, err := f.get(context.Background(), "file:///etc/passwd", "text/html"); err == nil {
		t.Fatal("non-http schemes must fail")
	}
}

func pngBytes(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 128, 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

type fixture struct {
	svc   *Service
	media *chatmedia.MemoryStore
	store *chatstore.Service
	srv   *httptest.Server
	hits  map[string]int
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	f := &fixture{media: chatmedia.NewMemoryStore(), hits: map[string]int{}}
	f.store = chatstore.New(chatstore.NewMemoryEngine(), chatstore.Options{})
	if err := f.store.Bootstrap(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/page", func(w http.ResponseWriter, r *http.Request) {
		f.hits[r.URL.Path]++
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html><head><meta property="og:title" content="Page title">
			<meta property="og:site_name" content="Example"><meta property="og:image" content="/cover.png"></head></html>`))
	})
	mux.HandleFunc("/cover.png", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes(1200, 600))
	})
	mux.HandleFunc("/empty", func(w http.ResponseWriter, r *http.Request) {
		f.hits[r.URL.Path]++
		_, _ = w.Write([]byte(`<html><head></head></html>`))
	})
	mux.HandleFunc("/file.pdf", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte("%PDF-1.4"))
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	f.svc = New(Options{DB: db, Messages: f.store, Media: f.media, Fetcher: NewFetcher(true)})
	return f
}

func TestBuildFetchesAndProxiesImages(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	urls := []string{f.srv.URL + "/page", f.srv.URL + "/cover.png", f.srv.URL + "/empty", f.srv.URL + "/file.pdf"}
	embeds := f.svc.Build(ctx, urls, nil)
	if len(embeds) != 2 {
		t.Fatalf("embeds = %+v, want page + image", embeds)
	}
	page, img := embeds[0], embeds[1]
	if page.Kind != chatstore.EmbedLink || page.Title != "Page title" || page.SiteName != "Example" ||
		page.ImageID == "" || page.ImageWidth != 480 || page.ImageHeight != 240 {
		t.Fatalf("page embed = %+v", page)
	}
	if img.Kind != chatstore.EmbedImage || img.ImageID == "" {
		t.Fatalf("image embed = %+v", img)
	}
	data, err := f.svc.Image(ctx, page.ImageID)
	if err != nil || !bytes.HasPrefix(data, []byte("RIFF")) {
		t.Fatalf("stored thumbnail: %v", err)
	}
	if _, err := f.svc.Image(ctx, "../../etc/passwd"); err == nil {
		t.Fatal("bad ids must be rejected")
	}

	// Cached: neither the page nor the failed page is fetched again.
	f.svc.Build(ctx, urls[:3], nil)
	if f.hits["/page"] != 1 || f.hits["/empty"] != 1 {
		t.Fatalf("hits = %v, want one fetch each", f.hits)
	}
}

func TestScheduleStoresAndBroadcasts(t *testing.T) {
	f := newFixture(t)
	msg, err := f.store.Create(context.Background(), chatstore.CreateInput{
		RoomID: "20261110145113MiTbtB", SenderID: "qkUrdzLDoqslx8EEy2cM7Q==", Content: "see " + f.srv.URL + "/page",
	})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan *chatstore.Message, 1)
	f.svc.Schedule(msg, func(m *chatstore.Message) { done <- m })
	select {
	case m := <-done:
		if len(m.Embeds) != 1 || m.Embeds[0].Title != "Page title" {
			t.Fatalf("embeds = %+v", m.Embeds)
		}
		// Current now: scheduling again does nothing.
		if !chatstore.EmbedsCurrent(m, chatstore.PreviewURLs(m.Content)) {
			t.Fatal("embeds should be current")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no previews stored")
	}
}
