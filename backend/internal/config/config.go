package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// WebSocketConfig holds WebSocket-specific configuration
type WebSocketConfig struct {
	PingTimeout       time.Duration `yaml:"ping_timeout"`
	PingCheckInterval time.Duration `yaml:"ping_check_interval"`
}

// Config holds all application configuration
type Config struct {
	Server    ServerConfig    `yaml:"server"`
	Room      RoomSettings    `yaml:"room"`
	Logging   LoggingConfig   `yaml:"logging"`
	Database  DatabaseConfig  `yaml:"database"`
	Auth      AuthConfig      `yaml:"auth"`
	WebSocket WebSocketConfig `yaml:"websocket"`
	LiveKit   LiveKitConfig   `yaml:"livekit"`
	RateLimit RateLimitConfig `yaml:"rate_limit"`
	Chat      ChatConfig      `yaml:"chat"`
	ChatMedia ChatMediaConfig `yaml:"chat_media"`
}

// ChatConfig configures persistent text channels. Messages are stored in
// Meilisearch; with an empty MeiliURL text channels are disabled.
type ChatConfig struct {
	MeiliURL    string `yaml:"meili_url"`
	MeiliAPIKey string `yaml:"meili_api_key"`
	MeiliIndex  string `yaml:"meili_index"`
}

// Development defaults match the meilisearch service in docker-compose.dev.yml,
// so `make meili-up` plus `make dev` works without extra .env entries. Production must set MEILI_URL.
const (
	devMeiliURL = "http://localhost:7700"
	devMeiliKey = "orbital-dev-meili-key"
)

func (c *Config) applyDevChatDefaults() {
	if !c.IsDevelopment() || c.Chat.MeiliURL != "" {
		return
	}
	c.Chat.MeiliURL = devMeiliURL
	if c.Chat.MeiliAPIKey == "" {
		c.Chat.MeiliAPIKey = devMeiliKey
	}
}

// TextChannelsEnabled reports whether a Meilisearch backend is configured.
func (c ChatConfig) TextChannelsEnabled() bool { return c.MeiliURL != "" }

// ChatMediaConfig configures text channel attachments on S3 (Garage), see
// docs/specs/CHAT_SYSTEM.md §7.12. Without endpoint, bucket and keys,
// attachments are disabled.
type ChatMediaConfig struct {
	S3Endpoint string `yaml:"s3_endpoint"`
	// S3PublicEndpoint is signed into presigned URLs; defaults to S3Endpoint.
	S3PublicEndpoint string `yaml:"s3_public_endpoint"`
	Bucket           string `yaml:"bucket"`
	AccessKey        string `yaml:"access_key"`
	SecretKey        string `yaml:"secret_key"`
	Region           string `yaml:"region"`
	MaxImageMB       int    `yaml:"max_image_mb"`
	MaxAudioMB       int    `yaml:"max_audio_mb"`
	MaxVideoMB       int    `yaml:"max_video_mb"`
	// QuotaMB is the per-user attachment storage.
	QuotaMB int `yaml:"quota_mb"`
	// UploadsPerHour is the per-user upload rate.
	UploadsPerHour int `yaml:"uploads_per_hour"`
}

// Enabled reports whether S3 is configured.
func (c ChatMediaConfig) Enabled() bool {
	return c.S3Endpoint != "" && c.Bucket != "" && c.AccessKey != "" && c.SecretKey != ""
}

// PublicEndpoint is the host for presigned URLs.
func (c ChatMediaConfig) PublicEndpoint() string {
	if c.S3PublicEndpoint != "" {
		return c.S3PublicEndpoint
	}
	return c.S3Endpoint
}

func (c ChatMediaConfig) QuotaBytes() int64 { return int64(c.QuotaMB) * 1024 * 1024 }

// Development default matches the garage service in docker-compose.dev.yml;
// its key comes from GARAGE_DEFAULT_ACCESS_KEY/SECRET_KEY in .env.
const devChatMediaEndpoint = "http://localhost:3900"

func (c *Config) applyDevChatMediaDefaults() {
	if !c.IsDevelopment() || c.ChatMedia.S3Endpoint != "" {
		return
	}
	c.ChatMedia.S3Endpoint = devChatMediaEndpoint
	if c.ChatMedia.AccessKey == "" {
		c.ChatMedia.AccessKey = os.Getenv("GARAGE_DEFAULT_ACCESS_KEY")
	}
	if c.ChatMedia.SecretKey == "" {
		c.ChatMedia.SecretKey = os.Getenv("GARAGE_DEFAULT_SECRET_KEY")
	}
	if v := os.Getenv("GARAGE_DEFAULT_BUCKET"); v != "" && os.Getenv("CHAT_MEDIA_S3_BUCKET") == "" {
		c.ChatMedia.Bucket = v
	}
}

type RateLimitConfig struct {
	AuthPerMinute        int `yaml:"auth_per_minute"`
	GuestPerHour         int `yaml:"guest_per_hour"`
	OAuthPerMinute       int `yaml:"oauth_per_minute"`
	GuestUploadPerHour   int `yaml:"guest_upload_per_hour"`
	UserUploadPerHour    int `yaml:"user_upload_per_hour"`
	DebugLogPerMinute    int `yaml:"debug_log_per_minute"`
	QRChallengePerMinute int `yaml:"qr_challenge_per_minute"`
	QRApprovePerMinute   int `yaml:"qr_approve_per_minute"`
	AudioQuotaMB         int `yaml:"audio_quota_mb"`
	DebugLogQuotaMB      int `yaml:"debug_log_quota_mb"`
}

// AuthConfig holds OAuth and JWT configuration
type AuthConfig struct {
	JWTSecret                  string              `yaml:"jwt_secret"`
	Discord                    OAuthProviderConfig `yaml:"discord"`
	Google                     OAuthProviderConfig `yaml:"google"`
	DiscordElectronRedirectURL string              `yaml:"discord_electron_redirect_url"`
	GoogleElectronRedirectURL  string              `yaml:"google_electron_redirect_url"`
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
	Port                string   `yaml:"port"`
	Mode                string   `yaml:"mode"`
	CORSOrigins         []string `yaml:"cors_origins"`
	ExternalURL         string   `yaml:"external_url"`
	ElectronRedirectURL string   `yaml:"electron_redirect_url"`
	// ReleasesURL is the public update feed (Garage S3) root that serves the
	// Electron artifacts and latest.yml. Used to resolve the newest desktop
	// release for the download page.
	ReleasesURL string `yaml:"releases_url"`
}

// RoomSettings holds room-related configuration
type RoomSettings struct {
	MinUsers        int `yaml:"min_users"`
	MaxUsers        int `yaml:"max_users"`
	DefaultMaxUsers int `yaml:"default_max_users"`
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
			Port:                "8080",
			Mode:                "development",
			CORSOrigins:         []string{"*"},
			ExternalURL:         "http://localhost:5173",
			ElectronRedirectURL: "orbital://auth/callback",
			ReleasesURL:         "https://orbital-updates.encamy.com",
		},
		Room: RoomSettings{
			MinUsers:        2,
			MaxUsers:        10,
			DefaultMaxUsers: 10,
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
				RedirectURL:  "http://localhost:3000/api/auth/discord/callback",
			},
			Google: OAuthProviderConfig{
				ClientID:     "",
				ClientSecret: "",
				RedirectURL:  "http://localhost:3000/api/auth/google/callback",
			},
			DiscordElectronRedirectURL: "http://127.0.0.1:27271/callback",
			GoogleElectronRedirectURL:  "http://127.0.0.1:27271/callback",
		},
		WebSocket: WebSocketConfig{
			PingTimeout:       30 * time.Second,
			PingCheckInterval: 10 * time.Second,
		},
		LiveKit: DefaultLiveKitConfig(),
		Chat: ChatConfig{
			MeiliIndex: "text_messages",
		},
		ChatMedia: ChatMediaConfig{
			Bucket:         "orbital-chat-media",
			Region:         "garage",
			MaxImageMB:     20,
			MaxAudioMB:     25,
			MaxVideoMB:     100,
			QuotaMB:        5120,
			UploadsPerHour: 120,
		},
		RateLimit: RateLimitConfig{
			AuthPerMinute:        10,
			GuestPerHour:         10,
			OAuthPerMinute:       20,
			GuestUploadPerHour:   5,
			UserUploadPerHour:    20,
			DebugLogPerMinute:    1,
			QRChallengePerMinute: 10,
			QRApprovePerMinute:   30,
			AudioQuotaMB:         512,
			DebugLogQuotaMB:      100,
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
	cfg.applyDevChatDefaults()
	cfg.applyDevChatMediaDefaults()

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
	if v := os.Getenv("ELECTRON_REDIRECT_URL"); v != "" {
		c.Server.ElectronRedirectURL = v
	}
	if v := os.Getenv("RELEASES_URL"); v != "" {
		c.Server.ReleasesURL = v
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
	if v := os.Getenv("GOOGLE_ELECTRON_REDIRECT_URL"); v != "" {
		c.Auth.GoogleElectronRedirectURL = v
	}
	if v := os.Getenv("DISCORD_ELECTRON_REDIRECT_URL"); v != "" {
		c.Auth.DiscordElectronRedirectURL = v
	}

	// WebSocket config
	if v := os.Getenv("WS_PING_TIMEOUT"); v != "" {
		if timeout, err := time.ParseDuration(v); err == nil {
			c.WebSocket.PingTimeout = timeout
		}
	}
	if v := os.Getenv("WS_PING_CHECK_INTERVAL"); v != "" {
		if interval, err := time.ParseDuration(v); err == nil {
			c.WebSocket.PingCheckInterval = interval
		}
	}

	// LiveKit config
	c.LiveKit.LoadFromEnv()

	// Text channels (Meilisearch). MEILI_MASTER_KEY is accepted as a fallback
	// so a single key in .env serves both the Meilisearch container and us.
	if v := os.Getenv("MEILI_URL"); v != "" {
		c.Chat.MeiliURL = v
	}
	if v := os.Getenv("MEILI_API_KEY"); v != "" {
		c.Chat.MeiliAPIKey = v
	} else if v := os.Getenv("MEILI_MASTER_KEY"); v != "" && c.Chat.MeiliAPIKey == "" {
		c.Chat.MeiliAPIKey = v
	}
	if v := os.Getenv("MEILI_INDEX"); v != "" {
		c.Chat.MeiliIndex = v
	}

	// Text channel attachments (S3)
	for key, dst := range map[string]*string{
		"CHAT_MEDIA_S3_ENDPOINT":        &c.ChatMedia.S3Endpoint,
		"CHAT_MEDIA_S3_PUBLIC_ENDPOINT": &c.ChatMedia.S3PublicEndpoint,
		"CHAT_MEDIA_S3_BUCKET":          &c.ChatMedia.Bucket,
		"CHAT_MEDIA_S3_ACCESS_KEY":      &c.ChatMedia.AccessKey,
		"CHAT_MEDIA_S3_SECRET_KEY":      &c.ChatMedia.SecretKey,
		"CHAT_MEDIA_S3_REGION":          &c.ChatMedia.Region,
	} {
		if v := os.Getenv(key); v != "" {
			*dst = v
		}
	}
	for key, dst := range map[string]*int{
		"CHAT_MEDIA_MAX_IMAGE_MB":         &c.ChatMedia.MaxImageMB,
		"CHAT_MEDIA_MAX_AUDIO_MB":         &c.ChatMedia.MaxAudioMB,
		"CHAT_MEDIA_MAX_VIDEO_MB":         &c.ChatMedia.MaxVideoMB,
		"CHAT_MEDIA_QUOTA_MB":             &c.ChatMedia.QuotaMB,
		"RATE_LIMIT_CHAT_UPLOAD_PER_HOUR": &c.ChatMedia.UploadsPerHour,
	} {
		if v, ok := getEnvInt(key); ok {
			*dst = v
		}
	}

	// Rate limit and quota config
	if v, ok := getEnvInt("RATE_LIMIT_AUTH_PER_MINUTE"); ok {
		c.RateLimit.AuthPerMinute = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_GUEST_PER_HOUR"); ok {
		c.RateLimit.GuestPerHour = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_OAUTH_PER_MINUTE"); ok {
		c.RateLimit.OAuthPerMinute = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_GUEST_UPLOAD_PER_HOUR"); ok {
		c.RateLimit.GuestUploadPerHour = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_USER_UPLOAD_PER_HOUR"); ok {
		c.RateLimit.UserUploadPerHour = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_DEBUG_LOG_PER_MINUTE"); ok {
		c.RateLimit.DebugLogPerMinute = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_QR_CHALLENGE_PER_MINUTE"); ok {
		c.RateLimit.QRChallengePerMinute = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_QR_APPROVE_PER_MINUTE"); ok {
		c.RateLimit.QRApprovePerMinute = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_AUDIO_QUOTA_MB"); ok {
		c.RateLimit.AudioQuotaMB = v
	}
	if v, ok := getEnvInt("RATE_LIMIT_DEBUG_LOG_QUOTA_MB"); ok {
		c.RateLimit.DebugLogQuotaMB = v
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

// getEnv retrieves environment variable with fallback default
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string) (int, bool) {
	value := os.Getenv(key)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func (c RateLimitConfig) AudioQuotaBytes() int64 {
	return int64(c.AudioQuotaMB) * 1024 * 1024
}

func (c RateLimitConfig) DebugLogQuotaBytes() int64 {
	return int64(c.DebugLogQuotaMB) * 1024 * 1024
}

// IsDevelopment returns true if the server is running in development mode
func (c *Config) IsDevelopment() bool {
	return c.Server.Mode == "development"
}

// IsProduction returns true if the server is running in production mode
func (c *Config) IsProduction() bool {
	return c.Server.Mode == "production"
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
	if err := c.RateLimit.Validate(); err != nil {
		return err
	}
	if err := c.LiveKit.Validate(); err != nil {
		return fmt.Errorf("livekit configuration: %w", err)
	}
	for name, value := range map[string]int{
		"CHAT_MEDIA_MAX_IMAGE_MB":         c.ChatMedia.MaxImageMB,
		"CHAT_MEDIA_MAX_AUDIO_MB":         c.ChatMedia.MaxAudioMB,
		"CHAT_MEDIA_MAX_VIDEO_MB":         c.ChatMedia.MaxVideoMB,
		"CHAT_MEDIA_QUOTA_MB":             c.ChatMedia.QuotaMB,
		"RATE_LIMIT_CHAT_UPLOAD_PER_HOUR": c.ChatMedia.UploadsPerHour,
	} {
		if value <= 0 {
			return fmt.Errorf("%s must be positive", name)
		}
	}
	return nil
}

func (c RateLimitConfig) Validate() error {
	values := map[string]int{
		"RATE_LIMIT_AUTH_PER_MINUTE":         c.AuthPerMinute,
		"RATE_LIMIT_GUEST_PER_HOUR":          c.GuestPerHour,
		"RATE_LIMIT_OAUTH_PER_MINUTE":        c.OAuthPerMinute,
		"RATE_LIMIT_GUEST_UPLOAD_PER_HOUR":   c.GuestUploadPerHour,
		"RATE_LIMIT_USER_UPLOAD_PER_HOUR":    c.UserUploadPerHour,
		"RATE_LIMIT_DEBUG_LOG_PER_MINUTE":    c.DebugLogPerMinute,
		"RATE_LIMIT_QR_CHALLENGE_PER_MINUTE": c.QRChallengePerMinute,
		"RATE_LIMIT_QR_APPROVE_PER_MINUTE":   c.QRApprovePerMinute,
		"RATE_LIMIT_AUDIO_QUOTA_MB":          c.AudioQuotaMB,
		"RATE_LIMIT_DEBUG_LOG_QUOTA_MB":      c.DebugLogQuotaMB,
	}
	for name, value := range values {
		if value <= 0 {
			return fmt.Errorf("%s must be positive", name)
		}
	}
	return nil
}

// String returns a string representation of the configuration (without sensitive data)
func (c *Config) String() string {
	dbConfigured := "no"
	if c.Database.Path != "" {
		dbConfigured = "yes"
	}
	livekitConfigured := "no"
	if c.LiveKit.IsConfigured() {
		livekitConfigured = "yes"
	}
	return fmt.Sprintf(
		"Config{Server: {Port: %s, Mode: %s}, Room: {Min: %d, Max: %d}, Logging: {Level: %s, Requests: %v}, Database: {Configured: %s}, LiveKit: {URL: %s, Configured: %s}}",
		c.Server.Port,
		c.Server.Mode,
		c.Room.MinUsers,
		c.Room.MaxUsers,
		c.Logging.Level,
		c.Logging.RequestLogging,
		dbConfigured,
		c.LiveKit.URL,
		livekitConfigured,
	)
}

// GetCORSOrigins returns CORS origins as a slice
func (c *Config) GetCORSOrigins() []string {
	if len(c.Server.CORSOrigins) == 0 {
		return []string{"*"}
	}
	return c.Server.CORSOrigins
}

// GetReleasesURL returns the public desktop-release feed root
func (c *Config) GetReleasesURL() string {
	if strings.TrimSpace(c.Server.ReleasesURL) == "" {
		return "https://orbital-updates.encamy.com"
	}
	return strings.TrimRight(strings.TrimSpace(c.Server.ReleasesURL), "/")
}

// ShouldLogRequests returns true if request logging is enabled
func (c *Config) ShouldLogRequests() bool {
	return c.Logging.RequestLogging
}

// GetLogLevel returns the logging level
func (c *Config) GetLogLevel() string {
	return c.Logging.Level
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
