package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

func newTestClientVersions(t *testing.T, min string) *service.ClientVersionService {
	t.Helper()
	s, err := service.NewClientVersionService(service.NewMemoryAppSettings())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetAndroidMinVersion(min); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestClientVersionGate(t *testing.T) {
	gate := ClientVersionGate(newTestClientVersions(t, "1.5.0"))
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := gate(next)

	cases := []struct {
		name, method, path, client string
		want                       int
	}{
		{"outdated android", "GET", "/api/rooms", "android/1.4.0", http.StatusUpgradeRequired},
		{"outdated android POST", "POST", "/api/auth/guest", "android/1.4.0-abcd1234", http.StatusUpgradeRequired},
		{"current android", "GET", "/api/rooms", "android/1.5.0", http.StatusOK},
		{"web (no header)", "GET", "/api/rooms", "", http.StatusOK},
		{"electron", "GET", "/api/rooms", "electron/0.1.0", http.StatusOK},
		{"dev build", "GET", "/api/rooms", "android/dev-unknown", http.StatusOK},
		{"release info exempt", "GET", "/api/releases/latest", "android/1.4.0", http.StatusOK},
		{"version exempt", "GET", "/api/version", "android/1.4.0", http.StatusOK},
		{"preflight", "OPTIONS", "/api/rooms", "android/1.4.0", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.client != "" {
				req.Header.Set(ClientHeader, tc.client)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
			if tc.want == http.StatusUpgradeRequired {
				var body ClientOutdatedResponse
				_ = json.NewDecoder(rec.Body).Decode(&body)
				if body.Error != "client_outdated" || body.MinVersion != "1.5.0" {
					t.Fatalf("body = %+v", body)
				}
			}
		})
	}
}

func latestRelease(version string, err error) LatestReleaseFunc {
	return func(context.Context) (*LatestReleaseResponse, error) {
		if err != nil {
			return nil, err
		}
		return &LatestReleaseResponse{Version: version}, nil
	}
}

func putClientVersions(h http.Handler, body string, role string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPut, "/api/admin/client-versions", strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{UserID: "qkUrdzLDoqslx8EEy2cM7Q==", Role: role}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestUpdateClientVersions(t *testing.T) {
	versions := newTestClientVersions(t, "")
	h := NewClientVersionHandler(versions, latestRelease("1.6.0", nil))
	guarded := (&AuthHandler{}).RequireSuperAdmin(http.HandlerFunc(h.Update))

	if rec := putClientVersions(guarded, `{"android_min_version":"1.5.0"}`, models.RoleUser); rec.Code != http.StatusForbidden {
		t.Fatalf("non-superadmin: status = %d, want 403", rec.Code)
	}
	if versions.AndroidMinVersion() != "" {
		t.Fatal("forbidden request changed the floor")
	}

	for _, body := range []string{`{"android_min_version":"1.5"}`, `{"android_min_version":"latest"}`, `{`} {
		if rec := putClientVersions(guarded, body, models.RoleSuperAdmin); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, rec.Code)
		}
	}
	// Above the newest release: nobody could update, refuse.
	if rec := putClientVersions(guarded, `{"android_min_version":"1.7.0"}`, models.RoleSuperAdmin); rec.Code != http.StatusBadRequest {
		t.Fatalf("floor above latest: status = %d, want 400", rec.Code)
	}

	if rec := putClientVersions(guarded, `{"android_min_version":"1.6.0"}`, models.RoleSuperAdmin); rec.Code != http.StatusOK {
		t.Fatalf("valid floor: status = %d (%s)", rec.Code, rec.Body.String())
	}
	if versions.AndroidMinVersion() != "1.6.0" {
		t.Fatalf("floor = %q", versions.AndroidMinVersion())
	}

	// Clearing needs no release lookup.
	h.latest = latestRelease("", errors.New("feed down"))
	if rec := putClientVersions(guarded, `{"android_min_version":""}`, models.RoleSuperAdmin); rec.Code != http.StatusOK {
		t.Fatalf("clear: status = %d", rec.Code)
	}
	// Raising it while the feed is down is refused rather than guessed.
	if rec := putClientVersions(guarded, `{"android_min_version":"1.0.0"}`, models.RoleSuperAdmin); rec.Code != http.StatusBadGateway {
		t.Fatalf("feed down: status = %d, want 502", rec.Code)
	}
}
