package repository

import (
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func newAuthSessionTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestAuthSessions(t *testing.T) {
	r := NewAuthSessionRepository(newAuthSessionTestDB(t))
	const alice, bob = "qkUrdzLDoqslx8EEy2cM7Q==", "Z9n-x_2LDoqslx8EEy2cM7Q="
	now := time.Now().UTC().Truncate(time.Millisecond)

	add := func(id, user string, active, expires time.Time) {
		t.Helper()
		if err := r.Create(&models.AuthSession{
			ID: id, UserID: user, CreatedAt: active, LastActiveAt: active, ExpiresAt: expires,
		}); err != nil {
			t.Fatal(err)
		}
	}
	add("sid-expired", alice, now.Add(-2*time.Hour), now.Add(-time.Hour))
	add("sid-a1", alice, now.Add(-time.Hour), now.Add(time.Hour))
	add("sid-a2", alice, now.Add(-2*time.Minute), now.Add(time.Hour)) // creating prunes sid-expired
	add("sid-b1", bob, now, now.Add(time.Hour))

	if s, _ := r.Get("sid-expired"); s != nil {
		t.Fatal("expired session was not pruned on create")
	}

	list, err := r.ListForUser(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "sid-a2" || list[1].ID != "sid-a1" {
		t.Fatalf("ListForUser = %+v, want [sid-a2 sid-a1]", list)
	}

	// A session without device info (QR-linked) is filled in at once.
	filled := now.Add(5 * time.Second)
	if err := r.Touch("sid-b1", filled, "Mozilla/5.0", "", "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	b1, _ := r.Get("sid-b1")
	if b1.UserAgent != "Mozilla/5.0" || b1.IP != "10.0.0.1" || !b1.LastActiveAt.Equal(filled) {
		t.Fatalf("touch did not fill empty device info: %+v", b1)
	}
	// Otherwise Touch is throttled within the interval.
	if err := r.Touch("sid-b1", now.Add(30*time.Second), "Other/1.0", "", "10.0.0.2"); err != nil {
		t.Fatal(err)
	}
	b1, _ = r.Get("sid-b1")
	if !b1.LastActiveAt.Equal(filled) || b1.UserAgent != "Mozilla/5.0" {
		t.Fatalf("throttled touch rewrote the session: %+v", b1)
	}
	later := now.Add(2 * time.Minute)
	if err := r.Touch("sid-b1", later, "", "", ""); err != nil {
		t.Fatal(err)
	}
	b1, _ = r.Get("sid-b1")
	if !b1.LastActiveAt.Equal(later) || b1.UserAgent != "Mozilla/5.0" {
		t.Fatalf("touch after interval = %+v, want last_active %v and kept user agent", b1, later)
	}

	// Delete is scoped to the owner.
	if ok, _ := r.Delete(bob, "sid-a1"); ok {
		t.Fatal("bob deleted alice's session")
	}
	if ok, _ := r.Delete(alice, "sid-a1"); !ok {
		t.Fatal("alice could not delete her session")
	}

	add("sid-a3", alice, now, now.Add(time.Hour))
	ids, err := r.DeleteOthers(alice, "sid-a3")
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(ids)
	if len(ids) != 1 || ids[0] != "sid-a2" {
		t.Fatalf("DeleteOthers removed %v, want [sid-a2]", ids)
	}
	if s, _ := r.Get("sid-a3"); s == nil {
		t.Fatal("DeleteOthers removed the kept session")
	}
	if s, _ := r.Get("sid-b1"); s == nil {
		t.Fatal("DeleteOthers touched another user's session")
	}
}

func TestPushDevicesBySession(t *testing.T) {
	r := NewPushDeviceRepository(newAuthSessionTestDB(t))
	const alice, bob = "qkUrdzLDoqslx8EEy2cM7Q==", "Z9n-x_2LDoqslx8EEy2cM7Q="
	for _, d := range []struct{ token, user, sid string }{
		{"tok-phone", alice, "sid-phone"},
		{"tok-tablet", alice, "sid-tablet"},
		{"tok-legacy", alice, ""},
		{"tok-bob", bob, "sid-phone"}, // same sid string, other user: untouched
	} {
		if err := r.Upsert(d.token, d.user, "android", d.sid); err != nil {
			t.Fatal(err)
		}
	}

	if err := r.DeleteForSessions(alice, []string{"sid-phone"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.TokensForUser(alice); len(got) != 2 {
		t.Fatalf("after DeleteForSessions alice has %v, want tablet+legacy", got)
	}
	if got, _ := r.TokensForUser(bob); len(got) != 1 {
		t.Fatalf("DeleteForSessions touched bob: %v", got)
	}

	if err := r.DeleteForUserExcept(alice, "sid-tablet"); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.TokensForUser(alice); len(got) != 1 || got[0] != "tok-tablet" {
		t.Fatalf("after DeleteForUserExcept alice has %v, want [tok-tablet]", got)
	}
}
