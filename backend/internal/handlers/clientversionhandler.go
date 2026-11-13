package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// ClientHeader identifies a packaged app build: "<platform>/<version>"
// (e.g. "android/1.5.2"). The web app doesn't send it.
const ClientHeader = "X-Orbital-Client"

// clientOutdatedError is the error code of the 426 response.
const clientOutdatedError = "client_outdated"

// clientVersionExempt are the endpoints an outdated app still needs: the
// release info drives its "update required" screen.
var clientVersionExempt = map[string]bool{
	"/api/releases/latest": true,
	"/api/version":         true,
	"/api/health":          true,
}

// ClientOutdatedResponse is the 426 body sent to an app below the minimum.
type ClientOutdatedResponse struct {
	Error      string `json:"error"`
	MinVersion string `json:"min_version"`
}

// ClientVersionGate refuses API requests from apps below the minimum version
// with 426 Upgrade Required. Requests without the header (web, Electron,
// WebSocket upgrades) pass through.
func ClientVersionGate(versions *service.ClientVersionService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions || clientVersionExempt[r.URL.Path] ||
				!strings.HasPrefix(r.URL.Path, "/api/") ||
				!versions.IsOutdated(r.Header.Get(ClientHeader)) {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUpgradeRequired)
			writeJSON(w, ClientOutdatedResponse{Error: clientOutdatedError, MinVersion: versions.AndroidMinVersion()})
		})
	}
}

// LatestReleaseFunc returns the newest published release
// (ReleaseHandler.Latest).
type LatestReleaseFunc func(ctx context.Context) (*LatestReleaseResponse, error)

// ClientVersionHandler serves the superadmin minimum-version settings.
type ClientVersionHandler struct {
	versions *service.ClientVersionService
	latest   LatestReleaseFunc
}

func NewClientVersionHandler(versions *service.ClientVersionService, latest LatestReleaseFunc) *ClientVersionHandler {
	return &ClientVersionHandler{versions: versions, latest: latest}
}

// ClientVersionsResponse is the body of GET/PUT /api/admin/client-versions.
type ClientVersionsResponse struct {
	AndroidMinVersion string `json:"android_min_version"`
	// LatestVersion is "" when the release feed can't be reached.
	LatestVersion string `json:"latest_version"`
}

type updateClientVersionsRequest struct {
	AndroidMinVersion string `json:"android_min_version"`
}

// Get handles GET /api/admin/client-versions.
func (h *ClientVersionHandler) Get(w http.ResponseWriter, r *http.Request) {
	resp := ClientVersionsResponse{AndroidMinVersion: h.versions.AndroidMinVersion()}
	if release, err := h.latest(r.Context()); err == nil {
		resp.LatestVersion = release.Version
	} else {
		log.Printf("[ClientVersionHandler] Failed to resolve latest release: %v", err)
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, resp)
}

// Update handles PUT /api/admin/client-versions. A minimum above the newest
// published release is refused: it would block every app with no update to
// install.
func (h *ClientVersionHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req updateClientVersionsRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		sendJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	minVersion := strings.TrimSpace(req.AndroidMinVersion)

	var latestVersion string
	if minVersion != "" {
		want, ok := service.ParseAppVersion(minVersion)
		if !ok {
			sendJSONError(w, "Version must look like 1.2.3", http.StatusBadRequest)
			return
		}
		release, err := h.latest(r.Context())
		if err != nil {
			log.Printf("[ClientVersionHandler] Failed to resolve latest release: %v", err)
			sendJSONError(w, "Can't check the latest release, try again later", http.StatusBadGateway)
			return
		}
		latestVersion = release.Version
		have, ok := service.ParseAppVersion(latestVersion)
		if !ok || service.CompareAppVersions(want, have) > 0 {
			sendJSONError(w, "Minimum version is newer than the latest published release ("+latestVersion+")", http.StatusBadRequest)
			return
		}
	}

	if err := h.versions.SetAndroidMinVersion(minVersion); err != nil {
		log.Printf("[ClientVersionHandler] Failed to store minimum version: %v", err)
		sendJSONError(w, "Failed to save minimum version", http.StatusInternalServerError)
		return
	}
	log.Printf("[ClientVersionHandler] Android minimum version set to %q", minVersion)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, ClientVersionsResponse{AndroidMinVersion: minVersion, LatestVersion: latestVersion})
}

func sendJSONError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	writeJSON(w, ErrorResponse{Error: message})
}
