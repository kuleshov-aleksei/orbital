package handlers

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/color/palette"
	"image/gif"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

type countingEmojiNotifier struct{ n int }

func (c *countingEmojiNotifier) BroadcastCustomEmojisUpdated() { c.n++ }

func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		img.Set(x, x%h, color.NRGBA{R: 255, A: 200})
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// testGIF builds an animated GIF with the given number of frames.
func testGIF(t *testing.T, w, h, frames int) []byte {
	t.Helper()
	g := &gif.GIF{LoopCount: 0}
	for i := 0; i < frames; i++ {
		frame := image.NewPaletted(image.Rect(0, 0, w, h), palette.Plan9)
		for x := 0; x < w; x++ {
			frame.SetColorIndex(x, (x+i)%h, uint8(i+1))
		}
		g.Image = append(g.Image, frame)
		g.Delay = append(g.Delay, 10)
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, g); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// webpInfo reads a WebP's canvas size and frame count from its RIFF chunks
// (VP8X canvas + ANMF frames for animations, VP8L/VP8 for still images).
func webpInfo(t *testing.T, data []byte) (w, h, frames int) {
	t.Helper()
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		t.Fatalf("not a webp: % x", data[:min(len(data), 12)])
	}
	for off := 12; off+8 <= len(data); {
		fourcc := string(data[off : off+4])
		size := int(binary.LittleEndian.Uint32(data[off+4 : off+8]))
		p := data[off+8 : min(len(data), off+8+size)]
		switch fourcc {
		case "VP8X":
			w = 1 + (int(p[4]) | int(p[5])<<8 | int(p[6])<<16)
			h = 1 + (int(p[7]) | int(p[8])<<8 | int(p[9])<<16)
		case "ANMF":
			frames++
		case "VP8L":
			if w == 0 {
				bits := binary.LittleEndian.Uint32(p[1:5])
				w, h = int(bits&0x3FFF)+1, int(bits>>14&0x3FFF)+1
			}
			frames = max(frames, 1)
		case "VP8 ":
			if w == 0 {
				w, h = int(binary.LittleEndian.Uint16(p[6:8])&0x3FFF), int(binary.LittleEndian.Uint16(p[8:10])&0x3FFF)
			}
			frames = max(frames, 1)
		}
		off += 8 + size + size%2
	}
	return w, h, frames
}

func newEmojiFixture(t *testing.T) (*rbacFixture, *EmojiHandler, *service.EmojiService, *countingEmojiNotifier) {
	t.Helper()
	f := newRBACFixture(t)
	svc := service.NewEmojiService(repository.NewEmojiRepository(f.db), t.TempDir(), 0)
	n := &countingEmojiNotifier{}
	return f, NewEmojiHandler(svc, f.ps, n), svc, n
}

func uploadEmoji(t *testing.T, f *rbacFixture, h *EmojiHandler, as string, img []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if img != nil {
		fw, _ := mw.CreateFormFile("image", "emoji.png")
		_, _ = fw.Write(img)
	}
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, f.claims[as]))
	rec := httptest.NewRecorder()
	h.UploadEmoji(rec, req)
	return rec
}

func emojiFields() map[string]string {
	return map[string]string{"name": "Party Parrot", "aliases": `["parrot"," PARTY ","parrot"]`}
}

// grantAdminRole gives a fixture user the seeded Admin system role.
func grantAdminRole(t *testing.T, f *rbacFixture, userID string) {
	t.Helper()
	if _, err := f.ps.SetUserRoles(f.ownerSub, userID, []string{"admin"}); err != nil {
		t.Fatal(err)
	}
}

func TestEmojiUploadAndList(t *testing.T) {
	f, h, _, n := newEmojiFixture(t)
	grantAdminRole(t, f, "user")

	rec := uploadEmoji(t, f, h, "user", testPNG(t, 300, 150), emojiFields())
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var emoji models.CustomEmoji
	_ = json.Unmarshal(rec.Body.Bytes(), &emoji)
	if emoji.Name != "Party Parrot" || len(emoji.Aliases) != 2 || emoji.Aliases[1] != "party" || emoji.ImageURL == "" {
		t.Fatalf("unexpected emoji: %+v", emoji)
	}
	if n.n != 1 {
		t.Fatalf("expected one custom_emojis_updated broadcast, got %d", n.n)
	}

	list := f.do(t, "guest", h.ListEmojis, http.MethodGet, nil, nil)
	var emojis []models.CustomEmoji
	_ = json.Unmarshal(list.Body.Bytes(), &emojis)
	if len(emojis) != 1 || emojis[0].ID != emoji.ID {
		t.Fatalf("list = %+v", emojis)
	}

	// The stored image is re-encoded as WebP to fit within 128x128, keeping
	// aspect ratio.
	img := f.do(t, "", h.GetEmojiImage, http.MethodGet, map[string]string{"id": emoji.ID}, nil)
	if img.Code != http.StatusOK || img.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("image: %d %q", img.Code, img.Header().Get("Content-Type"))
	}
	if w, h, frames := webpInfo(t, img.Body.Bytes()); w != 128 || h != 64 || frames != 1 {
		t.Fatalf("stored = %dx%d %d frames, want 128x64 still", w, h, frames)
	}
	if emoji.Animated {
		t.Fatal("png emoji must not be marked animated")
	}
	// Static emojis have no still variant; the image itself is served.
	if still := f.doQuery(t, h.GetEmojiImage, map[string]string{"id": emoji.ID}, "still=1"); still.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("still of static emoji: %q", still.Header().Get("Content-Type"))
	}
}

func TestEmojiUploadAnimatedGIF(t *testing.T) {
	f, h, _, _ := newEmojiFixture(t)
	rec := uploadEmoji(t, f, h, "owner", testGIF(t, 256, 200, 3), emojiFields())
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var emoji models.CustomEmoji
	_ = json.Unmarshal(rec.Body.Bytes(), &emoji)

	img := f.do(t, "", h.GetEmojiImage, http.MethodGet, map[string]string{"id": emoji.ID}, nil)
	if img.Code != http.StatusOK || img.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("image: %d %q", img.Code, img.Header().Get("Content-Type"))
	}
	if w, h, frames := webpInfo(t, img.Body.Bytes()); w != 128 || h != 100 || frames != 3 {
		t.Fatalf("stored = %dx%d %d frames, want 128x100 with 3 frames", w, h, frames)
	}
	if !emoji.Animated {
		t.Fatal("gif emoji must be marked animated")
	}

	// The still variant is the first frame as a PNG of the same size.
	still := f.doQuery(t, h.GetEmojiImage, map[string]string{"id": emoji.ID}, "still=1")
	if still.Code != http.StatusOK || still.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("still: %d %q", still.Code, still.Header().Get("Content-Type"))
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(still.Body.Bytes()))
	if err != nil || cfg.Width != 128 || cfg.Height != 100 {
		t.Fatalf("still = %v %dx%d, want 128x100", err, cfg.Width, cfg.Height)
	}
}

// Animated WebP uploads are accepted, and a stored animated WebP survives a
// re-upload round trip with its frames.
func TestEmojiUploadAnimatedWebP(t *testing.T) {
	f, h, _, _ := newEmojiFixture(t)
	rec := uploadEmoji(t, f, h, "owner", testGIF(t, 64, 64, 4), emojiFields())
	var first models.CustomEmoji
	_ = json.Unmarshal(rec.Body.Bytes(), &first)
	webp := f.do(t, "", h.GetEmojiImage, http.MethodGet, map[string]string{"id": first.ID}, nil).Body.Bytes()

	rec = uploadEmoji(t, f, h, "owner", webp, map[string]string{"name": "again"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("webp upload: %d %s", rec.Code, rec.Body.String())
	}
	var emoji models.CustomEmoji
	_ = json.Unmarshal(rec.Body.Bytes(), &emoji)
	if !emoji.Animated {
		t.Fatal("animated webp must be marked animated")
	}
	img := f.do(t, "", h.GetEmojiImage, http.MethodGet, map[string]string{"id": emoji.ID}, nil)
	if w, h, frames := webpInfo(t, img.Body.Bytes()); w != 64 || h != 64 || frames != 4 {
		t.Fatalf("stored = %dx%d %d frames, want 64x64 with 4 frames", w, h, frames)
	}
}

// Emojis stored before WebP are converted at startup and get a new URL.
func TestEmojiMigrateToWebP(t *testing.T) {
	f := newRBACFixture(t)
	dataDir := t.TempDir()
	repo := repository.NewEmojiRepository(f.db)
	svc := service.NewEmojiService(repo, dataDir, 0)
	h := NewEmojiHandler(svc, f.ps, nil)

	dir := filepath.Join(dataDir, "emojis")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	legacy := []struct {
		id, file string
		data     []byte
		animated bool
	}{
		{"legacy-png", "legacy-png.png", testPNG(t, 32, 32), false},
		{"legacy-gif", "legacy-gif.gif", testGIF(t, 32, 32, 2), true},
	}
	for _, l := range legacy {
		if err := os.WriteFile(filepath.Join(dir, l.file), l.data, 0644); err != nil {
			t.Fatal(err)
		}
		if err := repo.Create(&models.CustomEmoji{ID: l.id, Name: l.id, Aliases: []string{}, Filename: l.file, Animated: l.animated}); err != nil {
			t.Fatal(err)
		}
	}
	// Legacy files are still served while unconverted.
	if img := f.do(t, "", h.GetEmojiImage, http.MethodGet, map[string]string{"id": "legacy-gif"}, nil); img.Header().Get("Content-Type") != "image/gif" {
		t.Fatalf("legacy gif served as %q", img.Header().Get("Content-Type"))
	}

	if n := svc.MigrateToWebP(); n != 2 {
		t.Fatalf("converted %d, want 2", n)
	}
	if n := svc.MigrateToWebP(); n != 0 {
		t.Fatalf("second run converted %d, want 0", n)
	}
	for _, l := range legacy {
		e, err := repo.GetByID(l.id)
		if err != nil || e == nil {
			t.Fatal(err)
		}
		if e.Filename != l.id+"-w.webp" || e.Animated != l.animated {
			t.Fatalf("%s: filename %q animated %v", l.id, e.Filename, e.Animated)
		}
		if _, err := os.Stat(filepath.Join(dir, l.file)); !os.IsNotExist(err) {
			t.Fatalf("%s: old file not removed", l.id)
		}
		img := f.do(t, "", h.GetEmojiImage, http.MethodGet, map[string]string{"id": l.id}, nil)
		if img.Header().Get("Content-Type") != "image/webp" {
			t.Fatalf("%s served as %q", l.id, img.Header().Get("Content-Type"))
		}
	}
}

// doQuery is a public GET with a query string.
func (f *rbacFixture) doQuery(t *testing.T, handler http.HandlerFunc, vars map[string]string, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/?"+query, nil), vars)
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func TestEmojiUploadDeniedByDefault(t *testing.T) {
	f, h, _, n := newEmojiFixture(t)

	// Regular users do not get upload_emojis by default; only admins do.
	if rec := uploadEmoji(t, f, h, "user", testPNG(t, 32, 32), emojiFields()); rec.Code != http.StatusForbidden {
		t.Fatalf("user upload: %d, want 403", rec.Code)
	}
	if rec := uploadEmoji(t, f, h, "guest", testPNG(t, 32, 32), emojiFields()); rec.Code != http.StatusForbidden {
		t.Fatalf("guest upload: %d, want 403", rec.Code)
	}
	if n.n != 0 {
		t.Fatal("denied uploads must not broadcast")
	}
}

func TestEmojiUploadValidation(t *testing.T) {
	f, h, _, _ := newEmojiFixture(t)
	cases := []struct {
		name   string
		img    []byte
		fields map[string]string
		want   int
	}{
		{"missing file", nil, emojiFields(), http.StatusBadRequest},
		{"jpeg", append([]byte{0xFF, 0xD8, 0xFF}, make([]byte, 64)...), emojiFields(), http.StatusBadRequest},
		{"truncated png", testPNG(t, 16, 16)[:20], emojiFields(), http.StatusBadRequest},
		{"too large", append(testPNG(t, 16, 16), make([]byte, service.MaxEmojiFileSize)...), emojiFields(), http.StatusRequestEntityTooLarge},
		{"truncated gif", testGIF(t, 16, 16, 2)[:30], emojiFields(), http.StatusBadRequest},
		{"animation too big", testGIF(t, 600, 16, 2), emojiFields(), http.StatusBadRequest},
		{"too many frames", testGIF(t, 2, 2, 301), emojiFields(), http.StatusBadRequest},
		{"tiff", append([]byte("II*\x00"), make([]byte, 64)...), emojiFields(), http.StatusBadRequest},
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>`), emojiFields(), http.StatusBadRequest},
		{"truncated webp", []byte("RIFF\x10\x00\x00\x00WEBPVP8L"), emojiFields(), http.StatusBadRequest},
		{"empty name", testPNG(t, 16, 16), map[string]string{"name": "  "}, http.StatusBadRequest},
		{"bad aliases", testPNG(t, 16, 16), map[string]string{"name": "x", "aliases": "nope"}, http.StatusBadRequest},
	}
	for _, c := range cases {
		if rec := uploadEmoji(t, f, h, "owner", c.img, c.fields); rec.Code != c.want {
			t.Errorf("%s: %d %s, want %d", c.name, rec.Code, rec.Body.String(), c.want)
		}
	}
}

func TestEmojiModerationRequiresManageEmojis(t *testing.T) {
	f, h, svc, n := newEmojiFixture(t)
	emoji, err := svc.Create("owner", testPNG(t, 32, 32), "blob", nil)
	if err != nil {
		t.Fatal(err)
	}
	vars := map[string]string{"id": emoji.ID}
	rename := map[string]any{"name": "blobby", "aliases": []string{"b"}}

	if rec := f.do(t, "user", h.UpdateEmoji, http.MethodPatch, vars, rename); rec.Code != http.StatusForbidden {
		t.Fatalf("user update: %d, want 403", rec.Code)
	}
	if rec := f.do(t, "user", h.DeleteEmoji, http.MethodDelete, vars, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("user delete: %d, want 403", rec.Code)
	}
	if n.n != 0 {
		t.Fatal("denied moderation must not broadcast")
	}

	grantAdminRole(t, f, "user")
	rec := f.do(t, "user", h.UpdateEmoji, http.MethodPatch, vars, rename)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin update: %d %s", rec.Code, rec.Body.String())
	}
	var updated models.CustomEmoji
	_ = json.Unmarshal(rec.Body.Bytes(), &updated)
	if updated.Name != "blobby" || len(updated.Aliases) != 1 {
		t.Fatalf("updated = %+v", updated)
	}
	if rec := f.do(t, "user", h.DeleteEmoji, http.MethodDelete, vars, nil); rec.Code != http.StatusOK {
		t.Fatalf("admin delete: %d", rec.Code)
	}
	if rec := f.do(t, "", h.GetEmojiImage, http.MethodGet, vars, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("image after delete: %d, want 404", rec.Code)
	}
	if svc.EmojiExists(emoji.ID) {
		t.Fatal("emoji still exists after delete")
	}
}

func TestCustomEmojiRefsInStatusAndSoundboard(t *testing.T) {
	f, _, svc, _ := newEmojiFixture(t)
	emoji, err := svc.Create("owner", testPNG(t, 32, 32), "blob", nil)
	if err != nil {
		t.Fatal(err)
	}
	ref := "custom:" + emoji.ID

	if err := validateEmojiRef(ref, svc); err != nil {
		t.Fatalf("existing custom ref rejected: %v", err)
	}
	for _, bad := range []string{"custom:", "custom:missing", "custom:../etc"} {
		if err := validateEmojiRef(bad, svc); err == nil {
			t.Errorf("validateEmojiRef(%q) accepted", bad)
		}
	}
	if err := validateEmojiRef(ref, nil); err == nil {
		t.Error("custom ref accepted without a lookup")
	}

	sb := NewSoundboardHandler(service.NewSoundboardService(repository.NewSoundboardRepository(f.db), t.TempDir()), f.ps, nil)
	sb.SetEmojiLookup(svc)
	fields := map[string]string{"name": "Airhorn", "emoji": ref}
	if rec := uploadSound(t, f, sb, "user", fakeMP3(1024), fields); rec.Code != http.StatusCreated {
		t.Fatalf("sound with custom emoji: %d %s", rec.Code, rec.Body.String())
	}
	fields["emoji"] = "custom:missing"
	if rec := uploadSound(t, f, sb, "user", fakeMP3(1024), fields); rec.Code != http.StatusBadRequest {
		t.Fatalf("sound with unknown custom emoji: %d, want 400", rec.Code)
	}
}
