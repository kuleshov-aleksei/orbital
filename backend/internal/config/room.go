package config

import (
	"strconv"
)

// RoomConfig provides backward compatibility for existing code
// that references config.RoomConfig directly
// This is deprecated - use cfg.GetRoomConfig() instead
var RoomConfig = struct {
	MinUsers        int
	MaxUsers        int
	DefaultMaxUsers int
}{
	MinUsers:        2,
	MaxUsers:        10,
	DefaultMaxUsers: 10,
}

// InitializeRoomConfig updates the legacy RoomConfig variable from a Config instance
// This should be called after loading the main config
func InitializeRoomConfig(cfg *Config) {
	RoomConfig.MinUsers = cfg.Room.MinUsers
	RoomConfig.MaxUsers = cfg.Room.MaxUsers
	RoomConfig.DefaultMaxUsers = cfg.Room.DefaultMaxUsers
}

// ParseRoomConfigFromEnv loads room configuration from environment variables
// This is for backward compatibility
func ParseRoomConfigFromEnv() {
	if v := getEnv("ROOM_MIN_USERS", ""); v != "" {
		if min, err := strconv.Atoi(v); err == nil {
			RoomConfig.MinUsers = min
		}
	}
	if v := getEnv("ROOM_MAX_USERS", ""); v != "" {
		if max, err := strconv.Atoi(v); err == nil {
			RoomConfig.MaxUsers = max
		}
	}
	if v := getEnv("ROOM_DEFAULT_MAX_USERS", ""); v != "" {
		if def, err := strconv.Atoi(v); err == nil {
			RoomConfig.DefaultMaxUsers = def
		}
	}
}
