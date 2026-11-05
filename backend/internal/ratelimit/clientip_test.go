package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIPPrefersForwardedAddress(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", " 203.0.113.7 , 10.0.0.1")
	req.RemoteAddr = "198.51.100.9:1234"

	if got := ClientIP(req); got != "203.0.113.7" {
		t.Fatalf("ClientIP = %q, want 203.0.113.7", got)
	}
}

func TestClientIPStripsRemotePort(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.9:1234"

	if got := ClientIP(req); got != "198.51.100.9" {
		t.Fatalf("ClientIP = %q, want 198.51.100.9", got)
	}
}

func TestClientIPHandlesIPv6(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "[2001:db8::1]:443")

	if got := ClientIP(req); got != "2001:db8::1" {
		t.Fatalf("ClientIP = %q, want 2001:db8::1", got)
	}
}

func TestClientIPFallsBackForInvalidForwardedAddress(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "not-an-ip")
	req.RemoteAddr = "198.51.100.9:1234"

	if got := ClientIP(req); got != "198.51.100.9" {
		t.Fatalf("ClientIP = %q, want 198.51.100.9", got)
	}
}
