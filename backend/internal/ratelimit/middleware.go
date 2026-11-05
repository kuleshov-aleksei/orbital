package ratelimit

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"
)

type KeyFunc func(*http.Request) string

type LimitFunc func(*http.Request) (int, time.Duration)

func Every(limit int, window time.Duration) LimitFunc {
	return func(*http.Request) (int, time.Duration) {
		return limit, window
	}
}

func (l *Limiter) Middleware(name string, limit LimitFunc, key KeyFunc, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		max, window := limit(r)
		bucketKey := key(r)
		if name != "" {
			bucketKey = name + ":" + bucketKey
		}

		allowed, retryAfter := l.Allow(bucketKey, max, window)
		if !allowed {
			WriteTooManyRequests(w, retryAfter)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func WriteTooManyRequests(w http.ResponseWriter, retryAfter time.Duration) {
	seconds := int(math.Ceil(retryAfter.Seconds()))
	if seconds < 1 {
		seconds = 1
	}

	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	w.Header().Set("Cache-Control", "no-store")
	http.Error(w, fmt.Sprintf("Too many requests. Try again in %d seconds.", seconds), http.StatusTooManyRequests)
}
