package repository

import (
	"path/filepath"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

func TestTextPollDeadlines(t *testing.T) {
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	r := NewTextPollRepository(db)
	const room = "20261110145113MiTbtB"

	for _, d := range []chatstore.PollDeadline{
		{MessageID: "1763460000000000", RoomID: room, DueAtMS: 2000},
		{MessageID: "1763460000000001", RoomID: room, DueAtMS: 1000},
		{MessageID: "1763460000000002", RoomID: room, DueAtMS: 1500},
	} {
		if err := r.Add(d); err != nil {
			t.Fatal(err)
		}
	}
	// Re-adding replaces the due date instead of failing.
	if err := r.Add(chatstore.PollDeadline{MessageID: "1763460000000000", RoomID: room, DueAtMS: 3000}); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteByMessage("1763460000000002"); err != nil {
		t.Fatal(err)
	}
	due, err := r.TakeDue(2500)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0].MessageID != "1763460000000001" || due[0].RoomID != room {
		t.Fatalf("due = %+v", due)
	}
	if again, _ := r.TakeDue(2500); len(again) != 0 {
		t.Fatalf("deadline taken twice: %+v", again)
	}
	due, _ = r.TakeDue(5000)
	if len(due) != 1 || due[0].DueAtMS != 3000 {
		t.Fatalf("due = %+v", due)
	}
}
