package handlers

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

type countingNotifier struct{ n int }

func (c *countingNotifier) BroadcastSoundboardUpdated() { c.n++ }

// fakeMP3 is an ID3 header followed by padding; enough for magic-byte detection.
func fakeMP3(size int) []byte {
	data := make([]byte, size)
	copy(data, []byte("ID3"))
	return data
}

func newSoundboardFixture(t *testing.T) (*rbacFixture, *SoundboardHandler, *countingNotifier) {
	t.Helper()
	f := newRBACFixture(t)
	svc := service.NewSoundboardService(repository.NewSoundboardRepository(f.db), t.TempDir())
	n := &countingNotifier{}
	return f, NewSoundboardHandler(svc, f.ps, n), n
}

func uploadSound(t *testing.T, f *rbacFixture, h *SoundboardHandler, as string, audio []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	return sendMultipart(t, f, h.UploadSound, as, nil, audio, fields)
}

func replaceAudio(t *testing.T, f *rbacFixture, h *SoundboardHandler, as, id string, audio []byte) *httptest.ResponseRecorder {
	t.Helper()
	return sendMultipart(t, f, h.ReplaceSoundAudio, as, map[string]string{"id": id}, audio, nil)
}

func sendMultipart(t *testing.T, f *rbacFixture, handler http.HandlerFunc, as string, vars map[string]string, audio []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if audio != nil {
		fw, _ := mw.CreateFormFile("audio", "clip.mp3")
		_, _ = fw.Write(audio)
	}
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, f.claims[as]))
	if vars != nil {
		req = mux.SetURLVars(req, vars)
	}
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func validFields() map[string]string {
	return map[string]string{"name": "Airhorn", "emoji": "📯", "aliases": `["horn"," HORN ","mlg"]`}
}

func TestSoundboardUploadAndList(t *testing.T) {
	f, h, n := newSoundboardFixture(t)
	rec := uploadSound(t, f, h, "user", fakeMP3(1024), validFields())
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var sound models.SoundboardSound
	_ = json.Unmarshal(rec.Body.Bytes(), &sound)
	if sound.Format != "mp3" || sound.Name != "Airhorn" || len(sound.Aliases) != 2 || sound.Aliases[0] != "horn" {
		t.Fatalf("unexpected sound: %+v", sound)
	}
	if n.n != 1 {
		t.Fatalf("expected one soundboard_updated broadcast, got %d", n.n)
	}

	list := f.do(t, "user", h.ListSounds, http.MethodGet, nil, nil)
	var sounds []models.SoundboardSound
	_ = json.Unmarshal(list.Body.Bytes(), &sounds)
	if len(sounds) != 1 || sounds[0].AudioURL == "" {
		t.Fatalf("list = %+v", sounds)
	}
}

func TestSoundboardUploadDenied(t *testing.T) {
	f, h, n := newSoundboardFixture(t)

	if rec := uploadSound(t, f, h, "guest", fakeMP3(1024), validFields()); rec.Code != http.StatusForbidden {
		t.Fatalf("guest upload: %d, want 403", rec.Code)
	}

	// Revoke upload_sounds from @everyone: regular users lose it.
	everyone := uint64(permissions.DefaultEveryone &^ permissions.UploadSounds)
	if _, err := f.ps.UpdateRole(f.ownerSub, models.SystemRoleEveryone, service.RoleInput{Permissions: &everyone}); err != nil {
		t.Fatal(err)
	}
	if rec := uploadSound(t, f, h, "user", fakeMP3(1024), validFields()); rec.Code != http.StatusForbidden {
		t.Fatalf("upload without upload_sounds: %d, want 403", rec.Code)
	}
	if n.n != 0 {
		t.Fatal("denied uploads must not broadcast")
	}
}

func TestSoundboardUploadValidation(t *testing.T) {
	f, h, _ := newSoundboardFixture(t)
	cases := []struct {
		name   string
		audio  []byte
		fields map[string]string
		want   int
	}{
		{"not audio", []byte("hello world, not audio"), validFields(), http.StatusBadRequest},
		{"too large", fakeMP3(service.MaxSoundboardFileSize + 1), validFields(), http.StatusRequestEntityTooLarge},
		{"no file", nil, validFields(), http.StatusBadRequest},
		{"empty name", fakeMP3(64), map[string]string{"name": "  "}, http.StatusBadRequest},
		{"bad emoji", fakeMP3(64), map[string]string{"name": "x", "emoji": "abc"}, http.StatusBadRequest},
		{"bad aliases json", fakeMP3(64), map[string]string{"name": "x", "aliases": "horn"}, http.StatusBadRequest},
		{"too many aliases", fakeMP3(64), map[string]string{"name": "x", "aliases": `["a","b","c","d","e","f","g","h","i","j","k"]`}, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rec := uploadSound(t, f, h, "user", tc.audio, tc.fields); rec.Code != tc.want {
				t.Fatalf("got %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestSoundboardModerationRequiresManageSoundboard(t *testing.T) {
	f, h, _ := newSoundboardFixture(t)
	rec := uploadSound(t, f, h, "user", fakeMP3(1024), validFields())
	var sound models.SoundboardSound
	_ = json.Unmarshal(rec.Body.Bytes(), &sound)
	vars := map[string]string{"id": sound.ID}
	newName := "Renamed"

	// The uploader and the "Mod" role (no manage_soundboard) are both denied.
	for _, as := range []string{"user", "mod", "guest"} {
		if rec := f.do(t, as, h.UpdateSound, http.MethodPatch, vars, models.UpdateSoundboardSoundRequest{Name: &newName}); rec.Code != http.StatusForbidden {
			t.Fatalf("PATCH as %s: %d, want 403", as, rec.Code)
		}
		if rec := f.do(t, as, h.DeleteSound, http.MethodDelete, vars, nil); rec.Code != http.StatusForbidden {
			t.Fatalf("DELETE as %s: %d, want 403", as, rec.Code)
		}
	}

	// Granting manage_soundboard to the Mod role allows moderation.
	modPerms := uint64(permissions.ManageRoles | permissions.ManageSoundboard)
	if _, err := f.ps.UpdateRole(f.ownerSub, f.modRole.ID, service.RoleInput{Permissions: &modPerms}); err != nil {
		t.Fatal(err)
	}
	rec = f.do(t, "mod", h.UpdateSound, http.MethodPatch, vars, models.UpdateSoundboardSoundRequest{Name: &newName})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH as mod with manage_soundboard: %d %s", rec.Code, rec.Body.String())
	}
	var updated models.SoundboardSound
	_ = json.Unmarshal(rec.Body.Bytes(), &updated)
	if updated.Name != newName || len(updated.Aliases) != 2 {
		t.Fatalf("partial update changed the wrong fields: %+v", updated)
	}
	if rec := f.do(t, "mod", h.DeleteSound, http.MethodDelete, vars, nil); rec.Code != http.StatusOK {
		t.Fatalf("DELETE as mod: %d", rec.Code)
	}
	if rec := f.do(t, "owner", h.DeleteSound, http.MethodDelete, vars, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("DELETE missing sound: %d, want 404", rec.Code)
	}
	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/", nil), vars)
	audio := httptest.NewRecorder()
	h.GetSoundAudio(audio, req)
	if audio.Code != http.StatusNotFound {
		t.Fatalf("audio of deleted sound: %d, want 404", audio.Code)
	}
}

// silentWAV is a 16-bit mono 48 kHz WAV of the given length.
func silentWAV(seconds float64) []byte {
	pcm := make([]byte, int(seconds*48000)*2)
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+len(pcm)))
	b.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(48000), uint32(96000), uint16(2), uint16(16)} {
		_ = binary.Write(&b, binary.LittleEndian, v)
	}
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(len(pcm)))
	b.Write(pcm)
	return b.Bytes()
}

func TestSoundboardWAVUploadIsTranscodedToOpus(t *testing.T) {
	f, h, _ := newSoundboardFixture(t)
	rec := uploadSound(t, f, h, "user", silentWAV(1), validFields())
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var sound models.SoundboardSound
	_ = json.Unmarshal(rec.Body.Bytes(), &sound)
	if sound.Format != "ogg" {
		t.Fatalf("format = %q, want ogg", sound.Format)
	}

	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/", nil), map[string]string{"id": sound.ID})
	audio := httptest.NewRecorder()
	h.GetSoundAudio(audio, req)
	if audio.Code != http.StatusOK || !bytes.HasPrefix(audio.Body.Bytes(), []byte("OggS")) {
		t.Fatalf("stored audio: %d, prefix %q", audio.Code, audio.Body.Bytes()[:min(4, audio.Body.Len())])
	}
	if sound.FileSize != int64(audio.Body.Len()) {
		t.Fatalf("file_size = %d, stored %d bytes", sound.FileSize, audio.Body.Len())
	}
}

func TestSoundboardWAVUploadRejectsLongOrUnsupported(t *testing.T) {
	f, h, _ := newSoundboardFixture(t)
	long := silentWAV(6)
	if rec := uploadSound(t, f, h, "user", long, validFields()); rec.Code != http.StatusBadRequest {
		t.Fatalf("6s WAV: %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
	stereo := silentWAV(1)
	binary.LittleEndian.PutUint16(stereo[22:], 2)
	if rec := uploadSound(t, f, h, "user", stereo, validFields()); rec.Code != http.StatusBadRequest {
		t.Fatalf("stereo WAV: %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

func TestSoundboardReplaceAudio(t *testing.T) {
	f, h, n := newSoundboardFixture(t)
	rec := uploadSound(t, f, h, "user", fakeMP3(1024), validFields())
	var original models.SoundboardSound
	_ = json.Unmarshal(rec.Body.Bytes(), &original)

	// Uploader, Mod (no manage_soundboard) and guests are denied.
	for _, as := range []string{"user", "mod", "guest"} {
		if rec := replaceAudio(t, f, h, as, original.ID, silentWAV(1)); rec.Code != http.StatusForbidden {
			t.Fatalf("replace as %s: %d, want 403", as, rec.Code)
		}
	}
	if rec := replaceAudio(t, f, h, "owner", "missing", silentWAV(1)); rec.Code != http.StatusNotFound {
		t.Fatalf("replace missing sound: %d, want 404", rec.Code)
	}
	if rec := replaceAudio(t, f, h, "owner", original.ID, silentWAV(6)); rec.Code != http.StatusBadRequest {
		t.Fatalf("replace with 6s WAV: %d, want 400", rec.Code)
	}

	before := n.n
	rec = replaceAudio(t, f, h, "owner", original.ID, silentWAV(1))
	if rec.Code != http.StatusOK {
		t.Fatalf("replace as owner: %d %s", rec.Code, rec.Body.String())
	}
	var replaced models.SoundboardSound
	_ = json.Unmarshal(rec.Body.Bytes(), &replaced)
	if replaced.ID != original.ID || replaced.Name != original.Name || replaced.Format != "ogg" {
		t.Fatalf("replace changed identity/metadata: %+v", replaced)
	}
	// The audio endpoint is cached as immutable, so the URL must change.
	if replaced.AudioURL == original.AudioURL {
		t.Fatalf("audio_url did not change: %s", replaced.AudioURL)
	}
	if n.n != before+1 {
		t.Fatalf("expected a soundboard_updated broadcast")
	}

	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/", nil), map[string]string{"id": original.ID})
	audio := httptest.NewRecorder()
	h.GetSoundAudio(audio, req)
	if !bytes.HasPrefix(audio.Body.Bytes(), []byte("OggS")) {
		t.Fatalf("served audio is not the replacement")
	}
}
