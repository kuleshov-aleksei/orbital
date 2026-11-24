package service

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service/mail"
)

const testPassword = "s3cret-pass!"

// lastTo returns the token of the newest mail sent to addr.
func (c *captureSender) lastTo(t *testing.T, addr string) (mail.Message, string) {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := len(c.sent) - 1; i >= 0; i-- {
		if strings.EqualFold(c.sent[i].To, addr) {
			m := tokenInLink.FindStringSubmatch(c.sent[i].Text)
			token := ""
			if m != nil {
				token = m[1]
			}
			return c.sent[i], token
		}
	}
	t.Fatalf("no mail to %s", addr)
	return mail.Message{}, ""
}

func (c *captureSender) sentTo(addr string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, m := range c.sent {
		if strings.EqualFold(m.To, addr) {
			n++
		}
	}
	return n
}

func (e *emailEnv) session(t *testing.T, u *models.User) *models.JWTClaims {
	t.Helper()
	token, _, err := e.auth.StartSession(u, SessionMeta{})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := e.auth.ValidateJWT(token)
	if err != nil {
		t.Fatal(err)
	}
	return claims
}

func (e *emailEnv) disableMail() {
	e.svc.mailer = mail.NewMailer(nil, e.logs, "Orbital")
}

// changeEmail requests and confirms an email change, returning the user.
func (e *emailEnv) changeEmail(t *testing.T, u *models.User, password, to string) *models.User {
	t.Helper()
	pending, err := e.svc.RequestEmailChange(u.ID, password, to)
	if err != nil || !pending {
		t.Fatalf("RequestEmailChange(%s) = %v, %v", to, pending, err)
	}
	e.wait()
	_, token := e.sender.lastTo(t, to)
	got, err := e.svc.ConfirmEmailChange(token)
	if err != nil {
		t.Fatalf("ConfirmEmailChange: %v", err)
	}
	e.wait()
	e.clock = e.clock.Add(EmailCooldown)
	return got
}

func TestChangePassword(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "ivan@example.com", "ivan"))
	current := env.session(t, u)
	other := env.session(t, u)

	if err := env.svc.ChangePassword(u.ID, current.SessionID, "wrong-pass1!", "n3w-passw0rd!"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong current password = %v", err)
	}
	if err := env.svc.ChangePassword(u.ID, current.SessionID, testPassword, "short"); err == nil {
		t.Fatal("weak password accepted")
	}
	if err := env.svc.ChangePassword(u.ID, "", testPassword, "n3w-passw0rd!"); !errors.Is(err, ErrNoSession) {
		t.Fatalf("legacy token = %v", err)
	}
	before := env.sender.count()
	if err := env.svc.ChangePassword(u.ID, current.SessionID, testPassword, "n3w-passw0rd!"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	env.wait()

	fresh, _ := env.users.GetByID(u.ID)
	if err := env.auth.CheckSession(current, fresh); err != nil {
		t.Fatalf("current session after change = %v", err)
	}
	if err := env.auth.CheckSession(other, fresh); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("other session after change = %v, want revoked", err)
	}
	if _, err := env.auth.LoginPassword(u.Email, "n3w-passw0rd!"); err != nil {
		t.Fatalf("new password: %v", err)
	}
	if env.sender.count() != before+1 {
		t.Fatalf("notices = %d, want 1", env.sender.count()-before)
	}
	msg, token := env.sender.lastTo(t, u.Email)
	if !strings.Contains(msg.Subject, "password was changed") || token != "" {
		t.Fatalf("notice = %q (token %q)", msg.Subject, token)
	}
}

func TestChangePasswordNoNoticeWhenUnverified(t *testing.T) {
	env := newEmailEnv(t)
	u := env.register(t, "jade@example.com", "jade")
	s := env.session(t, u)
	if err := env.svc.ChangePassword(u.ID, s.SessionID, testPassword, "n3w-passw0rd!"); err != nil {
		t.Fatal(err)
	}
	env.wait()
	if n := env.sender.count(); n != 0 {
		t.Fatalf("mails to unverified address = %d", n)
	}
}

func TestChangePasswordRejectsOAuth(t *testing.T) {
	env := newEmailEnv(t)
	u := &models.User{
		ID: "qkUrdzLDoqslx8EEy2cM7Q==", Nickname: "kai", OriginalNickname: "kai",
		AuthProvider: models.AuthProviderDiscord, ProviderID: "1234", Email: "kai@example.com",
		CreatedAt: time.Now(), LastSeen: time.Now(), Role: models.RoleUser,
	}
	if err := env.users.Create(u); err != nil {
		t.Fatal(err)
	}
	if err := env.svc.ChangePassword(u.ID, "sid", "x", "n3w-passw0rd!"); !errors.Is(err, ErrNotPasswordAccount) {
		t.Fatalf("OAuth = %v", err)
	}
	if _, err := env.svc.RequestEmailChange(u.ID, "x", "kai2@example.com"); !errors.Is(err, ErrNotPasswordAccount) {
		t.Fatalf("OAuth email change = %v", err)
	}
}

func TestEmailChangeFlow(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "lena@example.com", "lena"))
	env.register(t, "taken@example.com", "taken")

	if _, err := env.svc.RequestEmailChange(u.ID, "wrong-pass1!", "lena2@example.com"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password = %v", err)
	}
	if _, err := env.svc.RequestEmailChange(u.ID, testPassword, "LENA@example.com"); !errors.Is(err, ErrSameEmail) {
		t.Fatalf("same email = %v", err)
	}
	if _, err := env.svc.RequestEmailChange(u.ID, testPassword, "Taken@Example.com"); !errors.Is(err, ErrEmailInUse) {
		t.Fatalf("taken email = %v", err)
	}
	if _, err := env.svc.RequestEmailChange(u.ID, testPassword, "not-an-email"); !errors.Is(err, ErrInvalidEmail) {
		t.Fatalf("malformed email = %v", err)
	}

	pending, err := env.svc.RequestEmailChange(u.ID, testPassword, "lena2@example.com")
	if err != nil || !pending {
		t.Fatalf("request = %v, %v", pending, err)
	}
	env.wait()
	if fresh, _ := env.users.GetByID(u.ID); fresh.Email != "lena@example.com" {
		t.Fatalf("email changed before confirmation: %s", fresh.Email)
	}
	msg, token := env.sender.lastTo(t, "lena2@example.com")
	if !strings.Contains(msg.Text, "https://orb.example.com/confirm-email?token=") {
		t.Fatalf("confirm link = %q", msg.Text)
	}

	updated, err := env.svc.ConfirmEmailChange(token)
	if err != nil {
		t.Fatalf("ConfirmEmailChange: %v", err)
	}
	if updated.Email != "lena2@example.com" || !updated.EmailVerified {
		t.Fatalf("after confirm = %s verified=%v", updated.Email, updated.EmailVerified)
	}
	if _, err := env.svc.ConfirmEmailChange(token); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("reused confirm token = %v", err)
	}
	env.wait()

	notice, undo := env.sender.lastTo(t, "lena@example.com")
	if !strings.Contains(notice.Text, "l•••@example.com") || !strings.Contains(notice.Text, "/restore-email?token=") || undo == "" {
		t.Fatalf("old-address notice = %q", notice.Text)
	}
	entries, _ := env.logs.List(1, 0)
	if len(entries) != 1 || entries[0].Purpose != mail.PurposeEmailChanged || strings.Contains(entries[0].Body, undo) || !strings.Contains(entries[0].Body, mail.Redacted) {
		t.Fatalf("log entry = %+v", entries)
	}
}

func TestEmailChangeTokenExpires(t *testing.T) {
	env := newEmailEnv(t)
	u := env.register(t, "mila@example.com", "mila")
	if _, err := env.svc.RequestEmailChange(u.ID, testPassword, "mila2@example.com"); err != nil {
		t.Fatal(err)
	}
	env.wait()
	_, token := env.sender.lastTo(t, "mila2@example.com")
	env.clock = env.clock.Add(EmailChangeTokenTTL + time.Second)
	if _, err := env.svc.ConfirmEmailChange(token); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("expired confirm = %v", err)
	}
}

func TestEmailChangeFromUnverifiedSendsNoUndo(t *testing.T) {
	env := newEmailEnv(t)
	u := env.register(t, "nora@example.com", "nora")
	env.changeEmail(t, u, testPassword, "nora2@example.com")
	if n := env.sender.sentTo("nora@example.com"); n != 0 {
		t.Fatalf("mails to unverified old address = %d", n)
	}
}

func TestEmailChangeWithoutSMTPAppliesDirectly(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "olga@example.com", "olga"))
	env.disableMail()
	pending, err := env.svc.RequestEmailChange(u.ID, testPassword, "olga2@example.com")
	if err != nil || pending {
		t.Fatalf("request = %v, %v", pending, err)
	}
	fresh, _ := env.users.GetByID(u.ID)
	if fresh.Email != "olga2@example.com" || fresh.EmailVerified {
		t.Fatalf("after direct change = %s verified=%v", fresh.Email, fresh.EmailVerified)
	}
	s := env.session(t, fresh)
	if err := env.svc.ChangePassword(u.ID, s.SessionID, testPassword, "n3w-passw0rd!"); err != nil {
		t.Fatalf("password change without SMTP: %v", err)
	}
}

func TestRestoreEmail(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "petra@example.com", "petra"))
	attacker := env.session(t, u)

	env.changeEmail(t, u, testPassword, "evil@example.com")
	_, undo := env.sender.lastTo(t, "petra@example.com")

	if _, err := env.svc.RestoreEmail(undo, "short"); err == nil || errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("weak password = %v", err)
	}
	restored, err := env.svc.RestoreEmail(undo, "n3w-passw0rd!")
	if err != nil {
		t.Fatalf("RestoreEmail: %v", err)
	}
	if restored.Email != "petra@example.com" || !restored.EmailVerified {
		t.Fatalf("restored = %s verified=%v", restored.Email, restored.EmailVerified)
	}
	if err := env.auth.CheckSession(attacker, restored); !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("attacker session = %v, want revoked", err)
	}
	if _, err := env.auth.LoginPassword("petra@example.com", testPassword); err == nil {
		t.Fatal("old password still works")
	}
	if _, err := env.svc.RestoreEmail(undo, "an0ther-pass!"); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("reused undo = %v", err)
	}
	env.wait()
	msg, _ := env.sender.lastTo(t, "petra@example.com")
	if !strings.Contains(msg.Subject, "password was changed") {
		t.Fatalf("last mail to restored address = %q", msg.Subject)
	}
}

// A second change must not cancel the owner's undo link, and the attacker's
// own undo link (to an address they control) must not undo the owner's
// restore.
func TestRestoreSurvivesChainedChanges(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "quinn@example.com", "quinn"))

	env.changeEmail(t, u, testPassword, "evil1@example.com")
	_, ownerUndo := env.sender.lastTo(t, "quinn@example.com")
	env.changeEmail(t, u, testPassword, "evil2@example.com")
	_, attackerUndo := env.sender.lastTo(t, "evil1@example.com")

	// The attacker rolls back to evil1: the owner's older link still works.
	if _, err := env.svc.RestoreEmail(attackerUndo, "att4cker-pass!"); err != nil {
		t.Fatalf("attacker restore: %v", err)
	}
	env.clock = env.clock.Add(time.Second)
	restored, err := env.svc.RestoreEmail(ownerUndo, "own3r-pass!")
	if err != nil || restored.Email != "quinn@example.com" {
		t.Fatalf("owner restore = %+v, %v", restored, err)
	}
}

func TestRestoreDropsLaterUndoLinks(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "rosa@example.com", "rosa"))

	env.changeEmail(t, u, testPassword, "evil1@example.com")
	_, ownerUndo := env.sender.lastTo(t, "rosa@example.com")
	env.changeEmail(t, u, testPassword, "evil2@example.com")
	_, attackerUndo := env.sender.lastTo(t, "evil1@example.com")

	if _, err := env.svc.RestoreEmail(ownerUndo, "own3r-pass!"); err != nil {
		t.Fatalf("owner restore: %v", err)
	}
	if _, err := env.svc.RestoreEmail(attackerUndo, "att4cker-pass!"); !errors.Is(err, ErrInvalidEmailToken) {
		t.Fatalf("later undo after owner restore = %v, want invalid", err)
	}
}

func TestRestoreRefusesTakenAddress(t *testing.T) {
	env := newEmailEnv(t)
	u := env.verify(t, env.register(t, "sara@example.com", "sara"))
	env.changeEmail(t, u, testPassword, "sara2@example.com")
	_, undo := env.sender.lastTo(t, "sara@example.com")
	env.register(t, "sara@example.com", "sara-new")

	if _, err := env.svc.RestoreEmail(undo, "n3w-passw0rd!"); !errors.Is(err, ErrEmailInUse) {
		t.Fatalf("restore to taken address = %v", err)
	}
}
