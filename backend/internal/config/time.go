package config

import (
	"time"
)

// getCurrentUnixTime returns the current Unix timestamp
// This is a variable to allow mocking in tests
var getCurrentUnixTime = func() int64 {
	return time.Now().Unix()
}
