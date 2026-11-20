package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

type fakeBadgeNotifier struct {
	library  int
	updates  int
	lastUser string
	lastSet  []models.UserBadge
}

func (f *fakeBadgeNotifier) BroadcastBadgesUpdated() { f.library++ }

func (f *fakeBadgeNotifier) BroadcastUserBadgesUpdated(userID string, badges []models.UserBadge) {
	f.updates++
	f.lastUser = userID
	f.lastSet = badges
}

func newBadgeFixture(t *testing.T) (*rbacFixture, *BadgeHandler, *fakeBadgeNotifier) {
	t.Helper()
	f := newRBACFixture(t)
	svc := service.NewBadgeService(repository.NewBadgeRepository(f.db), f.users, t.TempDir())
	n := &fakeBadgeNotifier{}
	return f, NewBadgeHandler(svc, n), n
}

func uploadBadge(t *testing.T, f *rbacFixture, h *BadgeHandler, as string, img []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if img != nil {
		fw, _ := mw.CreateFormFile("image", "badge.png")
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
	h.UploadBadge(rec, req)
	return rec
}

func badgeFields(name string) map[string]string {
	return map[string]string{"name": name, "description": "Pulled an all-nighter shipping it"}
}

func TestBadgeUploadListAndAward(t *testing.T) {
	f, h, n := newBadgeFixture(t)

	rec := uploadBadge(t, f, h, "owner", testPNG(t, 600, 300), badgeFields("Night Owl"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var badge models.Badge
	_ = json.Unmarshal(rec.Body.Bytes(), &badge)
	if badge.Name != "Night Owl" || badge.Description == "" || badge.ImageURL == "" || badge.FileSize == 0 {
		t.Fatalf("unexpected badge: %+v", badge)
	}
	if n.library != 1 {
		t.Fatalf("expected one badges_updated broadcast, got %d", n.library)
	}

	// Stored image fits 256x256, keeping the aspect ratio.
	img := f.do(t, "user", h.GetBadgeImage, http.MethodGet, map[string]string{"id": badge.ID}, nil)
	if img.Code != http.StatusOK || img.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("image: %d %q", img.Code, img.Header().Get("Content-Type"))
	}
	if w, hh, frames := webpInfo(t, img.Body.Bytes()); w != 256 || hh != 128 || frames != 1 {
		t.Fatalf("stored = %dx%d %d frames, want 256x128 still", w, hh, frames)
	}

	list := f.do(t, "user", h.ListBadges, http.MethodGet, nil, nil)
	var badges []models.Badge
	_ = json.Unmarshal(list.Body.Bytes(), &badges)
	if len(badges) != 1 || badges[0].ID != badge.ID {
		t.Fatalf("list = %+v", badges)
	}

	award := f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{badge.ID, badge.ID}})
	if award.Code != http.StatusOK {
		t.Fatalf("award: %d %s", award.Code, award.Body.String())
	}
	if n.updates != 1 || n.lastUser != "user" || len(n.lastSet) != 1 {
		t.Fatalf("broadcast = %d %q %+v", n.updates, n.lastUser, n.lastSet)
	}

	rec = f.do(t, "user", h.GetAssignments, http.MethodGet, nil, nil)
	var payload struct {
		Assignments models.BadgeAssignments `json:"assignments"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	held := payload.Assignments["user"]
	if len(held) != 1 || held[0].BadgeID != badge.ID || held[0].AssignedAt.IsZero() {
		t.Fatalf("assignments = %+v", payload.Assignments)
	}
}

func TestBadgeAwardKeepsOriginalDate(t *testing.T) {
	f, h, _ := newBadgeFixture(t)
	first := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("First"))
	second := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("Second"))
	var b1, b2 models.Badge
	_ = json.Unmarshal(first.Body.Bytes(), &b1)
	_ = json.Unmarshal(second.Body.Bytes(), &b2)

	rec := f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{b1.ID}})
	if rec.Code != http.StatusOK {
		t.Fatalf("first award: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Badges []models.UserBadge `json:"badges"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	awardedAt := out.Badges[0].AssignedAt

	// Adding a second badge must not restamp the first one.
	time.Sleep(5 * time.Millisecond)
	rec = f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{b1.ID, b2.ID}})
	if rec.Code != http.StatusOK {
		t.Fatalf("second award: %d %s", rec.Code, rec.Body.String())
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Badges) != 2 {
		t.Fatalf("badges = %+v", out.Badges)
	}
	if !out.Badges[0].AssignedAt.Equal(awardedAt) {
		t.Fatalf("first badge was restamped: %s -> %s", awardedAt, out.Badges[0].AssignedAt)
	}

	// Revoking everything empties the set.
	rec = f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{}})
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != http.StatusOK || len(out.Badges) != 0 {
		t.Fatalf("revoke: %d %+v", rec.Code, out.Badges)
	}
}

func TestBadgeAwardValidation(t *testing.T) {
	f, h, _ := newBadgeFixture(t)
	created := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("Real"))
	var badge models.Badge
	_ = json.Unmarshal(created.Body.Bytes(), &badge)

	if rec := f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{"missing"}}); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown badge: %d %s", rec.Code, rec.Body.String())
	}
	if rec := f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "nobody"}, models.SetUserBadgesRequest{BadgeIDs: []string{badge.ID}}); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown user: %d %s", rec.Code, rec.Body.String())
	}
}

func TestBadgeUploadValidation(t *testing.T) {
	f, h, _ := newBadgeFixture(t)

	if rec := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), map[string]string{"name": " "}); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty name: %d %s", rec.Code, rec.Body.String())
	}
	if rec := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100),
		map[string]string{"name": "Long", "description": strings.Repeat("x", service.MaxBadgeDescriptionLength+1)}); rec.Code != http.StatusBadRequest {
		t.Fatalf("long description: %d %s", rec.Code, rec.Body.String())
	}
	if rec := uploadBadge(t, f, h, "owner", []byte("definitely not an image"), badgeFields("Bad type")); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad type: %d %s", rec.Code, rec.Body.String())
	}
	if rec := uploadBadge(t, f, h, "owner", bytes.Repeat([]byte{0}, service.MaxBadgeFileSize+10), badgeFields("Too big")); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("too large: %d %s", rec.Code, rec.Body.String())
	}

	// A source image beyond the decompression cap is rejected.
	if rec := uploadBadge(t, f, h, "owner", testPNG(t, 3000, 10), badgeFields("Huge")); rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized source: %d %s", rec.Code, rec.Body.String())
	}

	// Names are unique case-insensitively.
	if rec := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("Night Owl")); rec.Code != http.StatusCreated {
		t.Fatalf("first: %d %s", rec.Code, rec.Body.String())
	}
	if rec := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("night owl")); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate: %d %s", rec.Code, rec.Body.String())
	}
}

func TestBadgeDisplayedPin(t *testing.T) {
	f, h, _ := newBadgeFixture(t)
	first := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("First"))
	second := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("Second"))
	var b1, b2 models.Badge
	_ = json.Unmarshal(first.Body.Bytes(), &b1)
	_ = json.Unmarshal(second.Body.Bytes(), &b2)

	f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{b1.ID, b2.ID}})

	// Pin the older badge: it becomes the one shown next to the nickname.
	rec := f.do(t, "user", h.SetMyDisplayedBadge, http.MethodPut, nil,
		models.SetDisplayedBadgeRequest{BadgeID: b1.ID})
	if rec.Code != http.StatusOK {
		t.Fatalf("pin: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		UserID string             `json:"user_id"`
		Badges []models.UserBadge `json:"badges"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.UserID != "user" || len(out.Badges) != 2 {
		t.Fatalf("pin response = %+v", out)
	}
	displayed := 0
	for _, b := range out.Badges {
		if b.Displayed {
			displayed++
			if b.BadgeID != b1.ID {
				t.Fatalf("wrong badge pinned: %+v", b)
			}
		}
	}
	if displayed != 1 {
		t.Fatalf("expected exactly one displayed badge, got %d", displayed)
	}

	// The persisted assignments payload carries the flag too.
	rec = f.do(t, "user", h.GetAssignments, http.MethodGet, nil, nil)
	var payload struct {
		Assignments models.BadgeAssignments `json:"assignments"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	pinned := 0
	for _, b := range payload.Assignments["user"] {
		if b.Displayed {
			pinned++
		}
	}
	if pinned != 1 {
		t.Fatalf("assignments lost the pin: %+v", payload.Assignments)
	}

	// Clearing goes back to automatic (newest award).
	rec = f.do(t, "user", h.SetMyDisplayedBadge, http.MethodPut, nil,
		models.SetDisplayedBadgeRequest{BadgeID: ""})
	if rec.Code != http.StatusOK {
		t.Fatalf("clear: %d %s", rec.Code, rec.Body.String())
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	for _, b := range out.Badges {
		if b.Displayed {
			t.Fatalf("pin survived clearing: %+v", out.Badges)
		}
	}

	// A badge the caller doesn't hold can't be displayed.
	if rec := f.do(t, "guest", h.SetMyDisplayedBadge, http.MethodPut, nil,
		models.SetDisplayedBadgeRequest{BadgeID: b1.ID}); rec.Code != http.StatusBadRequest {
		t.Fatalf("pin of a badge not held: %d %s", rec.Code, rec.Body.String())
	}
}

func TestBadgeAdminSetKeepsAndDropsPin(t *testing.T) {
	f, h, _ := newBadgeFixture(t)
	first := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("First"))
	second := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("Second"))
	var b1, b2 models.Badge
	_ = json.Unmarshal(first.Body.Bytes(), &b1)
	_ = json.Unmarshal(second.Body.Bytes(), &b2)

	f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{b1.ID}})
	f.do(t, "user", h.SetMyDisplayedBadge, http.MethodPut, nil,
		models.SetDisplayedBadgeRequest{BadgeID: b1.ID})

	// Adding another badge keeps the pin on the first one.
	rec := f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{b1.ID, b2.ID}})
	var out struct {
		Badges []models.UserBadge `json:"badges"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	for _, b := range out.Badges {
		if b.BadgeID == b1.ID && !b.Displayed {
			t.Fatalf("pin lost when adding a badge: %+v", out.Badges)
		}
	}

	// Revoking the pinned badge drops the pin with it.
	rec = f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{b2.ID}})
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	for _, b := range out.Badges {
		if b.Displayed {
			t.Fatalf("revoked badge still pinned: %+v", out.Badges)
		}
	}
}

func TestBadgeUpdateDeleteAndReplaceImage(t *testing.T) {
	f, h, n := newBadgeFixture(t)
	created := uploadBadge(t, f, h, "owner", testPNG(t, 100, 100), badgeFields("Ship It"))
	var badge models.Badge
	_ = json.Unmarshal(created.Body.Bytes(), &badge)

	newName := "Shipped It"
	desc := "  shipped  "
	rec := f.do(t, "owner", h.UpdateBadge, http.MethodPatch, map[string]string{"id": badge.ID},
		models.UpdateBadgeRequest{Name: &newName, Description: &desc})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	var updated models.Badge
	_ = json.Unmarshal(rec.Body.Bytes(), &updated)
	if updated.Name != newName || updated.Description != "shipped" {
		t.Fatalf("updated = %+v", updated)
	}
	if n.library != 2 {
		t.Fatalf("expected broadcast after update, got %d", n.library)
	}

	// Replace the image: the version in the URL changes so caches refetch.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("image", "new.png")
	_, _ = fw.Write(testPNG(t, 200, 200))
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPut, "/", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, f.claims["owner"]))
	req = mux.SetURLVars(req, map[string]string{"id": badge.ID})
	rec = httptest.NewRecorder()
	h.ReplaceBadgeImage(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("replace: %d %s", rec.Code, rec.Body.String())
	}
	var replaced models.Badge
	_ = json.Unmarshal(rec.Body.Bytes(), &replaced)
	if replaced.ImageURL == badge.ImageURL {
		t.Fatalf("image url did not change: %s", replaced.ImageURL)
	}
	if img := f.do(t, "user", h.GetBadgeImage, http.MethodGet, map[string]string{"id": badge.ID}, nil); img.Code != http.StatusOK {
		t.Fatalf("image after replace: %d", img.Code)
	}

	// Award it, then delete: assignments go with it and the file is gone.
	f.do(t, "owner", h.SetUserBadges, http.MethodPut,
		map[string]string{"id": "user"}, models.SetUserBadgesRequest{BadgeIDs: []string{badge.ID}})
	if rec := f.do(t, "owner", h.DeleteBadge, http.MethodDelete, map[string]string{"id": badge.ID}, nil); rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	rec = f.do(t, "user", h.GetAssignments, http.MethodGet, nil, nil)
	var payload struct {
		Assignments models.BadgeAssignments `json:"assignments"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	if len(payload.Assignments["user"]) != 0 {
		t.Fatalf("assignments survived delete: %+v", payload.Assignments)
	}
	if img := f.do(t, "user", h.GetBadgeImage, http.MethodGet, map[string]string{"id": badge.ID}, nil); img.Code != http.StatusNotFound {
		t.Fatalf("image after delete: %d", img.Code)
	}
}
