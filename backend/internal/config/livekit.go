package config

import (
	"fmt"
	"os"
)

// LiveKitConfig holds LiveKit SFU server configuration
type LiveKitConfig struct {
	// URL is the WebSocket URL to the LiveKit server (e.g., ws://localhost:7880)
	URL string `yaml:"url"`

	// APIKey is the API key for generating access tokens
	APIKey string `yaml:"api_key"`

	// APISecret is the secret key for signing access tokens
	APISecret string `yaml:"api_secret"`
}

// DefaultLiveKitConfig returns LiveKit configuration with sensible defaults
func DefaultLiveKitConfig() LiveKitConfig {
	return LiveKitConfig{
		URL:       "ws://localhost:7880",
		APIKey:    "dev_key",
		APISecret: "this_is_a_development_secret_key_32chars",
	}
}

// LoadFromEnv loads LiveKit configuration from environment variables
func (c *LiveKitConfig) LoadFromEnv() {
	if v := os.Getenv("LIVEKIT_URL"); v != "" {
		c.URL = v
	}
	if v := os.Getenv("LIVEKIT_API_KEY"); v != "" {
		c.APIKey = v
	}
	if v := os.Getenv("LIVEKIT_API_SECRET"); v != "" {
		c.APISecret = v
	}
}

// Validate validates the LiveKit configuration
func (c *LiveKitConfig) Validate() error {
	if c.URL == "" {
		return fmt.Errorf("livekit URL is required")
	}
	if c.APIKey == "" {
		return fmt.Errorf("livekit API key is required")
	}
	if c.APISecret == "" {
		return fmt.Errorf("livekit API secret is required")
	}
	return nil
}

// IsConfigured returns true if LiveKit is properly configured
func (c *LiveKitConfig) IsConfigured() bool {
	return c.URL != "" && c.APIKey != "" && c.APISecret != ""
}

// GetLiveKitConfig returns the LiveKit configuration section
// This provides backward compatibility with existing code
func (c *Config) GetLiveKitConfig() *LiveKitConfig {
	return &c.LiveKit
}
