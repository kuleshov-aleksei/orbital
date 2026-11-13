package handlers

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service"
	"gopkg.in/yaml.v3"
)

// releaseCacheTTL bounds how long a resolved release stays in memory.
const releaseCacheTTL = 5 * time.Minute

// releaseFetchTimeout bounds a single fetch of the update manifest.
const releaseFetchTimeout = 5 * time.Second

// updateManifest carries only the fields of latest.yml we care about.
type updateManifest struct {
	Version string `yaml:"version"`
}

// LatestReleaseResponse is the JSON served by GET /api/releases/latest.
// Artifact URLs are absolute so the download page can link straight to them.
type LatestReleaseResponse struct {
	Version    string `json:"version"`
	WindowsURL string `json:"windows_url"`
	LinuxURL   string `json:"linux_url"`
	AndroidURL string `json:"android_url"`
	// AndroidMinVersion is the oldest Android app the backend accepts
	// ("" = no minimum); older apps show a blocking "update required" screen.
	AndroidMinVersion string `json:"android_min_version"`
}

// ReleaseHandler resolves the newest release published to the update feed
// (Garage S3). All platforms (incl. the Android APK) ship in the same release, so the
// Windows manifest (latest.yml) is the single source of truth and the
// artifact URLs are derived from its version.
type ReleaseHandler struct {
	baseURL        string
	client         *http.Client
	clientVersions *service.ClientVersionService // nil: no android_min_version

	mu       sync.Mutex
	cached   *LatestReleaseResponse
	cachedAt time.Time
}

// NewReleaseHandler creates a ReleaseHandler for an update-feed root URL.
func NewReleaseHandler(baseURL string) *ReleaseHandler {
	return &ReleaseHandler{
		baseURL: baseURL,
		client:  &http.Client{Timeout: releaseFetchTimeout},
	}
}

// SetClientVersionService adds android_min_version to the response.
func (h *ReleaseHandler) SetClientVersionService(s *service.ClientVersionService) {
	h.clientVersions = s
}

// GetLatest handles GET /api/releases/latest.
// Returns the version and artifact URLs of the newest release.
func (h *ReleaseHandler) GetLatest(w http.ResponseWriter, r *http.Request) {
	cached, err := h.Latest(r.Context())
	if err != nil {
		log.Printf("[ReleaseHandler] Failed to resolve latest release: %v", err)
		h.sendError(w, "Failed to resolve latest release", http.StatusBadGateway)
		return
	}

	// Copy: the minimum version is live, not part of the cached release.
	release := *cached
	if h.clientVersions != nil {
		release.AndroidMinVersion = h.clientVersions.AndroidMinVersion()
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	writeJSON(w, release)
}

// Latest returns the newest published release (cached for releaseCacheTTL).
func (h *ReleaseHandler) Latest(ctx context.Context) (*LatestReleaseResponse, error) {
	if release, ok := h.getCached(); ok {
		return release, nil
	}
	release, err := h.resolve(ctx)
	if err != nil {
		return nil, err
	}
	h.storeCached(release)
	return release, nil
}

// getCached returns the cached release when it is still fresh.
func (h *ReleaseHandler) getCached() (*LatestReleaseResponse, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cached != nil && time.Since(h.cachedAt) < releaseCacheTTL {
		return h.cached, true
	}
	return nil, false
}

// storeCached replaces the cached release.
func (h *ReleaseHandler) storeCached(release *LatestReleaseResponse) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.cached = release
	h.cachedAt = time.Now()
}

// resolve fetches latest.yml from the update feed and derives the release.
func (h *ReleaseHandler) resolve(ctx context.Context) (*LatestReleaseResponse, error) {
	version, err := h.fetchManifestVersion(ctx)
	if err != nil {
		return nil, err
	}
	if version == "" {
		return nil, fmt.Errorf("latest.yml has no version")
	}

	base := h.baseURL
	return &LatestReleaseResponse{
		Version:    version,
		WindowsURL: fmt.Sprintf("%s/Orbital-Setup-%s.exe", base, version),
		LinuxURL:   fmt.Sprintf("%s/Orbital-%s.AppImage", base, version),
		AndroidURL: fmt.Sprintf("%s/Orbital-%s.apk", base, version),
	}, nil
}

// fetchManifestVersion reads the version field from latest.yml.
func (h *ReleaseHandler) fetchManifestVersion(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.baseURL+"/latest.yml", nil)
	if err != nil {
		return "", err
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("latest.yml returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return "", err
	}

	var manifest updateManifest
	if err := yaml.Unmarshal(body, &manifest); err != nil {
		return "", fmt.Errorf("failed to parse latest.yml: %w", err)
	}
	return manifest.Version, nil
}

// sendError sends an error response
func (h *ReleaseHandler) sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	writeJSON(w, ErrorResponse{Error: message})
}
