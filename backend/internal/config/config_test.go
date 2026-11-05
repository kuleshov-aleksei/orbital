package config

import (
	"testing"
)

func TestDefaultRateLimitConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.RateLimit.AuthPerMinute != 10 {
		t.Errorf("AuthPerMinute = %d, want 10", cfg.RateLimit.AuthPerMinute)
	}
	if cfg.RateLimit.GuestPerHour != 10 {
		t.Errorf("GuestPerHour = %d, want 10", cfg.RateLimit.GuestPerHour)
	}
	if cfg.RateLimit.OAuthPerMinute != 20 {
		t.Errorf("OAuthPerMinute = %d, want 20", cfg.RateLimit.OAuthPerMinute)
	}
	if cfg.RateLimit.GuestUploadPerHour != 5 {
		t.Errorf("GuestUploadPerHour = %d, want 5", cfg.RateLimit.GuestUploadPerHour)
	}
	if cfg.RateLimit.UserUploadPerHour != 20 {
		t.Errorf("UserUploadPerHour = %d, want 20", cfg.RateLimit.UserUploadPerHour)
	}
	if cfg.RateLimit.DebugLogPerMinute != 1 {
		t.Errorf("DebugLogPerMinute = %d, want 1", cfg.RateLimit.DebugLogPerMinute)
	}
	if cfg.RateLimit.QRChallengePerMinute != 10 {
		t.Errorf("QRChallengePerMinute = %d, want 10", cfg.RateLimit.QRChallengePerMinute)
	}
	if cfg.RateLimit.QRApprovePerMinute != 30 {
		t.Errorf("QRApprovePerMinute = %d, want 30", cfg.RateLimit.QRApprovePerMinute)
	}
	if cfg.RateLimit.AudioQuotaBytes() != 512*1024*1024 {
		t.Errorf("AudioQuotaBytes = %d, want 512MiB", cfg.RateLimit.AudioQuotaBytes())
	}
	if cfg.RateLimit.DebugLogQuotaBytes() != 100*1024*1024 {
		t.Errorf("DebugLogQuotaBytes = %d, want 100MiB", cfg.RateLimit.DebugLogQuotaBytes())
	}
}

func TestLoadRateLimitEnvOverrides(t *testing.T) {
	t.Setenv("RATE_LIMIT_AUTH_PER_MINUTE", "11")
	t.Setenv("RATE_LIMIT_GUEST_PER_HOUR", "12")
	t.Setenv("RATE_LIMIT_OAUTH_PER_MINUTE", "13")
	t.Setenv("RATE_LIMIT_GUEST_UPLOAD_PER_HOUR", "14")
	t.Setenv("RATE_LIMIT_USER_UPLOAD_PER_HOUR", "15")
	t.Setenv("RATE_LIMIT_DEBUG_LOG_PER_MINUTE", "16")
	t.Setenv("RATE_LIMIT_QR_CHALLENGE_PER_MINUTE", "17")
	t.Setenv("RATE_LIMIT_QR_APPROVE_PER_MINUTE", "18")
	t.Setenv("RATE_LIMIT_AUDIO_QUOTA_MB", "19")
	t.Setenv("RATE_LIMIT_DEBUG_LOG_QUOTA_MB", "20")

	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.RateLimit.AuthPerMinute != 11 ||
		cfg.RateLimit.GuestPerHour != 12 ||
		cfg.RateLimit.OAuthPerMinute != 13 ||
		cfg.RateLimit.GuestUploadPerHour != 14 ||
		cfg.RateLimit.UserUploadPerHour != 15 ||
		cfg.RateLimit.DebugLogPerMinute != 16 ||
		cfg.RateLimit.QRChallengePerMinute != 17 ||
		cfg.RateLimit.QRApprovePerMinute != 18 ||
		cfg.RateLimit.AudioQuotaMB != 19 ||
		cfg.RateLimit.DebugLogQuotaMB != 20 {
		t.Fatalf("rate limit env overrides not applied: %+v", cfg.RateLimit)
	}
}

func TestRateLimitValidateRejectsNonPositive(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RateLimit.AuthPerMinute = 0

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected non-positive rate limit to fail validation")
	}
}
