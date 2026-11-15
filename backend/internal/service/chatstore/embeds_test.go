package chatstore

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

const (
	embedRoom   = "20261110145113MiTbtB"
	embedAuthor = "qkUrdzLDoqslx8EEy2cM7Q=="
	embedOther  = "Zm9vYmFyYmF6cXV4MTIzNA=="
)

func TestPreviewURLs(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"look https://example.com/a.", []string{"https://example.com/a"}},
		{"(https://example.com/x) and HTTP://Example.org", []string{"https://example.com/x", "HTTP://Example.org"}},
		{"<https://example.com> no preview", nil},
		{"||https://secret.example|| hidden", nil},
		{"**https://bold.example**", []string{"https://bold.example"}},
		{"dup https://a.example https://a.example", []string{"https://a.example"}},
		{"xhttps://glued.example", nil},
		{"https://1.example https://2.example https://3.example https://4.example",
			[]string{"https://1.example", "https://2.example", "https://3.example"}},
		{"ссылка https://пример.рф/путь, дальше", []string{"https://пример.рф/путь"}},
		{"<https://a.example> but https://b.example", []string{"https://b.example"}},
		{"<https://a.example/.>", nil},
	}
	for _, c := range cases {
		if got := PreviewURLs(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("PreviewURLs(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSetEmbedsDropsStaleResult(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, embedRoom, embedAuthor, "see https://a.example")
	embed := Embed{URL: "https://a.example", Kind: EmbedLink, Title: "A"}

	// Edited while the preview was fetched: the result is dropped.
	if _, err := s.Edit(ctx, m.ID, embedAuthor, "see https://b.example"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetEmbeds(ctx, m.ID, m.Content, []Embed{embed}); !errors.Is(err, ErrStale) {
		t.Fatalf("stale SetEmbeds err = %v, want ErrStale", err)
	}

	cur, _ := s.Get(ctx, m.ID)
	got, err := s.SetEmbeds(ctx, m.ID, cur.Content, []Embed{{URL: "https://b.example", Kind: EmbedLink, Title: "B"}})
	if err != nil || len(got.Embeds) != 1 || got.Public().Embeds[0].Title != "B" {
		t.Fatalf("SetEmbeds = %+v, %v", got, err)
	}
	if !EmbedsCurrent(got, PreviewURLs(got.Content)) {
		t.Fatal("embeds should be current")
	}
}

func TestEditKeepsOnlyEmbedsOfRemainingLinks(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, embedRoom, embedAuthor, "https://a.example https://b.example")
	if _, err := s.SetEmbeds(ctx, m.ID, m.Content, []Embed{
		{URL: "https://a.example", Kind: EmbedLink}, {URL: "https://b.example", Kind: EmbedLink},
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Edit(ctx, m.ID, embedAuthor, "only https://b.example now")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Embeds) != 1 || got.Embeds[0].URL != "https://b.example" {
		t.Fatalf("embeds after edit = %+v", got.Embeds)
	}
}

func TestSuppressEmbeds(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, embedRoom, embedAuthor, "https://a.example")
	if _, err := s.SetEmbeds(ctx, m.ID, m.Content, []Embed{{URL: "https://a.example", Kind: EmbedLink}}); err != nil {
		t.Fatal(err)
	}

	deny := func(string) bool { return false }
	if _, err := s.SuppressEmbeds(ctx, m.ID, embedOther, deny); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-author without ManageMessages: err = %v, want ErrForbidden", err)
	}
	if _, err := s.SuppressEmbeds(ctx, m.ID, embedOther, func(room string) bool { return room == embedRoom }); err != nil {
		t.Fatalf("moderator: %v", err)
	}
	cur, _ := s.Get(ctx, m.ID)
	if !cur.EmbedsSuppressed || len(cur.Embeds) != 0 || !cur.Public().EmbedsSuppressed {
		t.Fatalf("after suppress: %+v", cur)
	}
	// No new previews once removed.
	if _, err := s.SetEmbeds(ctx, m.ID, cur.Content, []Embed{{URL: "https://a.example"}}); !errors.Is(err, ErrStale) {
		t.Fatalf("SetEmbeds after suppress err = %v, want ErrStale", err)
	}
	if !EmbedsCurrent(cur, PreviewURLs(cur.Content)) {
		t.Fatal("suppressed messages need no previews")
	}
}
