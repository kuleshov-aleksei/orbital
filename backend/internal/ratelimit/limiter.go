package ratelimit

import (
	"sync"
	"time"
)

const defaultMaxKeys = 10000

type bucket struct {
	hits     []time.Time
	lastSeen time.Time
}

type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	now     func() time.Time
	maxKeys int
}

func New() *Limiter {
	return &Limiter{
		buckets: make(map[string]*bucket),
		now:     time.Now,
		maxKeys: defaultMaxKeys,
	}
}

func (l *Limiter) Allow(key string, limit int, window time.Duration) (bool, time.Duration) {
	if limit <= 0 || window <= 0 {
		return true, 0
	}

	now := l.now()
	cutoff := now.Add(-window)

	l.mu.Lock()
	defer l.mu.Unlock()

	b := l.buckets[key]
	if b == nil {
		b = &bucket{}
		l.buckets[key] = b
	}

	recent := b.hits[:0]
	for _, ts := range b.hits {
		if ts.After(cutoff) {
			recent = append(recent, ts)
		}
	}
	b.hits = recent
	b.lastSeen = now

	if len(recent) >= limit {
		retryAfter := recent[0].Add(window).Sub(now)
		if retryAfter < 0 {
			retryAfter = 0
		}
		l.pruneLocked(now)
		return false, retryAfter
	}

	b.hits = append(b.hits, now)
	l.pruneLocked(now)
	return true, 0
}

func (l *Limiter) pruneLocked(now time.Time) {
	if len(l.buckets) <= l.maxKeys {
		return
	}

	cutoff := now.Add(-24 * time.Hour)
	for key, b := range l.buckets {
		if b.lastSeen.Before(cutoff) {
			delete(l.buckets, key)
		}
	}

	for len(l.buckets) > l.maxKeys {
		var oldestKey string
		var oldestSeen time.Time
		for key, b := range l.buckets {
			if oldestKey == "" || b.lastSeen.Before(oldestSeen) {
				oldestKey = key
				oldestSeen = b.lastSeen
			}
		}
		delete(l.buckets, oldestKey)
	}
}
