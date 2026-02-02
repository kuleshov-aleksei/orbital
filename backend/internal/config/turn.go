package config

import (
	"os"
	"strings"
)

// TURNConfig holds TURN server configuration
type TURNConfig struct {
	// Shared secret for TURN REST API authentication
	SharedSecret string

	// TURN server URLs
	TURNURL    string
	TURNTLSURL string

	// STUN server URLs (comma-separated)
	STUNURLs string

	// Realm for TURN authentication
	Realm string

	// Credential lifetime in seconds (default: 86400 = 24 hours)
	CredentialLifetime int
}

// DefaultTURNConfig returns default TURN configuration from environment variables
func DefaultTURNConfig() *TURNConfig {
	return &TURNConfig{
		SharedSecret:       getEnv("TURN_SECRET", "pink-goose"),
		TURNURL:            getEnv("TURN_URL", "turn:192.168.1.169:3478"),
		TURNTLSURL:         getEnv("TURN_TLS_URL", "turns:192.168.1.169:5349"),
		STUNURLs:           getEnv("STUN_URLS", "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"),
		Realm:              getEnv("TURN_REALM", "orbital"),
		CredentialLifetime: 86400, // 24 hours
	}
}

// GetSTUNServers returns slice of STUN server URLs
func (c *TURNConfig) GetSTUNServers() []string {
	if c.STUNURLs == "" {
		return []string{}
	}
	return strings.Split(c.STUNURLs, ",")
}

// getEnv retrieves environment variable with fallback default
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
