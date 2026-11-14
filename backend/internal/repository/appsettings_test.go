package repository

import (
	"path/filepath"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func TestAppSettings(t *testing.T) {
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	r := NewAppSettingsRepository(db)

	if v, err := r.Get("android_min_version"); err != nil || v != "" {
		t.Fatalf("unset = %q, %v", v, err)
	}
	for _, want := range []string{"1.5.0", "1.6.0"} {
		if err := r.Set("android_min_version", want); err != nil {
			t.Fatal(err)
		}
		if v, _ := r.Get("android_min_version"); v != want {
			t.Fatalf("got %q, want %q", v, want)
		}
	}
	if err := r.Set("android_min_version", ""); err != nil {
		t.Fatal(err)
	}
	if v, _ := r.Get("android_min_version"); v != "" {
		t.Fatalf("cleared = %q", v)
	}
}
