package config

// RoomConfig contains configuration for room settings
var RoomConfig = struct {
	MinUsers        int
	MaxUsers        int
	DefaultMaxUsers int
}{
	MinUsers:        2,
	MaxUsers:        10,
	DefaultMaxUsers: 10,
}
