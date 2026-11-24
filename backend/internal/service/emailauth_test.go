package service

import (
	"context"
	"errors"
	"path/filepath"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service/mail"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

type captureSender struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (c *captureSender) Send(_ context.Context, msg mail.Message) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, msg)
	return nil
}

func (c *captureSender) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.sent)
}

var tokenInLink = regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)

func (c *captureSender) lastToken(t *testing.T) string {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.sent) == 0 {
		t.Fatal("no mail sent")
	}
	m := tokenInLink.FindStringSubmatch(c.sent[len(c.sent)-1].Text)
	if m == nil {
		t.Fatalf("no token in mail: %q", c.sent[len(c.sent)-1].Text)
	}
	return m[1]
}

type emailEnv struct {
	svc    *EmailAuthService
	auth   *AuthService
	users  *repository.UserRepository
	logs   *repository.EmailLogRepository
	sender *captureSender
	clock  time.Time
	sleeps []time.Duration
}

func newEmailEnv(t *testing.T) *emailEnv {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	users := repository.NewUserRepository(db)
	auth := NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, users)
	auth.SetSessionRepository(repository.NewAuthSessionRepository(db))
	logs := repository.NewEmailLogRepository(db)
	sender := &captureSender{}
	mailer := mail.NewMailer(sender, logs, "Orbital")
	env := &emailEnv{auth: auth, users: users, logs: logs, sender: sender, clock: time.Now()}
	env.svc = NewEmailAuthService(users, repository.NewEmailTokenRepository(db), logs, auth, mailer, "https://orb.example.com/")
	env.svc.now = func() time.Time { return env.clock }
	env.svc.sleep = func(_ context.Context, d time.Duration) { env.sleeps = append(env.sleeps, d) }
	return env
}

func (e *emailEnv) register(t *testing.T, email, nickname string) *models.User {
	t.Helper()
	u, err := e.auth.Register(email, nickname, "s3cret-pass!")
	if err != nil {
		t.Fatal(err)
	}
	u, _ = e.users.GetByID(u.ID)
	return u
}

// wait lets background lookups and sends finish.
func (e *emailEnv) wait() {
	e.svc.pending.Wait()
	e.svc.mailer.Wait()
}

func (e *emailEnv) verify(t *testing.T, u *models.User) *models.User {
	t.Helper()
	if err := e.svc.SendVerification(u); err != nil {
		t.Fatalf("SendVerification: %v", err)
	}
	e.wait()
	got, err := e.svc.VerifyEmail(e.sender.lastToken(t))
	if err != nil || !got.EmailVerified {
		t.Fatalf("VerifyEmail = %+v, %v", got, err)
	}
	e.clock = e.clock.Add(EmailCooldown) // clear cooldowns for the next mail
	return got
}

func TestVerifyEmailFlow(t *testing.T) {
	env := newEmailEnv(t)
	u := env.register(t, "alice@example.com", "alice")
	if u.EmailVerified {
		t.Fatal("new accounts start unverified")
	}
	if err := env.svc.SendVerification(u); err != nil {
		t.Fatal(err)
	}
	env.wait()
	token := env.sender.lastToken(t)
	if got := env.sender.sent[0].Text; !regexp.MustCompile(`https://orb\.example\.com/verify-email\?token=`).MatchString(got) {
		t.Fatalf("link = %q", got)
	}

	// Within the cooldown a second mail is refused.
	if err := env.svc.SendVerification(u); !errors.Is(err, ErrEmailCooldown) {
		t.Fatalf("second send = %v, want cooldown", err)
	}

	verified, err := env.svc.VerifyEmail(token)
	if err != nil || !verified.EmailVerified {
		t.Fatalf("VerifyEmail = %+v, %v", verified, err)
	}
	if _, err := env.svc.VerifyEmail(token); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("reused token = %v, want invalid", err)
	}
	if err := env.svc.SendVerification(verified); !errors.Is(err, ErrAlreadyVerified) {
		t.Fatalf("send to verified = %v", err)
	}

	// The log keeps the mail, never the token.
	entries, _ := env.logs.List(10, 0)
	if len(entries) != 1 || regexp.MustCompile(token).MatchString(entries[0].Body) || entries[0].UserID != u.ID {
		t.Fatalf("log = %+v", entries)
	}
}

func TestVerifyTokenExpiresAndOnlyNewestWorks(t *testing.T) {
	env := newEmailEnv(t)
	u := env.register(t, "bob@example.com", "bob")
	_ = env.svc.SendVerification(u)
	env.wait()
	first := env.sender.lastToken(t)

	env.clock = env.clock.Add(EmailCooldown)
	_ = env.svc.SendVerification(u)
	env.wait()
	second := env.sender.lastToken(t)
	if _, err := env.svc.VerifyEmail(first); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("superseded token = %v, want invalid", err)
	}

	env.clock = env.clock.Add(VerifyTokenTTL + time.Second)
	if _, err := env.svc.VerifyEmail(second); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("expired token = %v, want invalid", err)
	}
}

func TestSendVerificationRejectsNonPasswordAccounts(t *testing.T) {
	env := newEmailEnv(t)
	oauth := &models.User{ID: "qkUrdzLDoqslx8EEy2cM7Q==", AuthProvider: models.AuthProviderGoogle, Email: "g@example.com"}
	if err := env.svc.SendVerification(oauth); !errors.Is(err, ErrNoPasswordEmail) {
		t.Fatalf("oauth = %v", err)
	}
}

// Every branch of forgot-password waits the random delay and none reveals
// anything; only a verified password account gets a mail.
func TestForgotPasswordBranches(t *testing.T) {
	env := newEmailEnv(t)
	unverified := env.register(t, "carol@example.com", "carol")
	verified := env.verify(t, env.register(t, "dave@example.com", "dave"))
	before := env.sender.count()

	for _, email := range []string{"nobody@example.com", "", "not-an-email", unverified.Email} {
		env.svc.RequestPasswordReset(context.Background(), email)
	}
	env.wait()
	if env.sender.count() != before {
		t.Fatalf("mail sent for unknown/unverified email")
	}

	env.svc.RequestPasswordReset(context.Background(), "DAVE@example.com")
	env.wait()
	if env.sender.count() != before+1 {
		t.Fatalf("verified account got %d mails, want 1", env.sender.count()-before)
	}
	if env.sender.sent[len(env.sender.sent)-1].To != verified.Email {
		t.Fatalf("reset went to %q", env.sender.sent[len(env.sender.sent)-1].To)
	}

	if len(env.sleeps) != 5 {
		t.Fatalf("sleeps = %d, want one per request", len(env.sleeps))
	}
	for _, d := range env.sleeps {
		if d < 400*time.Millisecond || d > time.Second {
			t.Fatalf("delay %v outside [400ms, 1s]", d)
		}
	}
}

func TestForgotDelayRange(t *testing.T) {
	for i := 0; i < 500; i++ {
		if d := forgotDelay(); d < 400*time.Millisecond || d > time.Second {
			t.Fatalf("forgotDelay() = %v", d)
		}
	}
}

func TestResetPasswordRevokesSessions(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "erin@example.com", "erin"))

	oldToken, _, err := env.auth.StartSession(u, SessionMeta{})
	if err != nil {
		t.Fatal(err)
	}
	oldClaims, err := env.auth.ValidateJWT(oldToken)
	if err != nil {
		t.Fatal(err)
	}

	env.svc.RequestPasswordReset(context.Background(), u.Email)
	env.wait()
	token := env.sender.lastToken(t)

	// A weak password is refused without spending the link.
	if _, err := env.svc.ResetPassword(token, "short"); err == nil || errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("weak password = %v", err)
	}
	updated, err := env.svc.ResetPassword(token, "n3w-passw0rd!")
	if err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}
	if _, err := env.svc.ResetPassword(token, "an0ther-pass!"); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("reused reset token = %v", err)
	}

	if err := env.auth.CheckSession(oldClaims, updated); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("old session after reset = %v, want revoked", err)
	}
	if _, err := env.auth.LoginPassword(u.Email, "s3cret-pass!"); err == nil {
		t.Fatal("old password still works")
	}
	if _, err := env.auth.LoginPassword(u.Email, "n3w-passw0rd!"); err != nil {
		t.Fatalf("new password: %v", err)
	}
}

func TestResetTokenExpires(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "frank@example.com", "frank"))
	env.svc.RequestPasswordReset(context.Background(), u.Email)
	env.wait()
	token := env.sender.lastToken(t)
	env.clock = env.clock.Add(ResetTokenTTL + time.Second)
	if _, err := env.svc.ResetPassword(token, "n3w-passw0rd!"); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("expired reset = %v", err)
	}
}

func TestEraseRemovesEmailRows(t *testing.T) {
	env := newEmailEnv(t)
	u := env.register(t, "gina@example.com", "gina")
	_ = env.svc.SendVerification(u)
	env.wait()
	token := env.sender.lastToken(t)

	if err := env.users.Erase(u.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if entries, _ := env.logs.List(10, 0); len(entries) != 0 {
		t.Fatalf("email log survived erase: %+v", entries)
	}
	if _, err := env.svc.VerifyEmail(token); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("token survived erase: %v", err)
	}
}

func TestDuplicatePasswordEmailRejectedByDatabase(t *testing.T) {
	env := newEmailEnv(t)
	env.register(t, "hana@example.com", "hana")
	dup := &models.User{
		ID: "qkUrdzLDoqslx8EEy2cM7Q==", Nickname: "hana2", OriginalNickname: "hana2",
		AuthProvider: models.AuthProviderPassword, Email: "HANA@example.com", Role: models.RoleUser,
		CreatedAt: time.Now(), LastSeen: time.Now(),
	}
	if err := env.users.Create(dup); err == nil {
		t.Fatal("second password account with the same email was inserted")
	}
}
