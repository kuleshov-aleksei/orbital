package handlers

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
)

const (
	selfCheckPass = "pass"
	selfCheckWarn = "warn"
	selfCheckFail = "fail"
	selfCheckInfo = "info"

	severityCritical = "critical"
	severityHigh     = "high"
	severityMedium   = "medium"
	severityLow      = "low"
	severityInfo     = "info"

	minJWTSecretLength = 32
)

var knownDefaultJWTSecrets = map[string]struct{}{
	"change-this-in-production":                           {},
	"change-this-to-a-secure-random-string-in-production": {},
}

type SecurityCheck struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	Status         string `json:"status"`
	Severity       string `json:"severity"`
	Message        string `json:"message"`
	Recommendation string `json:"recommendation"`
}

type SecuritySelfCheckReport struct {
	GeneratedAt   time.Time       `json:"generated_at"`
	OverallStatus string          `json:"overall_status"`
	Checks        []SecurityCheck `json:"checks"`
}

type SecurityHandler struct {
	cfg *config.Config
}

func NewSecurityHandler(cfg *config.Config) *SecurityHandler {
	return &SecurityHandler{cfg: cfg}
}

func (h *SecurityHandler) GetSelfCheck(w http.ResponseWriter, r *http.Request) {
	if h.cfg == nil {
		http.Error(w, "Configuration unavailable", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, buildSecuritySelfCheckReport(h.cfg, os.Getenv))
}

func buildSecuritySelfCheckReport(cfg *config.Config, getenv func(string) string) SecuritySelfCheckReport {
	if getenv == nil {
		getenv = os.Getenv
	}

	checks := []SecurityCheck{
		checkJWTSecret(cfg),
		checkServerMode(cfg),
		checkModeEnv(cfg, getenv),
		checkCORSEnv(getenv),
		checkCORSWildcard(cfg),
		checkExternalURL(cfg),
	}

	return SecuritySelfCheckReport{
		GeneratedAt:   time.Now().UTC(),
		OverallStatus: overallSelfCheckStatus(checks),
		Checks:        checks,
	}
}

func checkJWTSecret(cfg *config.Config) SecurityCheck {
	secret := cfg.Auth.JWTSecret
	trimmed := strings.TrimSpace(secret)

	if trimmed == "" {
		return SecurityCheck{
			ID:             "jwt_secret",
			Title:          "JWT secret",
			Status:         selfCheckFail,
			Severity:       severityCritical,
			Message:        "JWT secret is empty.",
			Recommendation: "Set `JWT_SECRET` in `.env` (or your secret manager) to a random value, then restart the backend.",
		}
	}

	if _, known := knownDefaultJWTSecrets[trimmed]; known {
		return SecurityCheck{
			ID:             "jwt_secret",
			Title:          "JWT secret",
			Status:         selfCheckFail,
			Severity:       severityCritical,
			Message:        "JWT secret is a public default or placeholder value.",
			Recommendation: "Rotate the secret immediately: run `openssl rand -base64 48`, set `JWT_SECRET` in `.env` (or your secret manager), then restart the backend. This signs out all existing sessions.",
		}
	}

	if len(secret) < minJWTSecretLength {
		return SecurityCheck{
			ID:             "jwt_secret",
			Title:          "JWT secret",
			Status:         selfCheckFail,
			Severity:       severityHigh,
			Message:        fmt.Sprintf("JWT secret is too short (%d characters; minimum %d).", len(secret), minJWTSecretLength),
			Recommendation: "Generate a longer secret with `openssl rand -base64 48`, set `JWT_SECRET` in `.env` (or your secret manager), then restart the backend. This signs out all existing sessions.",
		}
	}

	return SecurityCheck{
		ID:             "jwt_secret",
		Title:          "JWT secret",
		Status:         selfCheckPass,
		Severity:       severityInfo,
		Message:        "JWT secret is not a known default and meets the minimum length.",
		Recommendation: "No action needed.",
	}
}

func checkServerMode(cfg *config.Config) SecurityCheck {
	mode := strings.TrimSpace(cfg.Server.Mode)

	if mode == "production" {
		return SecurityCheck{
			ID:             "server_mode",
			Title:          "Server mode",
			Status:         selfCheckPass,
			Severity:       severityInfo,
			Message:        "Server is running in production mode.",
			Recommendation: "No action needed.",
		}
	}

	if mode == "" {
		return SecurityCheck{
			ID:             "server_mode",
			Title:          "Server mode",
			Status:         selfCheckWarn,
			Severity:       severityHigh,
			Message:        "`SERVER_MODE` is not set; the backend is using the default development mode.",
			Recommendation: "Set `SERVER_MODE=production` in `.env` or the deployment environment, then restart the backend.",
		}
	}

	return SecurityCheck{
		ID:             "server_mode",
		Title:          "Server mode",
		Status:         selfCheckWarn,
		Severity:       severityHigh,
		Message:        fmt.Sprintf("`SERVER_MODE` is %q; production deployments must use `production`.", mode),
		Recommendation: "Set `SERVER_MODE=production` in `.env` or the deployment environment, then restart the backend. The backend accepts `development` or `production`, not Gin's `debug`/`release`/`test` values.",
	}
}

func checkModeEnv(cfg *config.Config, getenv func(string) string) SecurityCheck {
	ginMode := strings.TrimSpace(getenv("GIN_MODE"))
	serverMode := strings.TrimSpace(getenv("SERVER_MODE"))

	if ginMode == "" {
		return SecurityCheck{
			ID:             "mode_env",
			Title:          "Server mode environment",
			Status:         selfCheckInfo,
			Severity:       severityInfo,
			Message:        "`GIN_MODE` is not set; `SERVER_MODE` is authoritative.",
			Recommendation: "No action needed.",
		}
	}

	if serverMode == "" {
		if cfg.Server.Mode == "production" {
			return SecurityCheck{
				ID:             "mode_env",
				Title:          "Server mode environment",
				Status:         selfCheckInfo,
				Severity:       severityInfo,
				Message:        "Production mode is configured outside `SERVER_MODE`; `GIN_MODE` is ignored.",
				Recommendation: "Remove the unused `GIN_MODE` variable to avoid confusion.",
			}
		}

		if ginMode == "debug" {
			return SecurityCheck{
				ID:             "mode_env",
				Title:          "Server mode environment",
				Status:         selfCheckWarn,
				Severity:       severityLow,
				Message:        "`GIN_MODE=debug` is set but ignored; `SERVER_MODE` is unset.",
				Recommendation: "Replace `GIN_MODE` with `SERVER_MODE=development` for local development, or `SERVER_MODE=production` for deployments.",
			}
		}

		return SecurityCheck{
			ID:             "mode_env",
			Title:          "Server mode environment",
			Status:         selfCheckWarn,
			Severity:       severityHigh,
			Message:        fmt.Sprintf("`GIN_MODE=%s` is set but ignored; `SERVER_MODE` is unset.", ginMode),
			Recommendation: "Replace `GIN_MODE` with `SERVER_MODE=production` in `.env` or the deployment environment, then restart the backend.",
		}
	}

	if ginMode == "release" && cfg.Server.Mode != "production" {
		return SecurityCheck{
			ID:             "mode_env",
			Title:          "Server mode environment",
			Status:         selfCheckWarn,
			Severity:       severityHigh,
			Message:        "`GIN_MODE=release` suggests production, but the backend is not running in production mode.",
			Recommendation: "Set `SERVER_MODE=production` and remove `GIN_MODE` from `.env` or the deployment environment, then restart the backend.",
		}
	}

	return SecurityCheck{
		ID:             "mode_env",
		Title:          "Server mode environment",
		Status:         selfCheckInfo,
		Severity:       severityInfo,
		Message:        "`SERVER_MODE` is set; `GIN_MODE` is ignored by this backend.",
		Recommendation: "Remove the unused `GIN_MODE` variable to avoid confusion.",
	}
}

func checkCORSEnv(getenv func(string) string) SecurityCheck {
	legacy := strings.TrimSpace(getenv("CORS_ORIGINS"))
	current := strings.TrimSpace(getenv("SERVER_CORS_ORIGINS"))

	switch {
	case legacy != "" && current == "":
		return SecurityCheck{
			ID:             "cors_env",
			Title:          "CORS environment variable",
			Status:         selfCheckWarn,
			Severity:       severityHigh,
			Message:        "`CORS_ORIGINS` is set but ignored; the backend reads `SERVER_CORS_ORIGINS`.",
			Recommendation: "Rename `CORS_ORIGINS` to `SERVER_CORS_ORIGINS` in `.env` or the deployment environment, keep the same comma-separated origins, then restart the backend.",
		}
	case legacy != "" && current != "":
		return SecurityCheck{
			ID:             "cors_env",
			Title:          "CORS environment variable",
			Status:         selfCheckWarn,
			Severity:       severityLow,
			Message:        "Both `CORS_ORIGINS` and `SERVER_CORS_ORIGINS` are set; `SERVER_CORS_ORIGINS` wins.",
			Recommendation: "Remove the unused `CORS_ORIGINS` variable from `.env` or the deployment environment to avoid ambiguity.",
		}
	default:
		return SecurityCheck{
			ID:             "cors_env",
			Title:          "CORS environment variable",
			Status:         selfCheckPass,
			Severity:       severityInfo,
			Message:        "No legacy `CORS_ORIGINS` override detected.",
			Recommendation: "No action needed.",
		}
	}
}

func checkCORSWildcard(cfg *config.Config) SecurityCheck {
	origins := cfg.GetCORSOrigins()
	wildcard := false
	for _, origin := range origins {
		if strings.TrimSpace(origin) == "*" {
			wildcard = true
			break
		}
	}

	if wildcard {
		if cfg.IsProduction() {
			return SecurityCheck{
				ID:             "cors_wildcard",
				Title:          "CORS and WebSocket origins",
				Status:         selfCheckFail,
				Severity:       severityHigh,
				Message:        "CORS and WebSocket origins allow every origin (`*`).",
				Recommendation: "Set `SERVER_CORS_ORIGINS=https://your-domain.com` (comma-separated for multiple origins) in `.env` or the deployment environment, then restart the backend. Do not use `*` in production.",
			}
		}

		return SecurityCheck{
			ID:             "cors_wildcard",
			Title:          "CORS and WebSocket origins",
			Status:         selfCheckWarn,
			Severity:       severityMedium,
			Message:        "CORS and WebSocket origins allow every origin (`*`). This is only acceptable for local development.",
			Recommendation: "Before exposing this instance, set `SERVER_CORS_ORIGINS=https://your-domain.com` in `.env` or the deployment environment, then restart the backend.",
		}
	}

	return SecurityCheck{
		ID:             "cors_wildcard",
		Title:          "CORS and WebSocket origins",
		Status:         selfCheckPass,
		Severity:       severityInfo,
		Message:        fmt.Sprintf("CORS and WebSocket origins use an explicit allowlist (%d entries).", len(origins)),
		Recommendation: "No action needed.",
	}
}

func checkExternalURL(cfg *config.Config) SecurityCheck {
	raw := strings.TrimSpace(cfg.Server.ExternalURL)

	if raw == "" {
		return SecurityCheck{
			ID:             "external_url",
			Title:          "External URL",
			Status:         selfCheckFail,
			Severity:       severityHigh,
			Message:        "`EXTERNAL_URL` is empty.",
			Recommendation: "Set `EXTERNAL_URL=https://your-domain.com` in `.env` or the deployment environment, then restart the backend.",
		}
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return SecurityCheck{
			ID:             "external_url",
			Title:          "External URL",
			Status:         selfCheckFail,
			Severity:       severityHigh,
			Message:        "`EXTERNAL_URL` is not a valid absolute URL.",
			Recommendation: "Set `EXTERNAL_URL` to the full public URL, for example `https://your-domain.com`, in `.env` or the deployment environment, then restart the backend.",
		}
	}

	if strings.EqualFold(parsed.Scheme, "https") {
		return SecurityCheck{
			ID:             "external_url",
			Title:          "External URL",
			Status:         selfCheckPass,
			Severity:       severityInfo,
			Message:        "`EXTERNAL_URL` uses HTTPS.",
			Recommendation: "No action needed.",
		}
	}

	if cfg.IsDevelopment() && isLoopbackHost(parsed.Hostname()) {
		return SecurityCheck{
			ID:             "external_url",
			Title:          "External URL",
			Status:         selfCheckWarn,
			Severity:       severityLow,
			Message:        "`EXTERNAL_URL` uses HTTP for a local address.",
			Recommendation: "Keep the localhost URL for development. Set `EXTERNAL_URL=https://your-domain.com` before exposing this instance publicly.",
		}
	}

	return SecurityCheck{
		ID:             "external_url",
		Title:          "External URL",
		Status:         selfCheckFail,
		Severity:       severityHigh,
		Message:        "`EXTERNAL_URL` does not use HTTPS.",
		Recommendation: "Set `EXTERNAL_URL=https://your-domain.com` in `.env` or the deployment environment, ensure TLS is terminated by Traefik/nginx, then restart the backend.",
	}
}

func isLoopbackHost(host string) bool {
	switch strings.ToLower(host) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

func overallSelfCheckStatus(checks []SecurityCheck) string {
	overall := selfCheckPass
	for _, check := range checks {
		switch check.Status {
		case selfCheckFail:
			return selfCheckFail
		case selfCheckWarn:
			overall = selfCheckWarn
		}
	}
	return overall
}
