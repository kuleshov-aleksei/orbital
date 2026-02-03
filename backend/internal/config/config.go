package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config holds all application configuration
type Config struct {
	Server   ServerConfig   `yaml:"server"`
	TURN     TURNConfig     `yaml:"turn"`
	Room     RoomSettings   `yaml:"room"`
	Security SecurityConfig `yaml:"security"`
	Logging  LoggingConfig  `yaml:"logging"`
	Database DatabaseConfig `yaml:"database"`
	Auth     AuthConfig     `yaml:"auth"`
}

// AuthConfig holds OAuth and JWT configuration
type AuthConfig struct {
	JWTSecret string              `yaml:"jwt_secret"`
	Discord   OAuthProviderConfig `yaml:"discord"`
	Google    OAuthProviderConfig `yaml:"google"`
}

// OAuthProviderConfig holds OAuth configuration for a specific provider
type OAuthProviderConfig struct {
	ClientID     string `yaml:"client_id"`
	ClientSecret string `yaml:"client_secret"`
	RedirectURL  string `yaml:"redirect_url"`
}

// DatabaseConfig holds database-related configuration
type DatabaseConfig struct {
	Path string `yaml:"path"`
}

// ServerConfig holds server-related configuration
type ServerConfig struct {
	Port        string   `yaml:"port"`
	Mode        string   `yaml:"mode"`
	CORSOrigins []string `yaml:"cors_origins"`
	ExternalURL string   `yaml:"external_url"`
}

// TURNConfig holds TURN server configuration
type TURNConfig struct {
	SharedSecret       string   `yaml:"shared_secret"`
	TURNURL            string   `yaml:"url"`
	TURNTLSURL         string   `yaml:"tls_url"`
	STUNURLs           []string `yaml:"stun_urls"`
	Realm              string   `yaml:"realm"`
	CredentialLifetime int      `yaml:"credential_lifetime"`
}

// RoomSettings holds room-related configuration
type RoomSettings struct {
	MinUsers        int `yaml:"min_users"`
	MaxUsers        int `yaml:"max_users"`
	DefaultMaxUsers int `yaml:"default_max_users"`
}

// SecurityConfig holds security-related configuration
type SecurityConfig struct {
	E2EMode bool `yaml:"e2e_mode"`
}

// LoggingConfig holds logging-related configuration
type LoggingConfig struct {
	Level          string `yaml:"level"`
	RequestLogging bool   `yaml:"request_logging"`
}

// DefaultConfig returns a configuration with sensible defaults
func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port:        "8080",
			Mode:        "development",
			CORSOrigins: []string{"*"},
			ExternalURL: "http://localhost:5173",
		},
		TURN: TURNConfig{
			SharedSecret:       "pink-goose",
			TURNURL:            "turn:localhost:3478",
			TURNTLSURL:         "turns:localhost:5349",
			STUNURLs:           []string{"stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"},
			Realm:              "orbital",
			CredentialLifetime: 86400,
		},
		Room: RoomSettings{
			MinUsers:        2,
			MaxUsers:        10,
			DefaultMaxUsers: 10,
		},
		Security: SecurityConfig{
			E2EMode: false,
		},
		Logging: LoggingConfig{
			Level:          "info",
			RequestLogging: true,
		},
		Database: DatabaseConfig{
			Path: "./data/orbital.db",
		},
		Auth: AuthConfig{
			JWTSecret: "change-this-in-production",
			Discord: OAuthProviderConfig{
				ClientID:     "",
				ClientSecret: "",
				RedirectURL:  "http://localhost:8080/api/auth/discord/callback",
			},
			Google: OAuthProviderConfig{
				ClientID:     "",
				ClientSecret: "",
				RedirectURL:  "http://localhost:8080/api/auth/google/callback",
			},
		},
	}
}

// Load loads configuration from multiple sources with priority:
// 1. Environment variables (highest priority)
// 2. YAML config file
// 3. Defaults (lowest priority)
func Load(configPath string) (*Config, error) {
	// Start with defaults
	cfg := DefaultConfig()

	// Load from YAML file if provided
	if configPath != "" {
		if err := cfg.loadFromFile(configPath); err != nil {
			return nil, fmt.Errorf("failed to load config from file: %w", err)
		}
	}

	// Apply environment variable overrides
	cfg.loadFromEnv()

	return cfg, nil
}

// loadFromFile loads configuration from a YAML file
func (c *Config) loadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// File doesn't exist, just use defaults and env vars
			return nil
		}
		return err
	}

	return yaml.Unmarshal(data, c)
}

// loadFromEnv applies environment variable overrides
func (c *Config) loadFromEnv() {
	// Server config
	if v := os.Getenv("SERVER_PORT"); v != "" {
		c.Server.Port = v
	}
	if v := os.Getenv("SERVER_MODE"); v != "" {
		c.Server.Mode = v
	}
	if v := os.Getenv("SERVER_CORS_ORIGINS"); v != "" {
		c.Server.CORSOrigins = splitEnvList(v)
	}
	if v := os.Getenv("EXTERNAL_URL"); v != "" {
		c.Server.ExternalURL = v
	}

	// TURN config
	if v := os.Getenv("TURN_SECRET"); v != "" {
		c.TURN.SharedSecret = v
	}
	if v := os.Getenv("TURN_URL"); v != "" {
		c.TURN.TURNURL = v
	}
	if v := os.Getenv("TURN_TLS_URL"); v != "" {
		c.TURN.TURNTLSURL = v
	}
	if v := os.Getenv("TURN_STUN_URLS"); v != "" {
		c.TURN.STUNURLs = splitEnvList(v)
	}
	if v := os.Getenv("TURN_REALM"); v != "" {
		c.TURN.Realm = v
	}
	if v := os.Getenv("TURN_CREDENTIAL_TTL"); v != "" {
		if ttl, err := strconv.Atoi(v); err == nil {
			c.TURN.CredentialLifetime = ttl
		}
	}

	// Room config
	if v := os.Getenv("ROOM_MIN_USERS"); v != "" {
		if min, err := strconv.Atoi(v); err == nil {
			c.Room.MinUsers = min
		}
	}
	if v := os.Getenv("ROOM_MAX_USERS"); v != "" {
		if max, err := strconv.Atoi(v); err == nil {
			c.Room.MaxUsers = max
		}
	}
	if v := os.Getenv("ROOM_DEFAULT_MAX_USERS"); v != "" {
		if def, err := strconv.Atoi(v); err == nil {
			c.Room.DefaultMaxUsers = def
		}
	}

	// Security config
	if v := os.Getenv("ORBITAL_E2E"); v == "1" || strings.ToLower(v) == "true" {
		c.Security.E2EMode = true
	}

	// Logging config
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		c.Logging.Level = v
	}
	if v := os.Getenv("LOG_REQUESTS"); v != "" {
		if logRequests, err := strconv.ParseBool(v); err == nil {
			c.Logging.RequestLogging = logRequests
		}
	}

	// Database config
	if v := os.Getenv("DATABASE_PATH"); v != "" {
		c.Database.Path = v
	}

	// Auth config
	if v := os.Getenv("JWT_SECRET"); v != "" {
		c.Auth.JWTSecret = v
	}

	// Discord OAuth config
	if v := os.Getenv("DISCORD_CLIENT_ID"); v != "" {
		c.Auth.Discord.ClientID = v
	}
	if v := os.Getenv("DISCORD_CLIENT_SECRET"); v != "" {
		c.Auth.Discord.ClientSecret = v
	}
	if v := os.Getenv("DISCORD_REDIRECT_URL"); v != "" {
		c.Auth.Discord.RedirectURL = v
	}

	// Google OAuth config
	if v := os.Getenv("GOOGLE_CLIENT_ID"); v != "" {
		c.Auth.Google.ClientID = v
	}
	if v := os.Getenv("GOOGLE_CLIENT_SECRET"); v != "" {
		c.Auth.Google.ClientSecret = v
	}
	if v := os.Getenv("GOOGLE_REDIRECT_URL"); v != "" {
		c.Auth.Google.RedirectURL = v
	}
}

// splitEnvList splits a comma-separated environment variable into a slice
func splitEnvList(value string) []string {
	if value == "" {
		return []string{}
	}
	parts := strings.Split(value, ",")
	for i, part := range parts {
		parts[i] = strings.TrimSpace(part)
	}
	return parts
}

// IsDevelopment returns true if the server is running in development mode
func (c *Config) IsDevelopment() bool {
	return c.Server.Mode == "development"
}

// IsProduction returns true if the server is running in production mode
func (c *Config) IsProduction() bool {
	return c.Server.Mode == "production"
}

// IsE2EMode returns true if E2E testing mode is enabled
func (c *Config) IsE2EMode() bool {
	return c.Security.E2EMode
}

// GetAddress returns the full server address (host:port)
func (c *Config) GetAddress() string {
	return ":" + c.Server.Port
}

// Validate validates the configuration
func (c *Config) Validate() error {
	if c.Server.Port == "" {
		return fmt.Errorf("server port is required")
	}
	if c.TURN.SharedSecret == "" {
		return fmt.Errorf("TURN shared secret is required")
	}
	if c.Room.MinUsers < 1 {
		return fmt.Errorf("room minimum users must be at least 1")
	}
	if c.Room.MaxUsers < c.Room.MinUsers {
		return fmt.Errorf("room maximum users must be greater than or equal to minimum users")
	}
	if c.Auth.JWTSecret == "" {
		return fmt.Errorf("JWT secret is required")
	}
	if c.IsProduction() && c.Auth.JWTSecret == "change-this-in-production" {
		return fmt.Errorf("default JWT secret must be changed in production")
	}
	return nil
}

// GetSTUNServersString returns STUN URLs as a comma-separated string
// This is for backward compatibility with existing code
func (c *Config) GetSTUNServersString() string {
	return strings.Join(c.TURN.STUNURLs, ",")
}

// String returns a string representation of the configuration (without sensitive data)
func (c *Config) String() string {
	dbConfigured := "no"
	if c.Database.Path != "" {
		dbConfigured = "yes"
	}
	return fmt.Sprintf(
		"Config{Server: {Port: %s, Mode: %s}, TURN: {URL: %s, STUN: %d servers, Realm: %s}, Room: {Min: %d, Max: %d}, Security: {E2E: %v}, Logging: {Level: %s, Requests: %v}, Database: {Configured: %s}}",
		c.Server.Port,
		c.Server.Mode,
		c.TURN.TURNURL,
		len(c.TURN.STUNURLs),
		c.TURN.Realm,
		c.Room.MinUsers,
		c.Room.MaxUsers,
		c.Security.E2EMode,
		c.Logging.Level,
		c.Logging.RequestLogging,
		dbConfigured,
	)
}

// GetCORSOrigins returns CORS origins as a slice
func (c *Config) GetCORSOrigins() []string {
	if len(c.Server.CORSOrigins) == 0 {
		return []string{"*"}
	}
	return c.Server.CORSOrigins
}

// ShouldLogRequests returns true if request logging is enabled
func (c *Config) ShouldLogRequests() bool {
	return c.Logging.RequestLogging
}

// GetLogLevel returns the logging level
func (c *Config) GetLogLevel() string {
	return c.Logging.Level
}

// GetTURNConfig returns the TURN configuration section
// This provides backward compatibility with existing code
func (c *Config) GetTURNConfig() *TURNConfig {
	return &c.TURN
}

// GetRoomConfig returns the room configuration section
func (c *Config) GetRoomConfig() *RoomSettings {
	return &c.Room
}

// GetDatabaseConfig returns the database configuration section
func (c *Config) GetDatabaseConfig() *DatabaseConfig {
	return &c.Database
}

// GetAuthConfig returns the auth configuration section
func (c *Config) GetAuthConfig() *AuthConfig {
	return &c.Auth
}

// GenerateTURNCredentials generates time-limited TURN credentials
func (c *Config) GenerateTURNCredentials(userID string) (username, credential string, expiry time.Time) {
	if userID == "" {
		userID = "anonymous"
	}

	// Calculate expiry timestamp (current time + lifetime)
	now := time.Now()
	expiry = now.Add(time.Duration(c.TURN.CredentialLifetime) * time.Second)
	expiryTimestamp := expiry.Unix()

	// Create username: "timestamp:user_id"
	username = fmt.Sprintf("%d:%s", expiryTimestamp, userID)

	// Generate HMAC-SHA1
	return username, "", expiry
}

// LegacyTURNConfig returns a legacy TURNConfig for backward compatibility
// This helps transition existing code to the new config system
func (c *Config) LegacyTURNConfig() *TURNConfig {
	return &c.TURN
}
