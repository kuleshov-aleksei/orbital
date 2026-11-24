package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service/mail"
)

// Email token lifetimes and limits.
const (
	VerifyTokenTTL    = 24 * time.Hour
	ResetTokenTTL     = time.Hour
	EmailCooldown     = time.Minute
	EmailLogRetain    = 30 * 24 * time.Hour
	forgotMinDelay    = 400 * time.Millisecond
	forgotDelaySpread = 600 * time.Millisecond
)

var (
	// ErrEmailDisabled means no SMTP server is configured.
	ErrEmailDisabled = errors.New("email is not configured")
	// ErrInvalidEmailToken covers unknown, used and expired tokens alike.
	ErrInvalidEmailToken = errors.New("invalid or expired link")
	// ErrEmailCooldown means a mail of that kind went out less than a minute ago.
	ErrEmailCooldown = errors.New("please wait a minute before requesting another email")
	// ErrAlreadyVerified means there is nothing to verify.
	ErrAlreadyVerified = errors.New("email is already verified")
	// ErrNoPasswordEmail means the account has no email of its own to verify
	// (OAuth, guest).
	ErrNoPasswordEmail = errors.New("only email accounts can verify an email")
)

// EmailAuthService runs email verification and password reset.
type EmailAuthService struct {
	users  *repository.UserRepository
	tokens *repository.EmailTokenRepository
	logs   *repository.EmailLogRepository
	auth   *AuthService
	mailer *mail.Mailer
	appURL string

	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration)
	// Background reset lookups; tests wait on it.
	pending sync.WaitGroup

	cooldownMu sync.Mutex
	lastSent   map[string]time.Time
}

// NewEmailAuthService wires the service. appURL is the web app base URL the
// links point at (EXTERNAL_URL).
func NewEmailAuthService(users *repository.UserRepository, tokens *repository.EmailTokenRepository, logs *repository.EmailLogRepository, auth *AuthService, mailer *mail.Mailer, appURL string) *EmailAuthService {
	return &EmailAuthService{
		users:    users,
		tokens:   tokens,
		logs:     logs,
		auth:     auth,
		mailer:   mailer,
		appURL:   strings.TrimRight(appURL, "/"),
		now:      time.Now,
		sleep:    sleepCtx,
		lastSent: make(map[string]time.Time),
	}
}

// Enabled reports whether email can be sent.
func (s *EmailAuthService) Enabled() bool { return s != nil && s.mailer.Enabled() }

// Mailer exposes the mailer (admin test send).
func (s *EmailAuthService) Mailer() *mail.Mailer { return s.mailer }

// SendVerification mails a verification link to a password account.
func (s *EmailAuthService) SendVerification(user *models.User) error {
	if !s.Enabled() {
		return ErrEmailDisabled
	}
	if user.AuthProvider != models.AuthProviderPassword || user.Email == "" || user.DeletedAt != nil {
		return ErrNoPasswordEmail
	}
	if user.EmailVerified {
		return ErrAlreadyVerified
	}
	if !s.takeCooldown(mail.PurposeVerify, user.ID) {
		return ErrEmailCooldown
	}
	token, err := s.issue(user.ID, mail.PurposeVerify, VerifyTokenTTL)
	if err != nil {
		return err
	}
	s.mailer.Queue(user.ID, user.Email, mail.PurposeVerify, mail.Data{
		Nickname:  user.Nickname,
		Link:      s.appURL + "/verify-email?token=" + token,
		ExpiresIn: "24 hours",
	}, token)
	return nil
}

// VerifyEmail redeems a verification token.
func (s *EmailAuthService) VerifyEmail(token string) (*models.User, error) {
	tok, err := s.tokens.Consume(hashEmailToken(token), mail.PurposeVerify, s.now())
	if err != nil {
		return nil, err
	}
	if tok == nil {
		return nil, ErrInvalidEmailToken
	}
	userID := tok.UserID
	user, err := s.users.GetByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.DeletedAt != nil {
		return nil, ErrInvalidEmailToken
	}
	if err := s.users.SetEmailVerifiedAt(userID, s.now().UTC()); err != nil {
		return nil, err
	}
	return s.users.GetByID(userID)
}

// RequestPasswordReset answers the same way for every email, known or not:
// the lookup and the mail run in the background, and the caller always waits
// a random 400 ms–1 s, so neither the result nor the timing reveals whether
// an account exists.
func (s *EmailAuthService) RequestPasswordReset(ctx context.Context, email string) {
	if s.Enabled() {
		email = strings.TrimSpace(email)
		s.pending.Add(1)
		go func() {
			defer s.pending.Done()
			s.sendReset(email)
		}()
	}
	s.sleep(ctx, forgotDelay())
}

func (s *EmailAuthService) sendReset(email string) {
	if email == "" || !strings.Contains(email, "@") {
		return
	}
	provider := models.AuthProviderPassword
	user, err := s.users.GetByEmail(email, &provider)
	if err != nil {
		log.Printf("[EmailAuth] Reset lookup failed: %v", err)
		return
	}
	// Only a verified email gets a reset link: an unverified one may be a
	// typo or someone else's address.
	if user == nil || user.DeletedAt != nil || !user.EmailVerified {
		return
	}
	if !s.takeCooldown(mail.PurposeReset, user.ID) {
		return
	}
	token, err := s.issue(user.ID, mail.PurposeReset, ResetTokenTTL)
	if err != nil {
		log.Printf("[EmailAuth] Failed to issue reset token for %s: %v", user.ID, err)
		return
	}
	s.mailer.Queue(user.ID, user.Email, mail.PurposeReset, mail.Data{
		Nickname:  user.Nickname,
		Link:      s.appURL + "/reset-password?token=" + token,
		ExpiresIn: "1 hour",
	}, token)
}

// ResetPassword sets a new password from a reset token and revokes every
// session of the account. The caller closes sockets and starts a new
// session. The password is checked before the token is spent, so a weak
// password doesn't burn the link.
func (s *EmailAuthService) ResetPassword(token, password string) (*models.User, error) {
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}
	tok, err := s.tokens.Consume(hashEmailToken(token), mail.PurposeReset, s.now())
	if err != nil {
		return nil, err
	}
	if tok == nil {
		return nil, ErrInvalidEmailToken
	}
	userID := tok.UserID
	user, err := s.users.GetByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.DeletedAt != nil || user.AuthProvider != models.AuthProviderPassword {
		return nil, ErrInvalidEmailToken
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	if err := s.users.UpdatePasswordHash(userID, hash); err != nil {
		return nil, err
	}
	// Opening the link proved the inbox is theirs.
	if err := s.users.SetEmailVerifiedAt(userID, s.now().UTC()); err != nil {
		log.Printf("[EmailAuth] Failed to mark %s verified after reset: %v", userID, err)
	}
	if err := s.tokens.DeleteForUser(userID, mail.PurposeReset); err != nil {
		log.Printf("[EmailAuth] Failed to drop reset tokens of %s: %v", userID, err)
	}
	if err := s.auth.RevokeTokens(userID); err != nil {
		return nil, fmt.Errorf("failed to sign out sessions: %w", err)
	}
	updated, err := s.users.GetByID(userID)
	if err != nil {
		return nil, err
	}
	s.notifyPasswordChanged(updated)
	return updated, nil
}

// ListLog returns the sent-mail log, newest first.
func (s *EmailAuthService) ListLog(limit int, beforeID int64) ([]models.EmailLogEntry, error) {
	return s.logs.List(limit, beforeID)
}

// Cleanup drops expired tokens and log entries past retention.
func (s *EmailAuthService) Cleanup() {
	now := s.now()
	if _, err := s.tokens.DeleteExpired(now); err != nil {
		log.Printf("[EmailAuth] Token cleanup failed: %v", err)
	}
	if _, err := s.logs.DeleteOlderThan(now.Add(-EmailLogRetain)); err != nil {
		log.Printf("[EmailAuth] Log cleanup failed: %v", err)
	}
	s.cooldownMu.Lock()
	for key, at := range s.lastSent {
		if now.Sub(at) >= EmailCooldown {
			delete(s.lastSent, key)
		}
	}
	s.cooldownMu.Unlock()
}

// StartCleanupLoop runs Cleanup every interval.
func (s *EmailAuthService) StartCleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		s.Cleanup()
	}
}

// issue makes a token for (user, purpose), replacing older ones.
func (s *EmailAuthService) issue(userID, purpose string, ttl time.Duration) (string, error) {
	return s.issueWith(userID, purpose, "", ttl, true)
}

// issueWith makes a token carrying data. replace false keeps older tokens of
// the same purpose valid.
func (s *EmailAuthService) issueWith(userID, purpose, data string, ttl time.Duration, replace bool) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	now := s.now().UTC()
	store := s.tokens.Replace
	if !replace {
		store = s.tokens.Add
	}
	if err := store(userID, purpose, hashEmailToken(token), data, now.Add(ttl), now); err != nil {
		return "", fmt.Errorf("failed to store token: %w", err)
	}
	return token, nil
}

// takeCooldown allows one mail per purpose and user per EmailCooldown.
func (s *EmailAuthService) takeCooldown(purpose, userID string) bool {
	key := purpose + ":" + userID
	now := s.now()
	s.cooldownMu.Lock()
	defer s.cooldownMu.Unlock()
	if last, ok := s.lastSent[key]; ok && now.Sub(last) < EmailCooldown {
		return false
	}
	s.lastSent[key] = now
	return true
}

func hashEmailToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// forgotDelay is a uniform random delay in [400 ms, 1 s].
func forgotDelay() time.Duration {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(forgotDelaySpread/time.Millisecond)+1))
	if err != nil {
		return forgotMinDelay + forgotDelaySpread/2
	}
	return forgotMinDelay + time.Duration(n.Int64())*time.Millisecond
}

func sleepCtx(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
	case <-ctx.Done():
	}
}
