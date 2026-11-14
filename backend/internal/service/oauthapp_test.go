package service

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
)

const testUserID = "qkUrdzLDoqslx8EEy2cM7Q=="

func testChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func newOAuthAppTestService() *AuthService {
	return NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, nil)
}

func TestAppLoginCodeRedeemsOnceWithMatchingVerifier(t *testing.T) {
	s := newOAuthAppTestService()
	verifier := "app-verifier-0123456789-0123456789-0123456789"
	code, err := s.IssueAppLoginCode(testUserID, "state-1", testChallenge(verifier))
	if err != nil {
		t.Fatalf("IssueAppLoginCode: %v", err)
	}

	userID, err := s.RedeemAppLoginCode(code, "state-1", verifier)
	if err != nil {
		t.Fatalf("RedeemAppLoginCode: %v", err)
	}
	if userID != testUserID {
		t.Fatalf("user id = %q, want %q", userID, testUserID)
	}

	if _, err := s.RedeemAppLoginCode(code, "state-1", verifier); err == nil {
		t.Fatal("code was redeemed twice")
	}
}

func TestAppLoginCodeRejectsWrongStateOrVerifierAndBurns(t *testing.T) {
	cases := []struct {
		name, state, verifier string
	}{
		{"wrong state", "other-state", "good-verifier"},
		{"wrong verifier", "state-1", "attacker-verifier"},
		{"challenge as verifier", "state-1", testChallenge("good-verifier")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newOAuthAppTestService()
			code, err := s.IssueAppLoginCode(testUserID, "state-1", testChallenge("good-verifier"))
			if err != nil {
				t.Fatalf("IssueAppLoginCode: %v", err)
			}
			if _, err := s.RedeemAppLoginCode(code, tc.state, tc.verifier); err == nil {
				t.Fatal("redeem succeeded, want error")
			}
			// A failed attempt burns the code: no retries with other guesses.
			if _, err := s.RedeemAppLoginCode(code, "state-1", "good-verifier"); err == nil {
				t.Fatal("code still usable after a failed attempt")
			}
		})
	}
}

func TestAppLoginCodeExpires(t *testing.T) {
	s := newOAuthAppTestService()
	code, err := s.IssueAppLoginCode(testUserID, "state-1", testChallenge("v"))
	if err != nil {
		t.Fatalf("IssueAppLoginCode: %v", err)
	}
	s.appCodeMu.Lock()
	entry := s.appCodes[code]
	entry.ExpiresAt = time.Now().Add(-time.Second)
	s.appCodes[code] = entry
	s.appCodeMu.Unlock()

	if _, err := s.RedeemAppLoginCode(code, "state-1", "v"); err == nil {
		t.Fatal("expired code was accepted")
	}
}

func TestGenerateStateRequiresChallengeOnlyForAndroid(t *testing.T) {
	s := newOAuthAppTestService()
	challenge := testChallenge("v")

	if _, _, err := s.GenerateState(models.AuthProviderGoogle, OAuthClientAndroid, ""); err == nil {
		t.Error("android state without challenge was accepted")
	}
	if _, _, err := s.GenerateState(models.AuthProviderGoogle, OAuthClientElectron, challenge); err == nil {
		t.Error("electron state with challenge was accepted")
	}

	state, _, err := s.GenerateState(models.AuthProviderGoogle, OAuthClientAndroidDev, challenge)
	if err != nil {
		t.Fatalf("GenerateState: %v", err)
	}
	got, err := s.ConsumeState(state)
	if err != nil {
		t.Fatalf("ConsumeState: %v", err)
	}
	if got.Client != OAuthClientAndroidDev || got.AppChallenge != challenge {
		t.Fatalf("state = %+v, want android-dev client with challenge", got)
	}
}

func TestParseOAuthClient(t *testing.T) {
	for in, want := range map[string]OAuthClient{
		"":            OAuthClientWeb,
		"web":         OAuthClientWeb,
		"electron":    OAuthClientElectron,
		"android":     OAuthClientAndroid,
		"android-dev": OAuthClientAndroidDev,
	} {
		got, ok := ParseOAuthClient(in)
		if !ok || got != want {
			t.Errorf("ParseOAuthClient(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	if _, ok := ParseOAuthClient("orbital://evil"); ok {
		t.Error("unknown client accepted")
	}
	if OAuthClientWeb.AppCallbackURL() != "" || OAuthClientElectron.AppCallbackURL() != "" {
		t.Error("non-Android clients must not have a deep-link callback")
	}
}
