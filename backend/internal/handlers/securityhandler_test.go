package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/config"
)

func testEnv(values map[string]string) func(string) string {
	return func(key string) string {
		return values[key]
	}
}

func findSelfCheck(t *testing.T, report SecuritySelfCheckReport, id string) SecurityCheck {
	t.Helper()
	for _, check := range report.Checks {
		if check.ID == id {
			return check
		}
	}
	t.Fatalf("check %q not found in report", id)
	return SecurityCheck{}
}

func TestSecuritySelfCheckPassesProductionConfig(t *testing.T) {
	cfg := &config.Config{
		Server: config.ServerConfig{
			Mode:        "production",
			CORSOrigins: []string{"https://orbital.example.com"},
			ExternalURL: "https://orbital.example.com",
		},
		Auth: config.AuthConfig{
			JWTSecret: strings.Repeat("a", 64),
		},
	}

	report := buildSecuritySelfCheckReport(cfg, testEnv(nil))

	if report.OverallStatus != selfCheckPass {
		t.Fatalf("overall status = %q, want %q", report.OverallStatus, selfCheckPass)
	}
	for _, check := range report.Checks {
		if check.Status == selfCheckFail || check.Status == selfCheckWarn {
			t.Errorf("check %q status = %q, want pass/info", check.ID, check.Status)
		}
		if check.Recommendation == "" {
			t.Errorf("check %q has empty recommendation", check.ID)
		}
	}
}

func TestSecuritySelfCheckFlagsUnsafeConfig(t *testing.T) {
	cfg := &config.Config{
		Server: config.ServerConfig{
			Mode:        "development",
			CORSOrigins: []string{"*"},
			ExternalURL: "http://orbital.example.com",
		},
		Auth: config.AuthConfig{
			JWTSecret: "change-this-in-production",
		},
	}

	report := buildSecuritySelfCheckReport(cfg, testEnv(map[string]string{
		"GIN_MODE":     "release",
		"CORS_ORIGINS": "*",
	}))

	if report.OverallStatus != selfCheckFail {
		t.Fatalf("overall status = %q, want %q", report.OverallStatus, selfCheckFail)
	}

	checks := []struct {
		id       string
		status   string
		severity string
	}{
		{"jwt_secret", selfCheckFail, severityCritical},
		{"server_mode", selfCheckWarn, severityHigh},
		{"mode_env", selfCheckWarn, severityHigh},
		{"cors_env", selfCheckWarn, severityHigh},
		{"cors_wildcard", selfCheckWarn, severityMedium},
		{"external_url", selfCheckFail, severityHigh},
	}

	for _, want := range checks {
		check := findSelfCheck(t, report, want.id)
		if check.Status != want.status {
			t.Errorf("%s status = %q, want %q", want.id, check.Status, want.status)
		}
		if check.Severity != want.severity {
			t.Errorf("%s severity = %q, want %q", want.id, check.Severity, want.severity)
		}
		if check.Recommendation == "" {
			t.Errorf("%s has empty recommendation", want.id)
		}
	}
}

func TestSecuritySelfCheckIgnoresGinModeWhenConfigIsProduction(t *testing.T) {
	cfg := &config.Config{
		Server: config.ServerConfig{
			Mode:        "production",
			CORSOrigins: []string{"https://orbital.example.com"},
			ExternalURL: "https://orbital.example.com",
		},
		Auth: config.AuthConfig{
			JWTSecret: strings.Repeat("a", 64),
		},
	}

	report := buildSecuritySelfCheckReport(cfg, testEnv(map[string]string{
		"GIN_MODE": "release",
	}))
	check := findSelfCheck(t, report, "mode_env")

	if check.Status != selfCheckInfo {
		t.Fatalf("mode_env status = %q, want %q", check.Status, selfCheckInfo)
	}
}

func TestSecuritySelfCheckFlagsShortSecret(t *testing.T) {
	cfg := &config.Config{
		Server: config.ServerConfig{
			Mode:        "production",
			CORSOrigins: []string{"https://orbital.example.com"},
			ExternalURL: "https://orbital.example.com",
		},
		Auth: config.AuthConfig{
			JWTSecret: "short-secret",
		},
	}

	report := buildSecuritySelfCheckReport(cfg, testEnv(nil))
	check := findSelfCheck(t, report, "jwt_secret")

	if check.Status != selfCheckFail || check.Severity != severityHigh {
		t.Fatalf("jwt_secret = %q/%q, want fail/high", check.Status, check.Severity)
	}
	if !strings.Contains(check.Recommendation, "openssl rand") {
		t.Errorf("recommendation = %q, want rotation command", check.Recommendation)
	}
}

func TestSecuritySelfCheckAllowsLocalHTTPInDevelopment(t *testing.T) {
	cfg := &config.Config{
		Server: config.ServerConfig{
			Mode:        "development",
			CORSOrigins: []string{"http://localhost:3000"},
			ExternalURL: "http://localhost:3000",
		},
		Auth: config.AuthConfig{
			JWTSecret: strings.Repeat("a", 64),
		},
	}

	report := buildSecuritySelfCheckReport(cfg, testEnv(nil))
	check := findSelfCheck(t, report, "external_url")

	if check.Status != selfCheckWarn || check.Severity != severityLow {
		t.Fatalf("external_url = %q/%q, want warn/low", check.Status, check.Severity)
	}
}

func TestSecuritySelfCheckDoesNotLeakSecrets(t *testing.T) {
	jwtSecret := strings.Repeat("j", 64)
	googleSecret := "google-oauth-client-secret"
	discordSecret := "discord-oauth-client-secret"
	cfg := &config.Config{
		Server: config.ServerConfig{
			Mode:        "production",
			CORSOrigins: []string{"https://orbital.example.com"},
			ExternalURL: "https://orbital.example.com",
		},
		Auth: config.AuthConfig{
			JWTSecret: jwtSecret,
			Google: config.OAuthProviderConfig{
				ClientSecret: googleSecret,
			},
			Discord: config.OAuthProviderConfig{
				ClientSecret: discordSecret,
			},
		},
	}

	report := buildSecuritySelfCheckReport(cfg, testEnv(nil))
	body, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("marshal report: %v", err)
	}

	for _, secret := range []string{jwtSecret, googleSecret, discordSecret} {
		if strings.Contains(string(body), secret) {
			t.Errorf("report leaked a secret value")
		}
	}
}

func TestSecuritySelfCheckHandlerUnavailableConfig(t *testing.T) {
	handler := NewSecurityHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/admin/self-check", nil)
	rec := httptest.NewRecorder()

	handler.GetSelfCheck(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestSecuritySelfCheckHandlerSetsNoStore(t *testing.T) {
	handler := NewSecurityHandler(&config.Config{
		Server: config.ServerConfig{
			Mode:        "production",
			CORSOrigins: []string{"https://orbital.example.com"},
			ExternalURL: "https://orbital.example.com",
		},
		Auth: config.AuthConfig{
			JWTSecret: strings.Repeat("a", 64),
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/api/admin/self-check", nil)
	rec := httptest.NewRecorder()

	handler.GetSelfCheck(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}
