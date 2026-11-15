package websocket

import (
	"sync"
	"time"
)

// A client resends a queued message (offline outbox) with the same nonce when
// it never saw the server's echo, e.g. the link died right after sending. The
// hub remembers which message each (user, nonce) created so a resend gets the
// original message back instead of creating a duplicate.
const (
	sentNonceTTL = 24 * time.Hour
	// Expired entries are swept at most this often (lazily, on writes).
	sentNonceSweepEvery = 10 * time.Minute
)

type nonceState int

const (
	nonceNew nonceState = iota
	nonceInFlight
	nonceDone
)

type sentNonce struct {
	messageID string // empty while the first send is still being processed
	at        time.Time
}

type sentNonces struct {
	mu        sync.Mutex
	entries   map[string]sentNonce
	lastSweep time.Time
	now       func() time.Time
}

func newSentNonces() *sentNonces {
	return &sentNonces{entries: make(map[string]sentNonce), now: time.Now}
}

func nonceKey(userID, nonce string) string { return userID + "|" + nonce }

// claim reserves a nonce for a new message. When the nonce was already used it
// reports the message it created (nonceDone) or that the first send is still
// running (nonceInFlight).
func (s *sentNonces) claim(userID, nonce string) (string, nonceState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.sweepLocked(now)
	key := nonceKey(userID, nonce)
	if e, ok := s.entries[key]; ok && now.Sub(e.at) < sentNonceTTL {
		if e.messageID == "" {
			return "", nonceInFlight
		}
		return e.messageID, nonceDone
	}
	s.entries[key] = sentNonce{at: now}
	return "", nonceNew
}

// complete records the message a claimed nonce created.
func (s *sentNonces) complete(userID, nonce, messageID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[nonceKey(userID, nonce)] = sentNonce{messageID: messageID, at: s.now()}
}

// release forgets a claim whose send failed, so a retry is processed anew.
func (s *sentNonces) release(userID, nonce string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := nonceKey(userID, nonce)
	if e, ok := s.entries[key]; ok && e.messageID == "" {
		delete(s.entries, key)
	}
}

func (s *sentNonces) sweepLocked(now time.Time) {
	if now.Sub(s.lastSweep) < sentNonceSweepEvery {
		return
	}
	s.lastSweep = now
	for key, e := range s.entries {
		if now.Sub(e.at) >= sentNonceTTL {
			delete(s.entries, key)
		}
	}
}
