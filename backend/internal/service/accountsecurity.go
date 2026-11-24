package service

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service/mail"
)

// Email change token lifetimes.
const (
	EmailChangeTokenTTL = 24 * time.Hour
	EmailUndoTokenTTL   = 7 * 24 * time.Hour
)

// tokenPurposeEmailUndo is the token behind the "this wasn't me" link mailed
// to the old address after an email change.
const tokenPurposeEmailUndo = "email_undo"

var (
	// ErrWrongPassword means the current password didn't match.
	ErrWrongPassword = errors.New("current password is incorrect")
	// ErrNotPasswordAccount means the account signs in with OAuth or as a guest.
	ErrNotPasswordAccount = errors.New("only email accounts have a password")
	// ErrEmailInUse means another account already uses the address.
	ErrEmailInUse = errors.New("email already registered")
	// ErrSameEmail means the new address is the current one.
	ErrSameEmail = errors.New("that is already your email")
	// ErrInvalidEmail means the address is malformed.
	ErrInvalidEmail = errors.New("invalid email format")
	// ErrNoSession means the caller's token has no device session (legacy
	// token), so "every other device" can't be told apart from this one.
	ErrNoSession = errors.New("refresh your session first")
)

// passwordAccount loads a live password account.
func (s *EmailAuthService) passwordAccount(userID string) (*models.User, error) {
	user, err := s.users.GetByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.DeletedAt != nil || user.AuthProvider != models.AuthProviderPassword {
		return nil, ErrNotPasswordAccount
	}
	return user, nil
}

// ChangePassword sets a new password after checking the current one, and
// ends every other device session (sessionID, the caller's, stays). The
// caller drops push tokens and closes the other sockets.
func (s *EmailAuthService) ChangePassword(userID, sessionID, current, next string) error {
	if sessionID == "" {
		return ErrNoSession
	}
	user, err := s.passwordAccount(userID)
	if err != nil {
		return err
	}
	if !CheckPasswordHash(current, user.PasswordHash) {
		return ErrWrongPassword
	}
	if err := ValidatePassword(next); err != nil {
		return err
	}
	hash, err := HashPassword(next)
	if err != nil {
		return err
	}
	if err := s.users.UpdatePasswordHash(userID, hash); err != nil {
		return err
	}
	if err := s.tokens.DeleteForUser(userID, mail.PurposeReset); err != nil {
		log.Printf("[EmailAuth] Failed to drop reset tokens of %s: %v", userID, err)
	}
	if _, err := s.auth.EndOtherSessions(userID, sessionID); err != nil {
		return fmt.Errorf("failed to sign out other sessions: %w", err)
	}
	s.notifyPasswordChanged(user)
	return nil
}

// RequestEmailChange starts an email change after checking the password.
// With email on, the new address gets a confirm link and nothing changes
// yet (pending true). With email off, the address changes at once and stays
// unverified.
func (s *EmailAuthService) RequestEmailChange(userID, password, newEmail string) (pending bool, err error) {
	newEmail = strings.TrimSpace(newEmail)
	if newEmail == "" || !isValidEmail(newEmail) {
		return false, ErrInvalidEmail
	}
	user, err := s.passwordAccount(userID)
	if err != nil {
		return false, err
	}
	if !CheckPasswordHash(password, user.PasswordHash) {
		return false, ErrWrongPassword
	}
	if strings.EqualFold(newEmail, user.Email) {
		return false, ErrSameEmail
	}
	if taken, err := s.emailTaken(newEmail, userID); err != nil {
		return false, err
	} else if taken {
		return false, ErrEmailInUse
	}

	if !s.Enabled() {
		if err := s.setEmail(userID, newEmail, nil); err != nil {
			return false, err
		}
		return false, nil
	}

	if !s.takeCooldown(mail.PurposeEmailChange, userID) {
		return false, ErrEmailCooldown
	}
	token, err := s.issueWith(userID, mail.PurposeEmailChange, newEmail, EmailChangeTokenTTL, true)
	if err != nil {
		return false, err
	}
	s.mailer.Queue(userID, newEmail, mail.PurposeEmailChange, mail.Data{
		Nickname:  user.Nickname,
		Link:      s.appURL + "/confirm-email?token=" + token,
		ExpiresIn: "24 hours",
	}, token)
	return true, nil
}

// ConfirmEmailChange redeems the link sent to the new address: the email
// changes and counts as verified. A verified old address gets a notice with
// an undo link.
func (s *EmailAuthService) ConfirmEmailChange(token string) (*models.User, error) {
	tok, err := s.tokens.Consume(hashEmailToken(token), mail.PurposeEmailChange, s.now())
	if err != nil {
		return nil, err
	}
	if tok == nil {
		return nil, ErrInvalidEmailToken
	}
	user, err := s.passwordAccount(tok.UserID)
	if errors.Is(err, ErrNotPasswordAccount) {
		return nil, ErrInvalidEmailToken
	}
	if err != nil {
		return nil, err
	}
	oldEmail, oldVerified := user.Email, user.EmailVerified
	now := s.now().UTC()
	if err := s.setEmail(user.ID, tok.Data, &now); err != nil {
		return nil, err
	}

	if oldVerified && oldEmail != "" && !strings.EqualFold(oldEmail, tok.Data) && s.Enabled() {
		// Added, not replaced: a later change must not cancel this link.
		undo, err := s.issueWith(user.ID, tokenPurposeEmailUndo, oldEmail, EmailUndoTokenTTL, false)
		if err != nil {
			log.Printf("[EmailAuth] Failed to issue undo token for %s: %v", user.ID, err)
		} else {
			s.mailer.Queue(user.ID, oldEmail, mail.PurposeEmailChanged, mail.Data{
				Nickname:  user.Nickname,
				Link:      s.appURL + "/restore-email?token=" + undo,
				ExpiresIn: "7 days",
				NewEmail:  maskEmail(tok.Data),
			}, undo)
		}
	}
	return s.users.GetByID(user.ID)
}

// RestoreEmail redeems the undo link from the email-changed notice: the old
// address comes back (verified), the password is replaced and every session
// is revoked. The caller closes sockets and starts a new session.
func (s *EmailAuthService) RestoreEmail(token, password string) (*models.User, error) {
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}
	tok, err := s.tokens.Consume(hashEmailToken(token), tokenPurposeEmailUndo, s.now())
	if err != nil {
		return nil, err
	}
	if tok == nil {
		return nil, ErrInvalidEmailToken
	}
	user, err := s.passwordAccount(tok.UserID)
	if errors.Is(err, ErrNotPasswordAccount) {
		return nil, ErrInvalidEmailToken
	}
	if err != nil {
		return nil, err
	}
	if taken, err := s.emailTaken(tok.Data, user.ID); err != nil {
		return nil, err
	} else if taken {
		return nil, ErrEmailInUse
	}
	now := s.now().UTC()
	if err := s.setEmail(user.ID, tok.Data, &now); err != nil {
		return nil, err
	}
	// Undo links of later changes would bring the attacker's address back.
	// Older ones (from before this change) stay valid.
	if err := s.tokens.DeleteCreatedSince(user.ID, tokenPurposeEmailUndo, tok.CreatedAt); err != nil {
		log.Printf("[EmailAuth] Failed to drop later undo tokens of %s: %v", user.ID, err)
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	if err := s.users.UpdatePasswordHash(user.ID, hash); err != nil {
		return nil, err
	}
	if err := s.auth.RevokeTokens(user.ID); err != nil {
		return nil, fmt.Errorf("failed to sign out sessions: %w", err)
	}
	updated, err := s.users.GetByID(user.ID)
	if err != nil {
		return nil, err
	}
	s.notifyPasswordChanged(updated)
	return updated, nil
}

// setEmail changes the address and drops links that belonged to the old one
// (verify, reset) and pending changes.
func (s *EmailAuthService) setEmail(userID, email string, verifiedAt *time.Time) error {
	if err := s.users.SetEmail(userID, email, verifiedAt); err != nil {
		if errors.Is(err, repository.ErrEmailTaken) {
			return ErrEmailInUse
		}
		return err
	}
	if err := s.tokens.DeleteForUser(userID, mail.PurposeVerify, mail.PurposeReset, mail.PurposeEmailChange); err != nil {
		log.Printf("[EmailAuth] Failed to drop tokens of %s after email change: %v", userID, err)
	}
	return nil
}

// emailTaken reports whether another live password account uses email.
func (s *EmailAuthService) emailTaken(email, selfID string) (bool, error) {
	provider := models.AuthProviderPassword
	other, err := s.users.GetByEmail(email, &provider)
	if err != nil {
		return false, err
	}
	return other != nil && other.ID != selfID && other.DeletedAt == nil, nil
}

// notifyPasswordChanged tells a verified address that the password changed.
// The mail carries no token: only a pointer to "Forgot password?".
func (s *EmailAuthService) notifyPasswordChanged(user *models.User) {
	if !s.Enabled() || user == nil || user.Email == "" || !user.EmailVerified {
		return
	}
	s.mailer.Queue(user.ID, user.Email, mail.PurposePasswordChanged, mail.Data{
		Nickname: user.Nickname,
		Link:     s.appURL + "/",
	}, "")
}

// maskEmail shows enough of an address to recognize it: "n•••@example.com".
func maskEmail(email string) string {
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return "•••"
	}
	local := []rune(email[:at])
	return string(local[0]) + "•••" + email[at:]
}
