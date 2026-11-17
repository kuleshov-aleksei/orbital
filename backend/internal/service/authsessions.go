package service

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

// Per-device sign-in sessions. Every JWT issued at sign-in carries a "sid"
// claim pointing at an auth_sessions row; deleting the row signs that one
// device out. Tokens issued before sessions existed have no sid and are
// still checked against users.token_version until they are refreshed (a
// refresh moves them onto a session).

// ErrSessionRevoked means the token's session no longer exists or doesn't
// match the user.
var ErrSessionRevoked = errors.New("session has been revoked")

// SessionMeta describes the device behind a request.
type SessionMeta struct {
	UserAgent string
	Client    string // X-Orbital-Client ("android/1.5.2"), empty on web/desktop
	IP        string
}

const maxSessionMetaLen = 512

func (m SessionMeta) trimmed() SessionMeta {
	cut := func(v string) string {
		v = strings.TrimSpace(v)
		if len(v) > maxSessionMetaLen {
			v = v[:maxSessionMetaLen]
		}
		return v
	}
	return SessionMeta{UserAgent: cut(m.UserAgent), Client: cut(m.Client), IP: cut(m.IP)}
}

// SetSessionRepository enables per-device sessions. Without it (memory-only
// mode) sign-ins issue legacy session-less tokens.
func (s *AuthService) SetSessionRepository(repo *repository.AuthSessionRepository) {
	s.sessions = repo
}

// StartSession records a new signed-in device and issues its token.
func (s *AuthService) StartSession(user *models.User, meta SessionMeta) (string, time.Time, error) {
	if s.sessions == nil {
		return s.GenerateJWT(user)
	}
	id, err := randomToken()
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to create session id: %w", err)
	}
	meta = meta.trimmed()
	now := time.Now().UTC()
	expiry := now.Add(TokenLifetime)
	if err := s.sessions.Create(&models.AuthSession{
		ID:           id,
		UserID:       user.ID,
		CreatedAt:    now,
		LastActiveAt: now,
		ExpiresAt:    expiry,
		UserAgent:    meta.UserAgent,
		Client:       meta.Client,
		IP:           meta.IP,
	}); err != nil {
		return "", time.Time{}, fmt.Errorf("failed to create session: %w", err)
	}
	token, err := s.signJWT(user, id, expiry)
	return token, expiry, err
}

// RefreshSession slides the token's session forward and re-issues its token
// with the same sid. A legacy token is moved onto a new session.
func (s *AuthService) RefreshSession(claims *models.JWTClaims, user *models.User, meta SessionMeta) (string, time.Time, error) {
	if s.sessions == nil {
		return s.GenerateJWT(user)
	}
	if claims.SessionID == "" {
		return s.StartSession(user, meta)
	}
	expiry := time.Now().UTC().Add(TokenLifetime)
	if err := s.sessions.Extend(claims.SessionID, expiry); err != nil {
		return "", time.Time{}, fmt.Errorf("failed to extend session: %w", err)
	}
	token, err := s.signJWT(user, claims.SessionID, expiry)
	return token, expiry, err
}

// CheckSession reports whether a validated token is still live for user.
func (s *AuthService) CheckSession(claims *models.JWTClaims, user *models.User) error {
	if claims.SessionID == "" || s.sessions == nil {
		if claims.TokenVersion != user.TokenVersion {
			return ErrSessionRevoked
		}
		return nil
	}
	session, err := s.sessions.Get(claims.SessionID)
	if err != nil {
		return fmt.Errorf("failed to load session: %w", err)
	}
	if session == nil || session.UserID != user.ID || time.Now().After(session.ExpiresAt) {
		return ErrSessionRevoked
	}
	return nil
}

// TouchSession records activity on a session (throttled by the repository).
func (s *AuthService) TouchSession(sessionID string, meta SessionMeta) {
	if s.sessions == nil || sessionID == "" {
		return
	}
	meta = meta.trimmed()
	_ = s.sessions.Touch(sessionID, time.Now().UTC(), meta.UserAgent, meta.Client, meta.IP)
}

// ListSessions returns the user's signed-in devices for Settings → Security.
func (s *AuthService) ListSessions(userID, currentSessionID string) ([]models.AuthSessionInfo, error) {
	out := []models.AuthSessionInfo{}
	if s.sessions == nil {
		return out, nil
	}
	sessions, err := s.sessions.ListForUser(userID)
	if err != nil {
		return nil, err
	}
	for _, session := range sessions {
		platform, name := DescribeDevice(session.UserAgent, session.Client)
		out = append(out, models.AuthSessionInfo{
			AuthSession: *session,
			Platform:    platform,
			DeviceName:  name,
			Current:     session.ID == currentSessionID,
		})
	}
	return out, nil
}

// EndSession signs one device out. It reports false when the session doesn't
// exist or belongs to another user.
func (s *AuthService) EndSession(userID, sessionID string) (bool, error) {
	if s.sessions == nil || sessionID == "" {
		return false, nil
	}
	return s.sessions.Delete(userID, sessionID)
}

// EndOtherSessions signs out every device of the user except keepSessionID,
// including legacy session-less tokens (token_version bump; tokens with a
// sid don't check it). It returns the removed session ids.
func (s *AuthService) EndOtherSessions(userID, keepSessionID string) ([]string, error) {
	if s.sessions == nil || s.userRepo == nil {
		return nil, fmt.Errorf("sessions unavailable")
	}
	if keepSessionID == "" {
		return nil, fmt.Errorf("current token has no session")
	}
	ids, err := s.sessions.DeleteOthers(userID, keepSessionID)
	if err != nil {
		return nil, err
	}
	if err := s.userRepo.IncrementTokenVersion(userID); err != nil {
		return ids, err
	}
	return ids, nil
}

// DescribeDevice turns a session's User-Agent and X-Orbital-Client into a
// platform ("web" | "desktop" | "android") and a readable name such as
// "Chrome on Windows". Substring heuristics only: it labels, it never gates.
func DescribeDevice(userAgent, client string) (platform, name string) {
	if p, version := ParseClientID(client); p == "android" {
		if version != "" {
			return "android", "Orbital for Android " + version
		}
		return "android", "Orbital for Android"
	}

	os := deviceOS(userAgent)
	if strings.Contains(userAgent, "Electron/") {
		if os != "" {
			return "desktop", "Orbital desktop on " + os
		}
		return "desktop", "Orbital desktop"
	}

	browser := deviceBrowser(userAgent)
	switch {
	case browser != "" && os != "":
		return "web", browser + " on " + os
	case browser != "":
		return "web", browser
	case os != "":
		return "web", "Browser on " + os
	}
	return "web", "Unknown device"
}

func deviceOS(ua string) string {
	switch {
	case strings.Contains(ua, "Android"):
		return "Android"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		return "iOS"
	case strings.Contains(ua, "Windows"):
		return "Windows"
	case strings.Contains(ua, "Mac OS X"), strings.Contains(ua, "Macintosh"):
		return "macOS"
	case strings.Contains(ua, "CrOS"):
		return "ChromeOS"
	case strings.Contains(ua, "Linux"):
		return "Linux"
	}
	return ""
}

func deviceBrowser(ua string) string {
	// Order matters: Edge and Opera UAs also contain "Chrome", and Chrome's
	// contains "Safari".
	switch {
	case strings.Contains(ua, "Edg/"):
		return "Edge"
	case strings.Contains(ua, "OPR/"):
		return "Opera"
	case strings.Contains(ua, "Firefox/"), strings.Contains(ua, "FxiOS/"):
		return "Firefox"
	case strings.Contains(ua, "Chrome/"), strings.Contains(ua, "CriOS/"):
		return "Chrome"
	case strings.Contains(ua, "Safari/"):
		return "Safari"
	}
	return ""
}
