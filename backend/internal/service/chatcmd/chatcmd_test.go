package chatcmd

import (
	"reflect"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Skipf("no tzdata for %s: %v", name, err)
	}
	return loc
}

func TestParse(t *testing.T) {
	cases := []struct {
		in   string
		name string
		args string
		ok   bool
	}{
		{"/random", "random", "", true},
		{"  /RANDOM 1 6 ", "random", "1 6", true},
		{"/d20", "d20", "", true},
		{"/vrandom a b", "vrandom", "a b", true},
		{"/remindme 2h buy milk", "remindme", "2h buy milk", true},
		{"/shrug", "", "", false},
		{"/", "", "", false},
		{"/usr/bin/env", "", "", false},
		{"hello /random", "", "", false},
	}
	for _, c := range cases {
		inv, ok := Parse(c.in)
		if ok != c.ok {
			t.Fatalf("Parse(%q) ok=%v, want %v", c.in, ok, c.ok)
		}
		if ok && (inv.Name != c.name || inv.Args != c.args) {
			t.Fatalf("Parse(%q) = %+v", c.in, inv)
		}
	}
}

func run(t *testing.T, content string) *chatstore.Command {
	t.Helper()
	inv, ok := Parse(content)
	if !ok {
		t.Fatalf("not a command: %q", content)
	}
	cmd, _, err := Execute(inv, time.Now(), "")
	if err != nil {
		t.Fatalf("Execute(%q): %v", content, err)
	}
	return cmd
}

func TestRandomRanges(t *testing.T) {
	cases := []struct {
		in     string
		lo, hi int64
	}{
		{"/random", 1, 100},
		{"/random 6", 1, 6},
		{"/random 5 10", 5, 10},
		{"/random 10 5", 5, 10},
		{"/random -3 3", -3, 3},
		{"/vrandom 4", 1, 4},
	}
	for _, c := range cases {
		seen := map[int64]bool{}
		for i := 0; i < 400; i++ {
			cmd := run(t, c.in)
			if *cmd.Min != c.lo || *cmd.Max != c.hi {
				t.Fatalf("%q range = %d..%d", c.in, *cmd.Min, *cmd.Max)
			}
			v := *cmd.Result
			if v < c.lo || v > c.hi {
				t.Fatalf("%q result %d out of range", c.in, v)
			}
			seen[v] = true
		}
		if c.hi-c.lo < 10 && int64(len(seen)) != c.hi-c.lo+1 {
			t.Fatalf("%q: only saw %v", c.in, seen)
		}
	}
}

func TestRandomOptions(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"/random pizza sushi tacos", []string{"pizza", "sushi", "tacos"}},
		{"/random pizza place, sushi bar", []string{"pizza place", "sushi bar"}},
		{`/random "pizza place" sushi`, []string{"pizza place", "sushi"}},
		{`/random "a, b", c`, []string{"a, b", "c"}},
		{"/random 1 2 3", []string{"1", "2", "3"}},
	}
	for _, c := range cases {
		cmd := run(t, c.in)
		if !reflect.DeepEqual(cmd.Options, c.want) {
			t.Fatalf("%q options = %q, want %q", c.in, cmd.Options, c.want)
		}
		if cmd.ResultIndex == nil || *cmd.ResultIndex < 0 || *cmd.ResultIndex >= len(c.want) {
			t.Fatalf("%q bad index %v", c.in, cmd.ResultIndex)
		}
	}
}

func TestUsageErrors(t *testing.T) {
	for _, in := range []string{
		"/random onlyone",
		"/random 5 5",
		`/random "unclosed b`,
		"/vrandom 1 100",
		"/d20 extra",
		"/remindme",
		"/remindme tomorrow",
		"/remindme 31.02 10:00",
		"/remindme 2y",
		"/remindme 25:00",
	} {
		inv, ok := Parse(in)
		if !ok {
			t.Fatalf("not a command: %q", in)
		}
		if _, _, err := Execute(inv, time.Now(), "Europe/Berlin"); !IsUsage(err) {
			t.Fatalf("Execute(%q) err = %v, want usage error", in, err)
		}
	}
	opts := "/vrandom"
	for i := 0; i < MaxWheelSegments+1; i++ {
		opts += " x"
	}
	inv, _ := Parse(opts)
	if _, _, err := Execute(inv, time.Now(), ""); !IsUsage(err) {
		t.Fatalf("25-segment wheel accepted")
	}
}

func TestD20Labels(t *testing.T) {
	seen := map[int64]string{}
	for i := 0; i < 2000; i++ {
		cmd := run(t, "/d20")
		v := *cmd.Result
		if v < 1 || v > 20 {
			t.Fatalf("d20 = %d", v)
		}
		want := ""
		switch v {
		case 1:
			want = chatstore.LabelCriticalFailure
		case 20:
			want = chatstore.LabelCriticalSuccess
		}
		if cmd.Label != want {
			t.Fatalf("d20 %d label %q", v, cmd.Label)
		}
		seen[v] = cmd.Label
	}
	if len(seen) != 20 {
		t.Fatalf("saw only %d faces", len(seen))
	}
}

func TestRemindTimes(t *testing.T) {
	berlin := mustLoc(t, "Europe/Berlin")
	// Wed 18 Nov 2026, 10:30 Berlin (09:30 UTC).
	now := time.Date(2026, 11, 18, 10, 30, 0, 0, berlin)
	cases := []struct {
		args string
		want time.Time
		note string
	}{
		{"2h", now.Add(2 * time.Hour), ""},
		{"30min stretch", now.Add(30 * time.Minute), "stretch"},
		{"2d6h renew the cert", time.Date(2026, 11, 20, 16, 30, 0, 0, berlin), "renew the cert"},
		{"2m", time.Date(2027, 1, 18, 10, 30, 0, 0, berlin), ""},
		{"1mo", time.Date(2026, 12, 18, 10, 30, 0, 0, berlin), ""},
		{"1y", time.Date(2027, 11, 18, 10, 30, 0, 0, berlin), ""},
		{"1w", time.Date(2026, 11, 25, 10, 30, 0, 0, berlin), ""},
		{"19.11 14:00 call mom", time.Date(2026, 11, 19, 14, 0, 0, 0, berlin), "call mom"},
		{"17.11 14:00", time.Date(2027, 11, 17, 14, 0, 0, 0, berlin), ""},
		{"19.11", time.Date(2026, 11, 19, 9, 0, 0, 0, berlin), ""},
		{"01.03.2027 08:15", time.Date(2027, 3, 1, 8, 15, 0, 0, berlin), ""},
		{"14:00", time.Date(2026, 11, 18, 14, 0, 0, 0, berlin), ""},
		{"09:00", time.Date(2026, 11, 19, 9, 0, 0, 0, berlin), ""},
	}
	for _, c := range cases {
		cmd, spec, err := Execute(&Invocation{Name: chatstore.CommandRemindMe, Args: c.args}, now, "Europe/Berlin")
		if err != nil {
			t.Fatalf("%q: %v", c.args, err)
		}
		if !spec.DueAt.Equal(c.want) || cmd.DueAtTS != c.want.UnixMilli() {
			t.Fatalf("%q due %v, want %v", c.args, spec.DueAt.In(berlin), c.want)
		}
		if spec.Note != c.note || cmd.Note != c.note || cmd.TZ != "Europe/Berlin" {
			t.Fatalf("%q note %q tz %q", c.args, spec.Note, cmd.TZ)
		}
		if spec.DueAt.Location() != time.UTC {
			t.Fatalf("%q due not stored in UTC", c.args)
		}
	}
}

func TestRemindMonthClampAndDST(t *testing.T) {
	berlin := mustLoc(t, "Europe/Berlin")
	jan31 := time.Date(2027, 1, 31, 12, 0, 0, 0, berlin)
	if got := addRelative(jan31, "1m"); !got.Equal(time.Date(2027, 2, 28, 12, 0, 0, 0, berlin)) {
		t.Fatalf("Jan 31 + 1m = %v", got)
	}
	// DST starts 28 Mar 2027: one calendar day keeps the wall clock, 24h doesn't.
	before := time.Date(2027, 3, 27, 12, 0, 0, 0, berlin)
	if got := addRelative(before, "1d"); got.Hour() != 12 {
		t.Fatalf("1d across DST = %v", got)
	}
	if got := addRelative(before, "24h"); got.Hour() != 13 {
		t.Fatalf("24h across DST = %v", got)
	}
}

func TestRemindUnknownZoneFallsBackToUTC(t *testing.T) {
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, time.UTC)
	cmd, spec, err := Execute(&Invocation{Name: chatstore.CommandRemindMe, Args: "19.11 14:00"}, now, "Not/AZone")
	if err != nil {
		t.Fatal(err)
	}
	if cmd.TZ != "UTC" || !spec.DueAt.Equal(time.Date(2026, 11, 19, 14, 0, 0, 0, time.UTC)) {
		t.Fatalf("got %v %q", spec.DueAt, cmd.TZ)
	}
}
