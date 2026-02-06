// Package version provides build-time version information
package version

// Version is set at build time via -ldflags
// Format: {semver}-{short_commit_hash} (e.g., 1.0.0-816skays)
var Version = "dev-unknown"

// GetVersion returns the current application version
func GetVersion() string {
	return Version
}
