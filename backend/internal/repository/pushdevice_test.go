package repository

import (
	"path/filepath"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func TestPushDevices(t *testing.T) {
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	r := NewPushDeviceRepository(db)
	const alice, bob = "qkUrdzLDoqslx8EEy2cM7Q==", "Z9n-x_2LDoqslx8EEy2cM7Q="

	if err := r.Upsert("tok-1", alice, "android"); err != nil {
		t.Fatal(err)
	}
	if err := r.Upsert("tok-1", alice, "android"); err != nil { // repeat registration
		t.Fatal(err)
	}
	if toks, _ := r.TokensForUser(alice); len(toks) != 1 {
		t.Fatalf("alice tokens = %v", toks)
	}
	// The device switches accounts: the token moves to bob.
	if err := r.Upsert("tok-1", bob, "android"); err != nil {
		t.Fatal(err)
	}
	if toks, _ := r.TokensForUser(alice); len(toks) != 0 {
		t.Fatalf("token kept by alice: %v", toks)
	}
	// Alice can't unregister bob's device.
	_ = r.DeleteForUser(alice, "tok-1")
	if toks, _ := r.TokensForUser(bob); len(toks) != 1 {
		t.Fatalf("bob tokens = %v", toks)
	}
	_ = r.DeleteForUser(bob, "tok-1")
	if toks, _ := r.TokensForUser(bob); len(toks) != 0 {
		t.Fatalf("bob tokens after logout = %v", toks)
	}
}
