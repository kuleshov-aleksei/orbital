package chatstore

import (
	"fmt"
	"strings"
	"time"
	"unicode"
)

// ParsedQuery is a search box query split into filters and free text
// (docs/specs/CHAT_SYSTEM.md §7.11). Names are resolved by the caller.
type ParsedQuery struct {
	Text     string   // free text, quoted phrases kept quoted
	From     []string // author names
	In       []string // channel names
	Mentions []string // mentioned user names
	During   []string
	After    []string
	Before   []string
	Has      []string
	Pinned   *bool
}

// Empty reports whether the query has neither text nor filters.
func (q ParsedQuery) Empty() bool {
	return strings.TrimSpace(q.Text) == "" && len(q.From) == 0 && len(q.In) == 0 &&
		len(q.Mentions) == 0 && len(q.During) == 0 && len(q.After) == 0 && len(q.Before) == 0 &&
		len(q.Has) == 0 && q.Pinned == nil
}

// queryTerm is one whitespace-separated piece; quoted pieces keep spaces.
type queryTerm struct {
	text   string // the raw term, quotes included
	key    string // lowercased key before ':' ("" when not key:value)
	value  string // unquoted value
	quoted bool   // the value (or the whole term) was quoted
}

func splitTerms(raw string) []queryTerm {
	var terms []queryTerm
	rs := []rune(raw)
	for i := 0; i < len(rs); {
		if unicode.IsSpace(rs[i]) {
			i++
			continue
		}
		start := i
		inQuote := false
		for i < len(rs) && (inQuote || !unicode.IsSpace(rs[i])) {
			if rs[i] == '"' {
				inQuote = !inQuote
			}
			i++
		}
		text := string(rs[start:i])
		t := queryTerm{text: text}
		if k, v, ok := strings.Cut(text, ":"); ok && k != "" && !strings.ContainsRune(k, '"') {
			t.key = strings.ToLower(k)
			t.value, t.quoted = unquote(v)
		} else {
			_, t.quoted = unquote(text)
		}
		terms = append(terms, t)
	}
	return terms
}

func unquote(v string) (string, bool) {
	if len(v) >= 2 && strings.HasPrefix(v, `"`) && strings.HasSuffix(v, `"`) {
		return v[1 : len(v)-1], true
	}
	return strings.Trim(v, `"`), false
}

// ParseQuery splits a raw query. Unknown keys and empty values stay text.
func ParseQuery(raw string) ParsedQuery {
	var q ParsedQuery
	var text []string
	for _, t := range splitTerms(raw) {
		v := strings.TrimSpace(t.value)
		if t.key == "" || v == "" {
			text = append(text, t.text)
			continue
		}
		switch t.key {
		case "from":
			q.From = append(q.From, strings.TrimPrefix(v, "@"))
		case "in":
			q.In = append(q.In, strings.TrimPrefix(v, "#"))
		case "mentions":
			q.Mentions = append(q.Mentions, strings.TrimPrefix(v, "@"))
		case "during", "on":
			q.During = append(q.During, strings.ToLower(v))
		case "after":
			q.After = append(q.After, strings.ToLower(v))
		case "before":
			q.Before = append(q.Before, strings.ToLower(v))
		case "has":
			q.Has = append(q.Has, strings.ToLower(v))
		case "pinned":
			b := strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
			q.Pinned = &b
		default:
			text = append(text, t.text)
		}
	}
	q.Text = strings.Join(text, " ")
	return q
}

// dayRange resolves "2026-11-10", "2026-11", "today" or "yesterday" in loc
// to [start, end) in unix ms.
func dayRange(v string, loc *time.Location, now time.Time) (int64, int64, error) {
	today := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	switch v {
	case "today":
		return today.UnixMilli(), today.AddDate(0, 0, 1).UnixMilli(), nil
	case "yesterday":
		y := today.AddDate(0, 0, -1)
		return y.UnixMilli(), today.UnixMilli(), nil
	}
	if t, err := time.ParseInLocation("2006-01-02", v, loc); err == nil {
		return t.UnixMilli(), t.AddDate(0, 0, 1).UnixMilli(), nil
	}
	if t, err := time.ParseInLocation("2006-01", v, loc); err == nil {
		return t.UnixMilli(), t.AddDate(0, 1, 0).UnixMilli(), nil
	}
	return 0, 0, fmt.Errorf("unknown date %q (use YYYY-MM-DD, YYYY-MM, today or yesterday)", v)
}

// TimeBounds intersects during:/after:/before: into created_at_ts bounds:
// FromTS inclusive, ToTS exclusive; zero means unbounded. Bad dates are
// returned as hints and ignored.
func (q ParsedQuery) TimeBounds(loc *time.Location, now time.Time) (fromTS, toTS int64, hints []string) {
	if loc == nil {
		loc = time.UTC
	}
	lower := func(v int64) {
		if v > fromTS {
			fromTS = v
		}
	}
	upper := func(v int64) {
		if toTS == 0 || v < toTS {
			toTS = v
		}
	}
	for _, v := range q.During {
		start, end, err := dayRange(v, loc, now)
		if err != nil {
			hints = append(hints, err.Error())
			continue
		}
		lower(start)
		upper(end)
	}
	for _, v := range q.After {
		_, end, err := dayRange(v, loc, now)
		if err != nil {
			hints = append(hints, err.Error())
			continue
		}
		lower(end) // exclusive: after a day starts the next day
	}
	for _, v := range q.Before {
		start, _, err := dayRange(v, loc, now)
		if err != nil {
			hints = append(hints, err.Error())
			continue
		}
		upper(start)
	}
	return fromTS, toTS, hints
}
