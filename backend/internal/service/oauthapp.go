package service

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"time"
)

// OAuthClient is the kind of client that started an OAuth flow. It decides
// which provider redirect URI is used and where the callback sends the user.
type OAuthClient string

const (
	// OAuthClientWeb: browser tab; the callback redirects to the web frontend.
	OAuthClientWeb OAuthClient = "web"
	// OAuthClientElectron: desktop app; the callback redirects to the loopback
	// server in electron/main/features/oauth.ts.
	OAuthClientElectron OAuthClient = "electron"
	// OAuthClientAndroid / OAuthClientAndroidDev: the Android app (production /
	// "Orbital Dev" build). The callback redirects to the app's deep link with a
	// one-time code. Both builds can be installed side by side, so each has its
	// own URL scheme (manifest placeholder oauthScheme in app/build.gradle).
	OAuthClientAndroid    OAuthClient = "android"
	OAuthClientAndroidDev OAuthClient = "android-dev"
)

// appLoginCodeTTL bounds how long a deep-link login code can be redeemed.
// The app redeems it right after Android hands it the URL.
const appLoginCodeTTL = 60 * time.Second

// ParseOAuthClient maps the `client` query value of /api/auth/{provider}/url.
// The legacy `electron=true` flag is handled by the caller.
func ParseOAuthClient(value string) (OAuthClient, bool) {
	switch OAuthClient(value) {
	case "", OAuthClientWeb:
		return OAuthClientWeb, true
	case OAuthClientElectron, OAuthClientAndroid, OAuthClientAndroidDev:
		return OAuthClient(value), true
	}
	return "", false
}

// IsAndroid reports whether the flow finishes through the app deep link.
func (c OAuthClient) IsAndroid() bool {
	return c == OAuthClientAndroid || c == OAuthClientAndroidDev
}

// UsesAppRedirect reports whether the flow uses the app OAuth registration
// (the "electron" redirect URI). Android reuses Electron's registration so the
// provider apps need no new redirect URI; only the final hop differs.
func (c OAuthClient) UsesAppRedirect() bool {
	return c == OAuthClientElectron || c.IsAndroid()
}

// AppCallbackURL is the deep link the Android app listens on. It comes from a
// fixed list, never from request input.
func (c OAuthClient) AppCallbackURL() string {
	switch c {
	case OAuthClientAndroid:
		return "orbital://auth/callback"
	case OAuthClientAndroidDev:
		return "orbital-dev://auth/callback"
	}
	return ""
}

// ValidAppChallenge reports whether s looks like an S256 PKCE challenge:
// base64url (no padding) of a SHA-256 digest.
func ValidAppChallenge(s string) bool {
	b, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil && len(b) == sha256.Size
}

type appLoginCodeEntry struct {
	UserID    string
	State     string
	Challenge string
	ExpiresAt time.Time
}

// IssueAppLoginCode creates a single-use code for the Android deep link. The
// JWT never travels in the deep link: another app could register the same URL
// scheme and receive it. The code alone is useless without the state and the
// verifier that only the app which started the flow holds.
func (s *AuthService) IssueAppLoginCode(userID, state, challenge string) (string, error) {
	if userID == "" || state == "" || !ValidAppChallenge(challenge) {
		return "", fmt.Errorf("invalid app login code request")
	}
	code, err := randomToken()
	if err != nil {
		return "", err
	}

	now := time.Now()
	s.appCodeMu.Lock()
	s.pruneAppCodesLocked(now)
	s.appCodes[code] = appLoginCodeEntry{
		UserID:    userID,
		State:     state,
		Challenge: challenge,
		ExpiresAt: now.Add(appLoginCodeTTL),
	}
	s.appCodeMu.Unlock()
	return code, nil
}

// RedeemAppLoginCode burns a deep-link login code and returns its user ID when
// the state and PKCE verifier match. A code is gone after the first attempt,
// successful or not.
func (s *AuthService) RedeemAppLoginCode(code, state, verifier string) (string, error) {
	if code == "" || state == "" || verifier == "" {
		return "", fmt.Errorf("missing code, state or verifier")
	}

	now := time.Now()
	s.appCodeMu.Lock()
	entry, ok := s.appCodes[code]
	delete(s.appCodes, code)
	s.pruneAppCodesLocked(now)
	s.appCodeMu.Unlock()

	if !ok || now.After(entry.ExpiresAt) {
		return "", fmt.Errorf("invalid or expired login code")
	}
	if subtle.ConstantTimeCompare([]byte(state), []byte(entry.State)) != 1 {
		return "", fmt.Errorf("state mismatch")
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(challenge), []byte(entry.Challenge)) != 1 {
		return "", fmt.Errorf("verifier mismatch")
	}
	return entry.UserID, nil
}

func (s *AuthService) pruneAppCodesLocked(now time.Time) {
	for code, entry := range s.appCodes {
		if now.After(entry.ExpiresAt) {
			delete(s.appCodes, code)
		}
	}
}

// randomToken returns 32 random bytes as unpadded base64url.
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
