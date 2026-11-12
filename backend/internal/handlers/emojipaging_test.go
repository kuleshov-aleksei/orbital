package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// seedEmojis inserts n emoji rows directly (no image processing), one minute
// apart, and returns their ids in upload order.
func seedEmojis(t *testing.T, repo *repository.EmojiRepository, n int, name func(i int) (string, []string)) []string {
	t.Helper()
	base := time.Date(2026, 11, 10, 14, 51, 13, 0, time.UTC)
	ids := make([]string, n)
	for i := range n {
		ids[i] = fmt.Sprintf("%08x-6a47-4d0e-9a51-0f3e8c1d2a11", i+1)
		nm, aliases := name(i)
		if aliases == nil {
			aliases = []string{}
		}
		err := repo.Create(&models.CustomEmoji{
			ID: ids[i], Name: nm, Aliases: aliases, Filename: ids[i] + ".webp",
			UploadedBy: "qkUrdzLDoqslx8EEy2cM7Q==", CreatedAt: base.Add(time.Duration(i) * time.Minute),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return ids
}

func newPagingFixture(t *testing.T, maxCustom int) (*rbacFixture, *EmojiHandler, *service.EmojiService, *repository.EmojiRepository) {
	t.Helper()
	f := newRBACFixture(t)
	repo := repository.NewEmojiRepository(f.db)
	svc := service.NewEmojiService(repo, t.TempDir(), maxCustom)
	return f, NewEmojiHandler(svc, f.ps, nil), svc, repo
}

func getEmojiJSON(t *testing.T, f *rbacFixture, h *EmojiHandler, query string, out any) int {
	t.Helper()
	rec := f.doQuery(t, h.ListEmojis, nil, query)
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("decode %q: %v (%s)", query, err, rec.Body.String())
		}
	}
	return rec.Code
}

func TestEmojiPagingWithCursor(t *testing.T) {
	f, h, svc, repo := newPagingFixture(t, 0)
	ids := seedEmojis(t, repo, 5, func(i int) (string, []string) { return fmt.Sprintf("Emoji %d", i), nil })

	var page emojiPageResponse
	if code := getEmojiJSON(t, f, h, "limit=2", &page); code != http.StatusOK {
		t.Fatalf("page 1: %d", code)
	}
	if len(page.Emojis) != 2 || page.Emojis[0].ID != ids[0] || page.Total != 5 || page.Max != service.DefaultMaxCustomEmojis || page.NextCursor == "" {
		t.Fatalf("page 1 = %+v", page)
	}
	if page.Emojis[0].ImageURL == "" {
		t.Fatal("paged emojis need image_url")
	}

	// Deleting an emoji already seen must not shift the next page.
	if err := svc.Delete(ids[0]); err != nil {
		t.Fatal(err)
	}
	cursor := page.NextCursor
	page = emojiPageResponse{}
	getEmojiJSON(t, f, h, "limit=2&cursor="+cursor, &page)
	if len(page.Emojis) != 2 || page.Emojis[0].ID != ids[2] || page.Emojis[1].ID != ids[3] || page.Total != 4 {
		t.Fatalf("page 2 = %+v", page)
	}
	page2Cursor := page.NextCursor
	page = emojiPageResponse{}
	getEmojiJSON(t, f, h, "limit=2&cursor="+page2Cursor, &page)
	if len(page.Emojis) != 1 || page.Emojis[0].ID != ids[4] || page.NextCursor != "" {
		t.Fatalf("last page = %+v", page)
	}

	if code := getEmojiJSON(t, f, h, "limit=2&cursor=not-a-cursor", &page); code != http.StatusBadRequest {
		t.Fatalf("bad cursor: %d, want 400", code)
	}
	if code := getEmojiJSON(t, f, h, "limit=abc", &page); code != http.StatusBadRequest {
		t.Fatalf("bad limit: %d, want 400", code)
	}
}

func TestEmojiPageLimitIsClamped(t *testing.T) {
	f, h, _, repo := newPagingFixture(t, 0)
	seedEmojis(t, repo, service.MaxEmojiPageSize+5, func(i int) (string, []string) { return fmt.Sprintf("Emoji %d", i), nil })

	var page emojiPageResponse
	getEmojiJSON(t, f, h, "limit=100000", &page)
	if len(page.Emojis) != service.MaxEmojiPageSize || page.NextCursor == "" {
		t.Fatalf("got %d emojis, want %d with a next cursor", len(page.Emojis), service.MaxEmojiPageSize)
	}
}

// Older clients call GET /api/emojis without parameters and expect an array.
func TestEmojiListLegacyArray(t *testing.T) {
	f, h, _, repo := newPagingFixture(t, 0)
	ids := seedEmojis(t, repo, 3, func(i int) (string, []string) { return fmt.Sprintf("Emoji %d", i), nil })

	var list []models.CustomEmoji
	if code := getEmojiJSON(t, f, h, "", &list); code != http.StatusOK {
		t.Fatalf("legacy list: %d", code)
	}
	if len(list) != 3 || list[0].ID != ids[0] || list[2].ID != ids[2] {
		t.Fatalf("legacy list = %+v", list)
	}
}

func TestEmojiSearch(t *testing.T) {
	f, h, _, repo := newPagingFixture(t, 0)
	names := []struct {
		name    string
		aliases []string
	}{
		{"Parrot Party", nil},
		{"Party Parrot", []string{"birb"}},
		{"Sad Cat", []string{"crying"}},
		{"Partygoer", nil},
	}
	ids := seedEmojis(t, repo, len(names), func(i int) (string, []string) { return names[i].name, names[i].aliases })

	var page emojiPageResponse
	getEmojiJSON(t, f, h, "limit=10&q=party", &page)
	// Exact word matches (score 3) rank before the prefix match "partygoer".
	if len(page.Emojis) != 3 || page.Emojis[0].ID != ids[0] || page.Emojis[1].ID != ids[1] || page.Emojis[2].ID != ids[3] {
		t.Fatalf("q=party = %+v", page.Emojis)
	}
	if page.Total != 4 {
		t.Fatalf("total = %d, want library size 4", page.Total)
	}

	page = emojiPageResponse{}
	getEmojiJSON(t, f, h, "limit=10&q=BIRB%20par", &page)
	if len(page.Emojis) != 1 || page.Emojis[0].ID != ids[1] {
		t.Fatalf("alias search = %+v", page.Emojis)
	}

	// Search pages with its own cursor.
	page = emojiPageResponse{}
	getEmojiJSON(t, f, h, "limit=2&q=party", &page)
	if len(page.Emojis) != 2 || page.NextCursor == "" {
		t.Fatalf("search page 1 = %+v", page)
	}
	cursor := page.NextCursor
	page = emojiPageResponse{}
	getEmojiJSON(t, f, h, "limit=2&q=party&cursor="+cursor, &page)
	if len(page.Emojis) != 1 || page.Emojis[0].ID != ids[3] || page.NextCursor != "" {
		t.Fatalf("search page 2 = %+v", page)
	}
}

func TestEmojiLookupByIDsAndShortcodes(t *testing.T) {
	f, h, _, repo := newPagingFixture(t, 0)
	names := []struct {
		name    string
		aliases []string
	}{
		{"Cat", []string{"kitty"}},
		{"Kitty", []string{"cat"}},
		{"Party Parrot!", nil},
	}
	ids := seedEmojis(t, repo, len(names), func(i int) (string, []string) { return names[i].name, names[i].aliases })

	var byID emojiLookupResponse
	getEmojiJSON(t, f, h, "ids="+ids[2]+",eeeeeeee-0000-4000-8000-000000000000,"+ids[2], &byID)
	if len(byID.Emojis) != 1 || byID.Emojis[0].ID != ids[2] {
		t.Fatalf("ids lookup = %+v", byID)
	}

	var byCode emojiLookupResponse
	getEmojiJSON(t, f, h, "shortcodes=cat,kitty,party_parrot,missing", &byCode)
	want := map[string]string{"cat": ids[0], "kitty": ids[1], "party_parrot": ids[2]}
	if len(byCode.Shortcodes) != len(want) {
		t.Fatalf("shortcodes = %v, want %v", byCode.Shortcodes, want)
	}
	for code, id := range want {
		if byCode.Shortcodes[code] != id {
			t.Fatalf("%s -> %s, want %s (names beat aliases)", code, byCode.Shortcodes[code], id)
		}
	}
	if len(byCode.Emojis) != 3 {
		t.Fatalf("shortcode emojis = %d, want 3", len(byCode.Emojis))
	}

	tooMany := strings.Repeat("a,", 101)
	if code := getEmojiJSON(t, f, h, "ids="+tooMany, &byID); code != http.StatusBadRequest {
		t.Fatalf("101 ids: %d, want 400", code)
	}
}

// Emojis without aliases must serialize "aliases": [], never null: the
// frontend iterates it directly.
func TestEmojiAliasesNeverNull(t *testing.T) {
	f, h, _, repo := newPagingFixture(t, 0)
	ids := seedEmojis(t, repo, 1, func(int) (string, []string) { return "Plain", nil })
	for _, q := range []string{"", "limit=10", "limit=10&q=plain", "ids=" + ids[0], "shortcodes=plain"} {
		rec := f.doQuery(t, h.ListEmojis, nil, q)
		if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"aliases":null`) || !strings.Contains(rec.Body.String(), `"aliases":[]`) {
			t.Fatalf("%q: %d %s", q, rec.Code, rec.Body.String())
		}
	}
}

func TestEmojiLibraryCapFromConfig(t *testing.T) {
	f, h, _, _ := newPagingFixture(t, 2)
	for i := range 2 {
		fields := map[string]string{"name": fmt.Sprintf("Emoji %d", i)}
		if rec := uploadEmoji(t, f, h, "owner", testPNG(t, 32, 32), fields); rec.Code != http.StatusCreated {
			t.Fatalf("upload %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}
	rec := uploadEmoji(t, f, h, "owner", testPNG(t, 32, 32), map[string]string{"name": "One too many"})
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "2 emojis max") {
		t.Fatalf("over the cap: %d %q, want 409 mentioning the max", rec.Code, rec.Body.String())
	}

	var page emojiPageResponse
	getEmojiJSON(t, f, h, "limit=10", &page)
	if page.Total != 2 || page.Max != 2 {
		t.Fatalf("total/max = %d/%d, want 2/2", page.Total, page.Max)
	}
}
