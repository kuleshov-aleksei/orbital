// Package push sends mobile push notifications (Firebase Cloud Messaging).
package push

import (
	"context"
	"log"
	"time"
)

// Notification is one push shown by the Android app.
type Notification struct {
	Title string
	Body  string
	// Tag replaces an earlier notification with the same tag on the device
	// (one notification per channel instead of a stack).
	Tag string
	// Data reaches the app when the user taps the notification.
	Data map[string]string
}

// Sender delivers a notification to device tokens. It returns the tokens
// the provider reported as no longer valid.
type Sender interface {
	Send(ctx context.Context, tokens []string, n Notification) (invalid []string, err error)
}

// DeviceStore is the token storage (repository.PushDeviceRepository).
type DeviceStore interface {
	TokensForUser(userID string) ([]string, error)
	Delete(token string) error
}

// Service fans notifications out to a user's devices in the background.
type Service struct {
	sender  Sender
	devices DeviceStore
	timeout time.Duration
	// sync runs sends inline (tests).
	sync bool
}

// NewService returns a push service; nil sender or store disables it.
func NewService(sender Sender, devices DeviceStore) *Service {
	return &Service{sender: sender, devices: devices, timeout: 15 * time.Second}
}

// NewSyncService is NewService with sends done on the caller's goroutine.
func NewSyncService(sender Sender, devices DeviceStore) *Service {
	s := NewService(sender, devices)
	s.sync = true
	return s
}

// Enabled reports whether pushes can be sent.
func (s *Service) Enabled() bool {
	return s != nil && s.sender != nil && s.devices != nil
}

// NotifyUser sends n to every device of userID. It never blocks on the
// provider: the send runs in the background with a timeout.
func (s *Service) NotifyUser(userID string, n Notification) {
	if !s.Enabled() {
		return
	}
	tokens, err := s.devices.TokensForUser(userID)
	if err != nil {
		log.Printf("[Push] Failed to load devices of %s: %v", userID, err)
		return
	}
	if len(tokens) == 0 {
		return
	}
	if s.sync {
		s.send(userID, tokens, n)
		return
	}
	go s.send(userID, tokens, n)
}

func (s *Service) send(userID string, tokens []string, n Notification) {
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	invalid, err := s.sender.Send(ctx, tokens, n)
	if err != nil {
		log.Printf("[Push] Failed to notify %s: %v", userID, err)
	}
	for _, t := range invalid {
		if err := s.devices.Delete(t); err != nil {
			log.Printf("[Push] Failed to drop invalid token: %v", err)
		}
	}
}
