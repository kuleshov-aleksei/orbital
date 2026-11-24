package chatcmd

import (
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	// Reminder times are wall-clock times in the sender's zone, so the IANA
	// database must be available wherever this runs (the alpine image has none).
	_ "time/tzdata"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

const (
	// MinReminderDelay / MaxReminderAhead bound when a reminder may fire.
	MinReminderDelay = time.Minute
	// DefaultReminderHour is the time of a date-only reminder (19.11).
	DefaultReminderHour = 9
)

var (
	// Relative: 2h, 2d6h, 1m (month), 30min, 1y2mo. Go regexps are
	// leftmost-first, so "min"/"mo" win over "m".
	relativeRe = regexp.MustCompile(`^(?:\d{1,4}(?:min|mo|y|w|d|h|m))+$`)
	relPartRe  = regexp.MustCompile(`(\d{1,4})(min|mo|y|w|d|h|m)`)
	dateRe     = regexp.MustCompile(`^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$`)
	clockRe    = regexp.MustCompile(`^(\d{1,2}):(\d{2})$`)
)

// LoadZone resolves an IANA zone name; empty or unknown → UTC.
func LoadZone(tz string) (*time.Location, string) {
	if tz == "" {
		return time.UTC, "UTC"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		// Never silent: a missing tz database would schedule every reminder in
		// UTC, which is impossible to spot from the message alone.
		log.Printf("[ChatCmd] Unknown time zone %q, using UTC: %v", tz, err)
		return time.UTC, "UTC"
	}
	return loc, tz
}

func remind(inv *Invocation, now time.Time, tz string) (*chatstore.Command, *ReminderSpec, error) {
	loc, zone := LoadZone(tz)
	tokens := strings.Fields(inv.Args)
	if len(tokens) == 0 {
		return nil, nil, usageErr(inv.Name, "")
	}
	due, used, err := parseWhen(tokens, now.In(loc))
	if err != nil {
		return nil, nil, usageErr(inv.Name, err.Error())
	}
	if due.Sub(now) < MinReminderDelay {
		return nil, nil, usageErr(inv.Name, "That time is in the past")
	}
	if due.After(now.In(loc).AddDate(1, 0, 0)) {
		return nil, nil, usageErr(inv.Name, "Reminders can be at most one year ahead")
	}
	// The note keeps the original spacing after the time tokens.
	note := strings.TrimSpace(afterTokens(inv.Args, used))
	if utf8.RuneCountInString(note) > MaxNoteRunes {
		return nil, nil, usageErr(inv.Name, fmt.Sprintf("The note is limited to %d characters", MaxNoteRunes))
	}
	cmd := &chatstore.Command{Name: inv.Name, DueAtTS: due.UnixMilli(), TZ: zone, Note: note}
	return cmd, &ReminderSpec{DueAt: due.UTC(), TZ: zone, Note: note}, nil
}

// parseWhen reads the time at the start of tokens and returns how many
// tokens it used. now is in the sender's zone.
func parseWhen(tokens []string, now time.Time) (time.Time, int, error) {
	first := strings.ToLower(tokens[0])
	switch {
	case relativeRe.MatchString(first):
		return addRelative(now, first), 1, nil
	case dateRe.MatchString(first):
		hour, minute, used := DefaultReminderHour, 0, 1
		if len(tokens) > 1 && clockRe.MatchString(tokens[1]) {
			var err error
			if hour, minute, err = parseClock(tokens[1]); err != nil {
				return time.Time{}, 0, err
			}
			used = 2
		}
		t, err := parseDate(first, hour, minute, now)
		return t, used, err
	case clockRe.MatchString(first):
		hour, minute, err := parseClock(first)
		if err != nil {
			return time.Time{}, 0, err
		}
		t := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, now.Location())
		if !t.After(now) {
			t = time.Date(now.Year(), now.Month(), now.Day()+1, hour, minute, 0, 0, now.Location())
		}
		return t, 1, nil
	}
	return time.Time{}, 0, fmt.Errorf("can't read the time %q", tokens[0])
}

// addRelative applies calendar units (years, months, weeks, days) in the
// sender's zone, then exact hours and minutes.
func addRelative(now time.Time, s string) time.Time {
	var years, months, days int
	var exact time.Duration
	for _, m := range relPartRe.FindAllStringSubmatch(s, -1) {
		n, _ := strconv.Atoi(m[1])
		switch m[2] {
		case "y":
			years += n
		case "mo", "m":
			months += n
		case "w":
			days += 7 * n
		case "d":
			days += n
		case "h":
			exact += time.Duration(n) * time.Hour
		case "min":
			exact += time.Duration(n) * time.Minute
		}
	}
	t := addMonths(now, years*12+months)
	t = t.AddDate(0, 0, days)
	return t.Add(exact)
}

// addMonths adds months, clamping the day to the end of the target month
// (Jan 31 + 1 month = Feb 28/29, not Mar 3).
func addMonths(t time.Time, n int) time.Time {
	if n == 0 {
		return t
	}
	y, m, d := t.Date()
	first := time.Date(y, m+time.Month(n), 1, 0, 0, 0, 0, t.Location())
	last := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
	return time.Date(first.Year(), first.Month(), min(d, last), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
}

func parseClock(s string) (int, int, error) {
	m := clockRe.FindStringSubmatch(s)
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	if h > 23 || mi > 59 {
		return 0, 0, fmt.Errorf("can't read the time %q", s)
	}
	return h, mi, nil
}

// parseDate reads DD.MM or DD.MM.YYYY. Without a year, a date that has
// passed means next year.
func parseDate(s string, hour, minute int, now time.Time) (time.Time, error) {
	m := dateRe.FindStringSubmatch(s)
	day, _ := strconv.Atoi(m[1])
	month, _ := strconv.Atoi(m[2])
	year := now.Year()
	if m[3] != "" {
		year, _ = strconv.Atoi(m[3])
	}
	build := func(y int) (time.Time, bool) {
		t := time.Date(y, time.Month(month), day, hour, minute, 0, 0, now.Location())
		return t, t.Day() == day && int(t.Month()) == month
	}
	t, ok := build(year)
	if !ok {
		return time.Time{}, fmt.Errorf("there is no date %q", s)
	}
	if m[3] == "" && !t.After(now) {
		if t, ok = build(year + 1); !ok { // 29.02 next year
			return time.Time{}, fmt.Errorf("there is no date %q next year", s)
		}
	}
	return t, nil
}

// afterTokens returns s without its first n whitespace-separated fields.
func afterTokens(s string, n int) string {
	s = strings.TrimLeft(s, " \t\n")
	for i := 0; i < n; i++ {
		j := strings.IndexAny(s, " \t\n")
		if j < 0 {
			return ""
		}
		s = strings.TrimLeft(s[j:], " \t\n")
	}
	return s
}
