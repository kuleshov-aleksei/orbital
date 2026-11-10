package chatstore

import (
	"fmt"
	"testing"
	"time"
)

func TestParseQuery(t *testing.T) {
	q := ParseQuery(`hello from:@alice from:"Bob Smith" in:#general during:2026-11 after:yesterday has:image pinned:true weird:key "exact phrase" https://x.io/a`)
	checks := map[string]string{
		"text":   q.Text,
		"from":   fmt.Sprint(q.From),
		"in":     fmt.Sprint(q.In),
		"during": fmt.Sprint(q.During),
		"after":  fmt.Sprint(q.After),
		"has":    fmt.Sprint(q.Has),
	}
	want := map[string]string{
		"text":   `hello weird:key "exact phrase" https://x.io/a`,
		"from":   "[alice Bob Smith]",
		"in":     "[general]",
		"during": "[2026-11]",
		"after":  "[yesterday]",
		"has":    "[image]",
	}
	for k, v := range want {
		if checks[k] != v {
			t.Errorf("%s = %q, want %q", k, checks[k], v)
		}
	}
	if q.Pinned == nil || !*q.Pinned {
		t.Error("pinned not parsed")
	}
	if empty := ParseQuery("from: "); empty.Text != "from:" || len(empty.From) != 0 {
		t.Errorf("empty value: %+v", empty)
	}
}

func TestTimeBounds(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Skip("no tzdata")
	}
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, loc)
	day := func(y int, m time.Month, d int) int64 { return time.Date(y, m, d, 0, 0, 0, 0, loc).UnixMilli() }

	from, to, hints := ParseQuery("during:2026-11-10").TimeBounds(loc, now)
	if from != day(2026, 11, 10) || to != day(2026, 11, 11) || hints != nil {
		t.Fatalf("during day: %d %d %v", from, to, hints)
	}
	from, to, _ = ParseQuery("during:2026-02").TimeBounds(loc, now)
	if from != day(2026, 2, 1) || to != day(2026, 3, 1) {
		t.Fatalf("during month: %d %d", from, to)
	}
	from, to, _ = ParseQuery("after:2026-11-01 before:2026-11-05").TimeBounds(loc, now)
	if from != day(2026, 11, 2) || to != day(2026, 11, 5) {
		t.Fatalf("after/before exclusive: %d %d", from, to)
	}
	from, to, _ = ParseQuery("during:today").TimeBounds(loc, now)
	if from != day(2026, 11, 10) || to != day(2026, 11, 11) {
		t.Fatalf("today: %d %d", from, to)
	}
	from, to, _ = ParseQuery("during:yesterday").TimeBounds(loc, now)
	if from != day(2026, 11, 9) || to != day(2026, 11, 10) {
		t.Fatalf("yesterday: %d %d", from, to)
	}
	_, _, hints = ParseQuery("during:soon").TimeBounds(loc, now)
	if len(hints) != 1 {
		t.Fatalf("bad date hints = %v", hints)
	}
}
