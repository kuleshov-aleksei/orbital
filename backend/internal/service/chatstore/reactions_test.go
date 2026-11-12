package chatstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestToggleReaction(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, "r", "alice", "hi")
	steps := []struct {
		user, emoji, want string
	}{
		{"bob", "👍", "[{👍 [bob]}]"},
		{"carol", "👍", "[{👍 [bob carol]}]"},
		{"bob", "custom:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d", "[{👍 [bob carol]} {custom:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d [bob]}]"},
		{"bob", "👍", "[{👍 [carol]} {custom:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d [bob]}]"},
		{"carol", "👍", "[{custom:0b6e6c1e-8a0f-4f3e-9b9a-2b1f6f2e3c4d [bob]}]"},
	}
	for _, st := range steps {
		got, err := s.ToggleReaction(ctx, m.ID, st.user, st.emoji)
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprint(got.Reactions) != st.want {
			t.Fatalf("after %s %s: %v, want %s", st.user, st.emoji, got.Reactions, st.want)
		}
	}
	stored, _ := s.Get(ctx, m.ID)
	if len(stored.Reactions) != 1 {
		t.Fatalf("stored reactions = %v", stored.Reactions)
	}
}

func TestReactionValidationAndLimit(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, "r", "alice", "hi")
	for _, bad := range []string{"", "abc", "👍 👍", "custom:nope", "<script>", strings.Repeat("👍", 20)} {
		if _, err := s.ToggleReaction(ctx, m.ID, "bob", bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("emoji %q: err = %v", bad, err)
		}
	}
	for _, ok := range []string{"🇷🇺", "1️⃣", "👍🏽", "👨‍👩‍👧", "❤️"} {
		if !ValidReactionEmoji(ok) {
			t.Fatalf("%q rejected", ok)
		}
	}
	for i := 0; i < MaxReactionEmojis; i++ {
		emoji := fmt.Sprintf("custom:%08d-0000-0000-0000-000000000000", i)
		if _, err := s.ToggleReaction(ctx, m.ID, "bob", emoji); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.ToggleReaction(ctx, m.ID, "bob", "👍"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("21st emoji: %v", err)
	}
	// Adding a user to an existing emoji still works at the limit.
	if _, err := s.ToggleReaction(ctx, m.ID, "carol", "custom:00000000-0000-0000-0000-000000000000"); err != nil {
		t.Fatal(err)
	}
}

func TestReactionsAndEditsDoNotClobber(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, "r", "alice", "v0")
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			if _, err := s.ToggleReaction(ctx, m.ID, fmt.Sprintf("u%d", i), "👍"); err != nil {
				t.Error(err)
			}
		}(i)
		go func(i int) {
			defer wg.Done()
			if _, err := s.Edit(ctx, m.ID, "alice", fmt.Sprintf("v%d", i+1)); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	got, _ := s.Get(ctx, m.ID)
	if len(got.Reactions) != 1 || len(got.Reactions[0].UserIDs) != 10 || got.EditedAtTS == nil {
		t.Fatalf("got %+v", got)
	}
}

func TestPins(t *testing.T) {
	s, _, clock := newTestService(t)
	ctx := context.Background()
	var msgs []*Message
	for i := 0; i < MaxPins+1; i++ {
		msgs = append(msgs, mustCreate(t, s, "r", "alice", fmt.Sprintf("m%d", i)))
	}
	for i := 0; i < MaxPins; i++ {
		clock.Advance(time.Millisecond)
		got, changed, err := s.SetPinned(ctx, msgs[i].ID, "mod", true)
		if err != nil || !changed || !got.Pinned || *got.PinnedBy != "mod" {
			t.Fatalf("pin %d: %+v %v %v", i, got, changed, err)
		}
	}
	if _, changed, err := s.SetPinned(ctx, msgs[0].ID, "mod", true); err != nil || changed {
		t.Fatalf("re-pin: changed=%v err=%v", changed, err)
	}
	if _, _, err := s.SetPinned(ctx, msgs[MaxPins].ID, "mod", true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("51st pin: %v", err)
	}
	pins, err := s.Pins(ctx, "r")
	if err != nil || len(pins) != MaxPins || pins[0].ID != msgs[MaxPins-1].ID {
		t.Fatalf("pins = %d, first %v, %v", len(pins), pins[0].Content, err)
	}
	// Unpinning and deleting both free a slot.
	if _, changed, err := s.SetPinned(ctx, msgs[1].ID, "mod", false); err != nil || !changed {
		t.Fatal(err)
	}
	if _, err := s.Delete(ctx, msgs[2].ID, "alice", nil); err != nil {
		t.Fatal(err)
	}
	pins, _ = s.Pins(ctx, "r")
	if len(pins) != MaxPins-2 {
		t.Fatalf("after unpin+delete: %d pins", len(pins))
	}
	for _, p := range pins {
		if p.ID == msgs[2].ID {
			t.Fatal("deleted message listed in pins")
		}
	}
	if _, _, err := s.SetPinned(ctx, msgs[2].ID, "mod", true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pin deleted: %v", err)
	}
}

func TestPinsSeePendingWrites(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	m := mustCreate(t, s, "r", "alice", "hi")
	eng.Hold()
	if _, _, err := s.SetPinned(ctx, m.ID, "mod", true); err != nil {
		t.Fatal(err)
	}
	pins, _ := s.Pins(ctx, "r")
	if len(pins) != 1 {
		t.Fatalf("pending pin not visible: %d", len(pins))
	}
	eng.Release()
}
