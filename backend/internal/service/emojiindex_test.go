package service

import (
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// Must match emojiShortcode in frontend/src/services/emoji/inlineText.ts.
func TestEmojiShortcode(t *testing.T) {
	cases := map[string]string{
		"Party Parrot!":    "party_parrot",
		"  --Hello--  ":    "hello",
		"Котик Привет":     "котик_привет",
		"a__b  c":          "a_b_c",
		"v2 Beta":          "v2_beta",
		"!!!":              "emoji",
		"":                 "emoji",
		"ÉCOLE":            "école",
		"emoji_with_under": "emoji_with_under",
	}
	for in, want := range cases {
		if got := EmojiShortcode(in); got != want {
			t.Errorf("EmojiShortcode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestEmojiSearchScore(t *testing.T) {
	e := &models.CustomEmoji{Name: "Party Parrot", Aliases: []string{"birb"}}
	cases := []struct {
		q    []string
		want int
	}{
		{[]string{"parrot"}, 3},         // exact name word
		{[]string{"par"}, 2},            // prefix
		{[]string{"rrot"}, 1},           // substring
		{[]string{"birb", "party"}, 6},  // alias + name word
		{[]string{"party", "cat"}, 0},   // every word must match
		{[]string{"party parrot"}, 3},   // whole lowercased name
	}
	for _, c := range cases {
		if got := emojiSearchScore(e, c.q); got != c.want {
			t.Errorf("score(%v) = %d, want %d", c.q, got, c.want)
		}
	}
}

func TestEmojiIndexShortcodePrecedence(t *testing.T) {
	base := time.Date(2026, 11, 10, 14, 51, 13, 0, time.UTC)
	older := &models.CustomEmoji{ID: "0b6f3a52-6a47-4d0e-9a51-0f3e8c1d2a11", Name: "Cat", Aliases: []string{"kitty"}, CreatedAt: base}
	newer := &models.CustomEmoji{ID: "7c1e9f04-2b3d-4c5a-8e6f-1a2b3c4d5e6f", Name: "Kitty", Aliases: []string{"cat"}, CreatedAt: base.Add(time.Minute)}
	twin := &models.CustomEmoji{ID: "f2d4b6a8-1c3e-4f5a-9b7d-2e4f6a8b0c1d", Name: "Kitty", CreatedAt: base.Add(2 * time.Minute)}
	idx := buildEmojiIndex([]*models.CustomEmoji{twin, newer, older})

	if idx.list[0] != older || idx.list[2] != twin {
		t.Fatal("index must be in upload order")
	}
	// A name beats an older emoji's alias; among equal names the oldest wins.
	if got := idx.byShortcode["cat"]; got != older {
		t.Fatalf("cat -> %s, want the emoji named Cat", got.ID)
	}
	if got := idx.byShortcode["kitty"]; got != newer {
		t.Fatalf("kitty -> %s, want the oldest emoji named Kitty", got.ID)
	}
}
