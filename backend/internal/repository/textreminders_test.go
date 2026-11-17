package repository

import (
	"path/filepath"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func TestTextReminders(t *testing.T) {
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	r := NewTextReminderRepository(db)
	const alice, bob, room = "qkUrdzLDoqslx8EEy2cM7Q==", "Z9n-x_2LDoqslx8EEy2cM7Q=", "20261110145113MiTbtB"

	for _, rem := range []chatstore.Reminder{
		{UserID: alice, RoomID: room, MessageID: "1763460000000000", DueAtMS: 2000, TZ: "Europe/Berlin", Note: "later"},
		{UserID: alice, RoomID: room, MessageID: "1763460000000001", DueAtMS: 1000, TZ: "UTC"},
		{UserID: bob, RoomID: room, MessageID: "1763460000000002", DueAtMS: 1500, TZ: "UTC"},
	} {
		if err := r.Add(rem); err != nil {
			t.Fatal(err)
		}
	}
	if n, _ := r.CountPending(alice); n != 2 {
		t.Fatalf("alice pending = %d", n)
	}
	if err := r.DeleteByMessage("1763460000000002"); err != nil {
		t.Fatal(err)
	}
	due, err := r.TakeDue(1500)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0].MessageID != "1763460000000001" || due[0].UserID != alice {
		t.Fatalf("due = %+v", due)
	}
	if again, _ := r.TakeDue(1500); len(again) != 0 {
		t.Fatalf("reminder fired twice: %+v", again)
	}
	due, _ = r.TakeDue(5000)
	if len(due) != 1 || due[0].Note != "later" || due[0].TZ != "Europe/Berlin" || due[0].DueAtMS != 2000 {
		t.Fatalf("due = %+v", due)
	}
	if n, _ := r.CountPending(alice); n != 0 {
		t.Fatalf("alice pending after firing = %d", n)
	}
}
