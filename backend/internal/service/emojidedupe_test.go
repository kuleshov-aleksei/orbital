package service

import (
	"testing"
	"time"
	"unicode/utf8"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func newEmojiTestService(t *testing.T) (*EmojiService, *repository.EmojiRepository) {
	t.Helper()
	db, err := storage.NewDB(":memory:")
	if err != nil {
		t.Fatalf("failed to create in-memory db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}
	repo := repository.NewEmojiRepository(db)
	return NewEmojiService(repo, t.TempDir(), 0), repo
}

func TestEmojiDedupeNames(t *testing.T) {
	svc, repo := newEmojiTestService(t)
	base := time.Date(2026, 11, 10, 14, 51, 13, 0, time.UTC)
	long := "Extremely Long Emoji Name Here!!" // 32 runes, the maximum
	rows := []struct{ id, name string }{
		{"0b6f3a52-6a47-4d0e-9a51-0f3e8c1d2a11", "Party Parrot"},
		{"7c1e9f04-2b3d-4c5a-8e6f-1a2b3c4d5e6f", "party-parrot"},
		{"3f2a1b0c-9d8e-4f7a-b6c5-d4e3f2a1b0c9", "PARTY PARROT"},
		// Newer than the duplicates, but already owns party_parrot_01.
		{"9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4", "party parrot_01"},
		{"5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d", long},
		{"6b5c4d3e-2f1a-4b0c-9d8e-7f6a5b4c3d2e", long},
	}
	for i, r := range rows {
		err := repo.Create(&models.CustomEmoji{
			ID: r.id, Name: r.name, Aliases: []string{}, Filename: r.id + ".webp",
			CreatedAt: base.Add(time.Duration(i) * time.Minute),
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	n, err := svc.DedupeNames()
	if err != nil || n != 3 {
		t.Fatalf("DedupeNames = %d, %v; want 3 renamed", n, err)
	}
	want := map[string]string{
		rows[0].id: "Party Parrot",
		rows[1].id: "party-parrot_02",
		rows[2].id: "PARTY PARROT_03",
		rows[3].id: "party parrot_01",
		rows[4].id: long,
		rows[5].id: "Extremely Long Emoji Name Her_01",
	}
	seen := map[string]bool{}
	for id, name := range want {
		e, err := repo.GetByID(id)
		if err != nil || e == nil {
			t.Fatalf("get %s: %v", id, err)
		}
		if e.Name != name {
			t.Errorf("%s: name %q, want %q", id, e.Name, name)
		}
		if utf8.RuneCountInString(e.Name) > MaxSoundboardNameRunes {
			t.Errorf("%s: name %q too long", id, e.Name)
		}
		code := EmojiShortcode(e.Name)
		if seen[code] {
			t.Errorf("shortcode %q still duplicated", code)
		}
		seen[code] = true
	}

	if n, err := svc.DedupeNames(); err != nil || n != 0 {
		t.Fatalf("second run = %d, %v; want 0", n, err)
	}
}

func TestEmojiNameUniqueness(t *testing.T) {
	svc, repo := newEmojiTestService(t)
	for _, e := range []*models.CustomEmoji{
		{ID: "0b6f3a52-6a47-4d0e-9a51-0f3e8c1d2a11", Name: "Cat"},
		{ID: "7c1e9f04-2b3d-4c5a-8e6f-1a2b3c4d5e6f", Name: "Dog", Aliases: []string{"cat dog"}},
	} {
		e.Filename = e.ID + ".webp"
		e.CreatedAt = time.Now()
		if err := repo.Create(e); err != nil {
			t.Fatal(err)
		}
	}
	// Rejected before the image is looked at.
	if _, err := svc.Create("qkUrdzLDoqslx8EEy2cM7Q==", []byte("x"), "cat!", nil); err != ErrEmojiNameTaken {
		t.Fatalf("create duplicate: %v, want ErrEmojiNameTaken", err)
	}
	rename := func(id, name string) error {
		_, err := svc.Update(id, models.UpdateCustomEmojiRequest{Name: &name})
		return err
	}
	if err := rename("7c1e9f04-2b3d-4c5a-8e6f-1a2b3c4d5e6f", "CAT"); err != ErrEmojiNameTaken {
		t.Fatalf("rename onto another emoji: %v, want ErrEmojiNameTaken", err)
	}
	if err := rename("0b6f3a52-6a47-4d0e-9a51-0f3e8c1d2a11", "cat"); err != nil {
		t.Fatalf("rename to own name variant: %v", err)
	}
	// Aliases don't block names (name shortcodes win over aliases).
	if err := rename("0b6f3a52-6a47-4d0e-9a51-0f3e8c1d2a11", "cat dog"); err != nil {
		t.Fatalf("rename onto an alias: %v", err)
	}
}
