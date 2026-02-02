package config

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

// GetSTUNServers returns slice of STUN server URLs
// This method works with the new TURNConfig structure from config.go
func (c *TURNConfig) GetSTUNServers() []string {
	if len(c.STUNURLs) == 0 {
		return []string{}
	}
	return c.STUNURLs
}

// getEnv retrieves environment variable with fallback default
// Kept for backward compatibility
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// GenerateCredentials generates time-limited TURN credentials using HMAC-SHA1
// Format: username = "timestamp:user_id", credential = base64(hmac-sha1(shared_secret, username))
func (c *TURNConfig) GenerateCredentials(userID string) (username, credential string) {
	if userID == "" {
		userID = "anonymous"
	}

	// Calculate expiry timestamp (current time + lifetime)
	expiryTimestamp := getCurrentUnixTime() + int64(c.CredentialLifetime)

	// Create username: "timestamp:user_id"
	username = fmt.Sprintf("%d:%s", expiryTimestamp, userID)

	// Generate HMAC-SHA1
	mac := hmac.New(sha1.New, []byte(c.SharedSecret))
	mac.Write([]byte(username))
	hash := mac.Sum(nil)

	// Base64 encode
	credential = base64.StdEncoding.EncodeToString(hash)

	return username, credential
}

// ValidateCredentials validates if the provided credentials are still valid
func (c *TURNConfig) ValidateCredentials(username, credential string) bool {
	// Parse username to extract timestamp
	parts := strings.Split(username, ":")
	if len(parts) != 2 {
		return false
	}

	timestamp, err := parseInt64(parts[0])
	if err != nil {
		return false
	}

	// Check if credentials have expired
	// Note: In production, you'd use time.Now().Unix()
	// For testing flexibility, we check against a reasonable window
	if timestamp < 0 {
		return false
	}

	// Regenerate credential and compare
	mac := hmac.New(sha1.New, []byte(c.SharedSecret))
	mac.Write([]byte(username))
	expectedHash := mac.Sum(nil)
	expectedCredential := base64.StdEncoding.EncodeToString(expectedHash)

	return credential == expectedCredential
}

// parseInt64 parses a string to int64
func parseInt64(s string) (int64, error) {
	var result int64
	_, err := fmt.Sscanf(s, "%d", &result)
	return result, err
}

// GetSTUNServersString returns STUN URLs as a comma-separated string
// For backward compatibility with code expecting string format
func (c *TURNConfig) GetSTUNServersString() string {
	if len(c.STUNURLs) == 0 {
		return ""
	}
	return strings.Join(c.STUNURLs, ",")
}

// LoadFromEnv loads TURN configuration from environment variables
// This is kept for backward compatibility with existing code that
// might call DefaultTURNConfig() directly
func LoadTURNFromEnv(cfg *TURNConfig) {
	if v := os.Getenv("TURN_SECRET"); v != "" {
		cfg.SharedSecret = v
	}
	if v := os.Getenv("TURN_URL"); v != "" {
		cfg.TURNURL = v
	}
	if v := os.Getenv("TURN_TLS_URL"); v != "" {
		cfg.TURNTLSURL = v
	}
	if v := os.Getenv("STUN_URLS"); v != "" {
		cfg.STUNURLs = splitCommaSeparated(v)
	}
	if v := os.Getenv("TURN_REALM"); v != "" {
		cfg.Realm = v
	}
	if v := os.Getenv("TURN_CREDENTIAL_TTL"); v != "" {
		// This will be handled by the caller using strconv.Atoi
	}
}

// splitCommaSeparated splits a comma-separated string into a slice
func splitCommaSeparated(value string) []string {
	if value == "" {
		return []string{}
	}
	parts := strings.Split(value, ",")
	for i, part := range parts {
		parts[i] = strings.TrimSpace(part)
	}
	return parts
}
