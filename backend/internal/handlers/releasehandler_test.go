package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testLatestYML = `version: 2.55.4
files:
  - url: Orbital-Setup-2.55.4.exe
    sha512: abc123
    size: 123456789
path: Orbital-Setup-2.55.4.exe
sha512: abc123
releaseDate: '2026-10-01T00:00:00.000Z'
`

func TestGetLatestResolvesRelease(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/latest.yml" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/yaml")
		_, _ = w.Write([]byte(testLatestYML))
	}))
	defer upstream.Close()

	handler := NewReleaseHandler(upstream.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/releases/latest", nil)
	rec := httptest.NewRecorder()

	handler.GetLatest(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp LatestReleaseResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.Version != "2.55.4" {
		t.Errorf("version = %q, want %q", resp.Version, "2.55.4")
	}
	if want := upstream.URL + "/Orbital-Setup-2.55.4.exe"; resp.WindowsURL != want {
		t.Errorf("windows_url = %q, want %q", resp.WindowsURL, want)
	}
	if want := upstream.URL + "/Orbital-2.55.4.AppImage"; resp.LinuxURL != want {
		t.Errorf("linux_url = %q, want %q", resp.LinuxURL, want)
	}
}

func TestGetLatestCachesUpstream(t *testing.T) {
	hits := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write([]byte(testLatestYML))
	}))
	defer upstream.Close()

	handler := NewReleaseHandler(upstream.URL)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/releases/latest", nil)
		rec := httptest.NewRecorder()
		handler.GetLatest(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("call %d: status = %d, want %d", i, rec.Code, http.StatusOK)
		}
	}

	if hits != 1 {
		t.Errorf("upstream hits = %d, want 1 (second call should be cached)", hits)
	}
}

func TestGetLatestUpstreamError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer upstream.Close()

	handler := NewReleaseHandler(upstream.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/releases/latest", nil)
	rec := httptest.NewRecorder()

	handler.GetLatest(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusBadGateway, rec.Body.String())
	}
}

func TestGetLatestMissingVersion(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("path: Orbital-Setup-2.55.4.exe\n"))
	}))
	defer upstream.Close()

	handler := NewReleaseHandler(upstream.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/releases/latest", nil)
	rec := httptest.NewRecorder()

	handler.GetLatest(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusBadGateway, rec.Body.String())
	}
}

// TestGetLatestUpstreamUnreachable covers the case where the updates host
// cannot be reached at all (e.g. local dev without network access).
func TestGetLatestUpstreamUnreachable(t *testing.T) {
	handler := NewReleaseHandler("http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodGet, "/api/releases/latest", nil)
	rec := httptest.NewRecorder()

	handler.GetLatest(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusBadGateway, rec.Body.String())
	}

	var errResp ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if !strings.Contains(errResp.Error, "latest release") {
		t.Errorf("error = %q, want it to mention the latest release", errResp.Error)
	}
}
