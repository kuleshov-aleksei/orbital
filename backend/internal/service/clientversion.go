package service

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
)

// PlatformAndroid is the only platform with a minimum app version: the web
// app is always current, Electron updates itself.
const PlatformAndroid = "android"

// appSettingAndroidMinVersion is the app_settings key of the Android floor.
const appSettingAndroidMinVersion = "android_min_version"

// AppSettingsStore is the persistence ClientVersionService needs
// (repository.AppSettingsRepository).
type AppSettingsStore interface {
	Get(key string) (string, error)
	Set(key, value string) error
}

// ClientVersionService holds the oldest Android app version the backend still
// accepts. Clients identify themselves as "<platform>/<version>"
// (X-Orbital-Client header, ?client= on WebSockets); an Android app below the
// floor is refused so backend changes don't have to stay backward compatible.
// This is a compatibility gate, not a security control: the header is trivial
// to spoof.
type ClientVersionService struct {
	store AppSettingsStore

	mu         sync.RWMutex
	androidMin string

	listenersMu sync.RWMutex
	listeners   []func()
}

// NewClientVersionService loads the stored floor.
func NewClientVersionService(store AppSettingsStore) (*ClientVersionService, error) {
	min, err := store.Get(appSettingAndroidMinVersion)
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", appSettingAndroidMinVersion, err)
	}
	return &ClientVersionService{store: store, androidMin: min}, nil
}

// AndroidMinVersion returns the floor, "" when there is none.
func (s *ClientVersionService) AndroidMinVersion() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.androidMin
}

// SetAndroidMinVersion stores a new floor ("" clears it) and notifies listeners.
func (s *ClientVersionService) SetAndroidMinVersion(v string) error {
	v = strings.TrimSpace(v)
	if v != "" {
		if _, ok := ParseAppVersion(v); !ok {
			return fmt.Errorf("invalid version %q, expected X.Y.Z", v)
		}
	}
	if err := s.store.Set(appSettingAndroidMinVersion, v); err != nil {
		return err
	}
	s.mu.Lock()
	s.androidMin = v
	s.mu.Unlock()

	s.listenersMu.RLock()
	listeners := append([]func(){}, s.listeners...)
	s.listenersMu.RUnlock()
	for _, fn := range listeners {
		fn()
	}
	return nil
}

// OnChange registers a callback run after the floor changes.
func (s *ClientVersionService) OnChange(fn func()) {
	s.listenersMu.Lock()
	defer s.listenersMu.Unlock()
	s.listeners = append(s.listeners, fn)
}

// IsOutdated reports whether a client ("<platform>/<version>", as sent by the
// app) is below its platform's floor. Anything that isn't an Android app with
// a parseable version (web, Electron, dev builds, no header) is never outdated.
func (s *ClientVersionService) IsOutdated(client string) bool {
	platform, version := ParseClientID(client)
	if platform != PlatformAndroid {
		return false
	}
	min := s.AndroidMinVersion()
	if min == "" {
		return false
	}
	have, ok := ParseAppVersion(version)
	if !ok {
		return false
	}
	want, ok := ParseAppVersion(min)
	if !ok {
		return false
	}
	return CompareAppVersions(have, want) < 0
}

// ParseClientID splits "<platform>/<version>".
func ParseClientID(client string) (platform, version string) {
	platform, version, _ = strings.Cut(strings.TrimSpace(client), "/")
	return strings.ToLower(platform), version
}

// ParseAppVersion parses "X.Y.Z", optionally prefixed with "v" and suffixed
// with a build hash ("1.5.0-816skays").
func ParseAppVersion(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	v, _, _ = strings.Cut(v, "-")
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// CompareAppVersions returns -1, 0 or 1.
func CompareAppVersions(a, b [3]int) int {
	for i := range a {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

// MemoryAppSettings is an in-memory AppSettingsStore for runs without a
// database (and tests).
type MemoryAppSettings struct {
	mu     sync.Mutex
	values map[string]string
}

func NewMemoryAppSettings() *MemoryAppSettings {
	return &MemoryAppSettings{values: map[string]string{}}
}

func (m *MemoryAppSettings) Get(key string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.values[key], nil
}

func (m *MemoryAppSettings) Set(key, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if value == "" {
		delete(m.values, key)
	} else {
		m.values[key] = value
	}
	return nil
}
