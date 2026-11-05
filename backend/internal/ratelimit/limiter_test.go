package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAllowEnforcesWindow(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	limiter := New()
	limiter.now = func() time.Time { return now }

	allowed, _ := limiter.Allow("client", 2, time.Minute)
	if !allowed {
		t.Fatal("first request denied")
	}
	allowed, _ = limiter.Allow("client", 2, time.Minute)
	if !allowed {
		t.Fatal("second request denied")
	}

	allowed, retryAfter := limiter.Allow("client", 2, time.Minute)
	if allowed {
		t.Fatal("third request allowed")
	}
	if retryAfter != time.Minute {
		t.Fatalf("retryAfter = %v, want %v", retryAfter, time.Minute)
	}

	now = now.Add(time.Minute + time.Second)
	allowed, _ = limiter.Allow("client", 2, time.Minute)
	if !allowed {
		t.Fatal("request after window denied")
	}
}

func TestAllowSeparatesKeys(t *testing.T) {
	limiter := New()
	if allowed, _ := limiter.Allow("a", 1, time.Minute); !allowed {
		t.Fatal("first key denied")
	}
	if allowed, _ := limiter.Allow("b", 1, time.Minute); !allowed {
		t.Fatal("second key denied")
	}
	if allowed, _ := limiter.Allow("a", 1, time.Minute); allowed {
		t.Fatal("first key should be limited")
	}
}

func TestLimiterBoundsKeyCount(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	limiter := New()
	limiter.now = func() time.Time { return now }
	limiter.maxKeys = 2

	limiter.Allow("a", 1, time.Minute)
	limiter.Allow("b", 1, time.Minute)
	limiter.Allow("c", 1, time.Minute)

	if len(limiter.buckets) > limiter.maxKeys {
		t.Fatalf("bucket count = %d, want <= %d", len(limiter.buckets), limiter.maxKeys)
	}
}

func TestMiddlewareReturnsRetryHeaders(t *testing.T) {
	limiter := New()
	handler := limiter.Middleware(
		"login",
		Every(1, time.Minute),
		func(*http.Request) string { return "203.0.113.1" },
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodPost, "/api/auth/login", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, want %d", first.Code, http.StatusOK)
	}

	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodPost, "/api/auth/login", nil))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want %d", second.Code, http.StatusTooManyRequests)
	}
	if second.Header().Get("Retry-After") == "" {
		t.Fatal("Retry-After header missing")
	}
	if second.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", second.Header().Get("Cache-Control"))
	}
}
