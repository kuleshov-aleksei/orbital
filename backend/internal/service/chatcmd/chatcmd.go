// Package chatcmd runs text channel slash commands (/random, /vrandom, /d20,
// /remindme). Results are computed on the server so every client sees the
// same outcome; they are stored on the message (chatstore.Command).
package chatcmd

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

const (
	// MaxOptions / MaxOptionRunes bound /random option lists.
	MaxOptions     = 50
	MaxOptionRunes = 100
	// MaxWheelSegments bounds /vrandom (the wheel must stay readable).
	MaxWheelSegments = 24
	// MaxRangeSpan bounds /random A B.
	MaxRangeSpan = 1_000_000_000_000
	// MaxNoteRunes bounds a /remindme note.
	MaxNoteRunes = 500
)

// Usage lines, also the error text for malformed commands.
var usage = map[string]string{
	chatstore.CommandRandom:   "Usage: /random [min] <max>, or /random <option1> <option2> …",
	chatstore.CommandVRandom:  "Usage: /vrandom <option1> <option2> … (2–24 options), or /vrandom [min] <max> (up to 24 values)",
	chatstore.CommandD20:      "Usage: /d20",
	chatstore.CommandRemindMe: "Usage: /remindme <time> [note], e.g. /remindme 2h, /remindme 2d6h, /remindme 1m (month), /remindme 19.11 14:00",
}

// Usage returns the usage line of a command.
func Usage(name string) string { return usage[name] }

// Invocation is a parsed command: its name and the text after it.
type Invocation struct {
	Name string
	Args string
}

// Parse reports whether content is a known command. Unknown "/words" are
// plain messages (paths, "/shrug").
func Parse(content string) (*Invocation, bool) {
	s := strings.TrimSpace(content)
	if !strings.HasPrefix(s, "/") {
		return nil, false
	}
	name, args, _ := strings.Cut(s[1:], " ")
	if i := strings.IndexAny(name, "\n\t"); i >= 0 {
		args = name[i:] + " " + args
		name = name[:i]
	}
	name = strings.ToLower(name)
	if _, ok := usage[name]; !ok {
		return nil, false
	}
	return &Invocation{Name: name, Args: strings.TrimSpace(args)}, true
}

// ErrUsage wraps a user-facing reason; Error() is shown to the sender.
type ErrUsage struct{ Msg string }

func (e ErrUsage) Error() string { return e.Msg }

func usageErr(name, reason string) error {
	if reason == "" {
		return ErrUsage{usage[name]}
	}
	r := []rune(reason)
	r[0] = unicode.ToUpper(r[0])
	return ErrUsage{string(r) + ". " + usage[name]}
}

// IsUsage reports whether err is a malformed-command error.
func IsUsage(err error) bool {
	var u ErrUsage
	return errors.As(err, &u)
}

// ReminderSpec is what a /remindme stores once its message exists.
type ReminderSpec struct {
	DueAt time.Time
	TZ    string
	Note  string
}

// Execute runs a command. now and tz are the server time and the sender's
// IANA zone (empty or unknown → UTC). The reminder spec is set for /remindme.
func Execute(inv *Invocation, now time.Time, tz string) (*chatstore.Command, *ReminderSpec, error) {
	switch inv.Name {
	case chatstore.CommandRandom, chatstore.CommandVRandom:
		return pick(inv.Name, inv.Args)
	case chatstore.CommandD20:
		if inv.Args != "" {
			return nil, nil, usageErr(inv.Name, "")
		}
		v, err := randRange(1, 20)
		if err != nil {
			return nil, nil, err
		}
		cmd := &chatstore.Command{Name: inv.Name, Min: ptr(int64(1)), Max: ptr(int64(20)), Result: &v}
		switch v {
		case 1:
			cmd.Label = chatstore.LabelCriticalFailure
		case 20:
			cmd.Label = chatstore.LabelCriticalSuccess
		}
		return cmd, nil, nil
	case chatstore.CommandRemindMe:
		return remind(inv, now, tz)
	}
	return nil, nil, usageErr(inv.Name, "Unknown command")
}

func pick(name, args string) (*chatstore.Command, *ReminderSpec, error) {
	fields, err := splitOptions(args)
	if err != nil {
		return nil, nil, usageErr(name, err.Error())
	}
	cmd := &chatstore.Command{Name: name}
	if lo, hi, ok := numericRange(fields); ok {
		if hi < lo {
			lo, hi = hi, lo
		}
		if hi-lo > MaxRangeSpan || hi-lo < 0 {
			return nil, nil, usageErr(name, "That range is too large")
		}
		if name == chatstore.CommandVRandom && hi-lo+1 > MaxWheelSegments {
			return nil, nil, usageErr(name, fmt.Sprintf("The wheel fits at most %d values", MaxWheelSegments))
		}
		if hi == lo {
			return nil, nil, usageErr(name, "The range needs at least two values")
		}
		v, err := randRange(lo, hi)
		if err != nil {
			return nil, nil, err
		}
		cmd.Min, cmd.Max, cmd.Result = &lo, &hi, &v
		return cmd, nil, nil
	}
	limit := MaxOptions
	if name == chatstore.CommandVRandom {
		limit = MaxWheelSegments
	}
	if len(fields) < 2 {
		return nil, nil, usageErr(name, "Give at least two options")
	}
	if len(fields) > limit {
		return nil, nil, usageErr(name, fmt.Sprintf("At most %d options", limit))
	}
	for _, f := range fields {
		if utf8.RuneCountInString(f) > MaxOptionRunes {
			return nil, nil, usageErr(name, fmt.Sprintf("Options are limited to %d characters", MaxOptionRunes))
		}
	}
	i, err := randRange(0, int64(len(fields)-1))
	if err != nil {
		return nil, nil, err
	}
	idx := int(i)
	cmd.Options, cmd.ResultIndex = fields, &idx
	return cmd, nil, nil
}

// numericRange: no args → 1..100, one integer N → 1..N, two integers → A..B.
func numericRange(fields []string) (int64, int64, bool) {
	ints := make([]int64, 0, 2)
	for _, f := range fields {
		v, err := strconv.ParseInt(f, 10, 64)
		if err != nil {
			return 0, 0, false
		}
		ints = append(ints, v)
	}
	switch len(ints) {
	case 0:
		return 1, 100, true
	case 1:
		return 1, ints[0], true
	case 2:
		return ints[0], ints[1], true
	}
	return 0, 0, false
}

// splitOptions splits by commas when any is present, else by whitespace.
// "Double quotes" keep spaces (and commas) inside one option.
func splitOptions(s string) ([]string, error) {
	sep := func(r rune) bool { return r == ' ' || r == '\t' || r == '\n' }
	if strings.Contains(stripQuoted(s), ",") {
		sep = func(r rune) bool { return r == ',' }
	}
	var out []string
	var cur strings.Builder
	inQuote, quoted := false, false
	flush := func() {
		v := strings.TrimSpace(cur.String())
		if v != "" || quoted {
			if v != "" {
				out = append(out, v)
			}
		}
		cur.Reset()
		quoted = false
	}
	for _, r := range s {
		switch {
		case r == '"':
			inQuote = !inQuote
			quoted = true
		case !inQuote && sep(r):
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	if inQuote {
		return nil, errors.New("unclosed quote")
	}
	flush()
	return out, nil
}

// stripQuoted drops "quoted" parts (to look for separators outside them).
func stripQuoted(s string) string {
	var b strings.Builder
	in := false
	for _, r := range s {
		if r == '"' {
			in = !in
			continue
		}
		if !in {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// randRange returns a uniform value in [lo, hi] from crypto/rand.
func randRange(lo, hi int64) (int64, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(hi-lo+1))
	if err != nil {
		return 0, err
	}
	return lo + n.Int64(), nil
}

func ptr[T any](v T) *T { return &v }
