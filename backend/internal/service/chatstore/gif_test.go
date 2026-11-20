package chatstore

import (
	"context"
	"errors"
	"strings"
	"testing"
)

const (
	klipyGIFURL   = "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/MCCBoQlZ.mp4"
	klipyPoster   = "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/LyWpim71.jpg"
	klipyGIFRefID = "8041071659142944"
)

func validGIF() *GIF {
	return &GIF{
		Provider: "KLIPY", ID: klipyGIFRefID, URL: klipyGIFURL, PreviewURL: klipyPoster,
		Width: 498, Height: 498, Title: "  Hello\nworld  ",
	}
}

func TestNormalizeGIFAcceptsProviderMedia(t *testing.T) {
	got, err := NormalizeGIF(validGIF())
	if err != nil {
		t.Fatalf("NormalizeGIF: %v", err)
	}
	if got.Provider != "klipy" || got.ID != klipyGIFRefID {
		t.Fatalf("provider/id not normalized: %+v", got)
	}
	if got.URL != klipyGIFURL || got.PreviewURL != klipyPoster {
		t.Fatalf("URLs rewritten: %+v", got)
	}
	if got.Width != 498 || got.Height != 498 {
		t.Fatalf("dimensions: %+v", got)
	}
	// The newline is a line break in the provider's title, not stored as a
	// control character; repeated spaces are collapsed.
	if got.Title != "Hello world" {
		t.Fatalf("title not cleaned: %q", got.Title)
	}
}

func TestNormalizeGIFAcceptsGiphyCDN(t *testing.T) {
	got, err := NormalizeGIF(&GIF{
		Provider: "giphy", ID: "3o7aD2saalBwwftBIY",
		URL:        "https://media3.giphy.com/media/x/giphy.mp4",
		PreviewURL: "https://i.giphy.com/media/x/giphy_s.jpg",
	})
	if err != nil {
		t.Fatalf("NormalizeGIF: %v", err)
	}
	if got.URL != "https://media3.giphy.com/media/x/giphy.mp4" {
		t.Fatalf("URL rewritten: %+v", got)
	}
}

func TestNormalizeGIFNilStaysNil(t *testing.T) {
	got, err := NormalizeGIF(nil)
	if err != nil || got != nil {
		t.Fatalf("NormalizeGIF(nil) = %+v, %v", got, err)
	}
}

func TestNormalizeGIFRejectsBadReferences(t *testing.T) {
	base := func() *GIF { return validGIF() }
	cases := []struct {
		name  string
		edit  func(g *GIF)
	}{
		{"unknown provider", func(g *GIF) { g.Provider = "tenor" }},
		{"empty provider", func(g *GIF) { g.Provider = "" }},
		{"id with a slash", func(g *GIF) { g.ID = "abc/def" }},
		{"id with a space", func(g *GIF) { g.ID = "abc def" }},
		{"empty id", func(g *GIF) { g.ID = "" }},
		{"http media", func(g *GIF) { g.URL = strings.Replace(g.URL, "https://", "http://", 1) }},
		{"javascript media", func(g *GIF) { g.URL = "javascript:alert(1)" }},
		{"media on another host", func(g *GIF) { g.URL = "https://evil.example/x.mp4" }},
		{"lookalike domain", func(g *GIF) { g.URL = "https://evilklipy.com/x.mp4" }},
		{"domain suffix trick", func(g *GIF) { g.URL = "https://static.klipy.com.evil.example/x.mp4" }},
		{"userinfo host", func(g *GIF) { g.URL = "https://static.klipy.com@evil.example/x.mp4" }},
		{"ip host", func(g *GIF) { g.URL = "https://203.0.113.7/x.mp4" }},
		{"explicit port", func(g *GIF) { g.URL = "https://static.klipy.com:8443/x.mp4" }},
		{"empty media", func(g *GIF) { g.URL = "" }},
		{"poster on another host", func(g *GIF) { g.PreviewURL = "https://media.giphy.com/media/x/giphy.jpg" }},
		{"poster on another provider", func(g *GIF) { g.Provider = "giphy" }},
		{"oversized URL", func(g *GIF) { g.URL = klipyGIFURL + strings.Repeat("a", maxGIFURLLen) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := base()
			tc.edit(g)
			if _, err := NormalizeGIF(g); !errors.Is(err, ErrInvalid) {
				t.Fatalf("got %v, want ErrInvalid", err)
			}
		})
	}
}

func TestNormalizeGIFDropsUnusableDimensions(t *testing.T) {
	g := validGIF()
	g.Width, g.Height = 0, 99999
	got, err := NormalizeGIF(g)
	if err != nil {
		t.Fatalf("NormalizeGIF: %v", err)
	}
	if got.Width != 0 || got.Height != 0 {
		t.Fatalf("dimensions not dropped: %+v", got)
	}
}

func TestNormalizeGIFShortensTitle(t *testing.T) {
	g := validGIF()
	g.Title = strings.Repeat("ы", maxGIFTitleRunes+50)
	got, err := NormalizeGIF(g)
	if err != nil {
		t.Fatalf("NormalizeGIF: %v", err)
	}
	if n := len([]rune(got.Title)); n != maxGIFTitleRunes {
		t.Fatalf("title has %d runes, want %d", n, maxGIFTitleRunes)
	}
}

// A GIF is content on its own: the message may have no text.
func TestCreateGIFOnlyMessage(t *testing.T) {
	s, _, _ := newTestService(t)
	gif, err := NormalizeGIF(validGIF())
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.Create(context.Background(), CreateInput{
		RoomID: "room", SenderID: "qkUrdzLDoqslx8EEy2cM7Q==", GIF: gif,
	})
	if err != nil {
		t.Fatalf("create GIF-only message: %v", err)
	}
	if msg.Content != "" {
		t.Fatalf("content = %q, want empty", msg.Content)
	}
	pub := msg.Public()
	if pub.GIF == nil || pub.GIF.ID != klipyGIFRefID || pub.GIF.URL != klipyGIFURL {
		t.Fatalf("public message lost the GIF: %+v", pub.GIF)
	}
	// The stored copy is owned by the message, not the caller's input.
	gif.Title = "changed"
	if stored, _ := s.Get(context.Background(), msg.ID); stored.GIF.Title == "changed" {
		t.Fatal("message shares the caller's GIF pointer")
	}
}

func TestCreateWithoutGIFStillRequiresContent(t *testing.T) {
	s, _, _ := newTestService(t)
	if _, err := s.Create(context.Background(), CreateInput{RoomID: "room", SenderID: "u"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got %v, want ErrInvalid", err)
	}
}

// Clearing the caption of a GIF message must be allowed: the GIF remains.
func TestEditGIFMessageAllowsEmptyText(t *testing.T) {
	s, _, _ := newTestService(t)
	gif, err := NormalizeGIF(validGIF())
	if err != nil {
		t.Fatal(err)
	}
	const sender = "qkUrdzLDoqslx8EEy2cM7Q=="
	msg, err := s.Create(context.Background(), CreateInput{
		RoomID: "room", SenderID: sender, Content: "caption", GIF: gif,
	})
	if err != nil {
		t.Fatal(err)
	}
	edited, err := s.Edit(context.Background(), msg.ID, sender, "")
	if err != nil {
		t.Fatalf("edit to empty: %v", err)
	}
	if edited.Content != "" || edited.GIF == nil {
		t.Fatalf("bad edit result: content %q, gif %+v", edited.Content, edited.GIF)
	}
}
