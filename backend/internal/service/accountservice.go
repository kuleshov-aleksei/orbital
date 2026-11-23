package service

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

var (
	// ErrCannotDeleteOwner: the super admin must stay (there is exactly one).
	ErrCannotDeleteOwner = errors.New("the server owner's account cannot be deleted")
	// ErrDeleteNotConfirmed: wrong password or nickname in the confirmation.
	ErrDeleteNotConfirmed = errors.New("account deletion not confirmed")
)

// AccountMedia removes a user's chat attachments (chatmedia.Service).
type AccountMedia interface {
	RemoveForUploader(userID string) error
}

// AccountLive tears down a deleted user's live state: voice, sockets,
// clients' user lists (websocket.Hub).
type AccountLive interface {
	AccountDeleted(userID string)
}

// AccountService is the single path that deletes an account: in-app
// "Delete my account" and the admin panel both go through Erase.
type AccountService struct {
	users      *repository.UserRepository
	debugLogs  *DebugLogService
	avatars    *AvatarService
	media      AccountMedia
	live       AccountLive
	forgetPerm func(userID string)
	now        func() time.Time
}

// NewAccountService wires the erase path. Every dependency except users may
// be nil (feature disabled).
func NewAccountService(users *repository.UserRepository, debugLogs *DebugLogService, avatars *AvatarService) *AccountService {
	return &AccountService{users: users, debugLogs: debugLogs, avatars: avatars, now: time.Now}
}

// SetMedia sets where attachments are removed (nil when attachments are off).
func (s *AccountService) SetMedia(media AccountMedia) { s.media = media }

// SetLive sets the live-state hook (websocket.Hub).
func (s *AccountService) SetLive(live AccountLive) { s.live = live }

// SetPermissionForget sets the hook that drops cached permissions.
func (s *AccountService) SetPermissionForget(fn func(userID string)) { s.forgetPerm = fn }

// ConfirmDelete checks the confirmation the user typed: the password for
// password accounts, the current nickname for every other kind.
func ConfirmDelete(user *models.User, password, nickname string) error {
	if user.AuthProvider == models.AuthProviderPassword && user.PasswordHash != "" {
		if password == "" || !CheckPasswordHash(password, user.PasswordHash) {
			return ErrDeleteNotConfirmed
		}
		return nil
	}
	if strings.TrimSpace(nickname) == "" || strings.TrimSpace(nickname) != user.Nickname {
		return ErrDeleteNotConfirmed
	}
	return nil
}

// Erase deletes the account: files first (debug logs, attachments, avatar),
// then the database rows and the tombstone (UserRepository.Erase), then live
// state. Messages stay and show as "Deleted user". Erasing an already
// deleted or unknown user is a no-op.
func (s *AccountService) Erase(userID string) error {
	user, err := s.users.GetByID(userID)
	if err != nil {
		return fmt.Errorf("failed to load user: %w", err)
	}
	if user == nil || user.DeletedAt != nil {
		return nil
	}
	if user.Role == models.RoleSuperAdmin {
		return ErrCannotDeleteOwner
	}

	if s.debugLogs != nil {
		if err := s.debugLogs.DeleteForUser(userID); err != nil {
			return fmt.Errorf("failed to delete debug logs: %w", err)
		}
	}
	if s.media != nil {
		if err := s.media.RemoveForUploader(userID); err != nil {
			return fmt.Errorf("failed to remove attachments: %w", err)
		}
	}
	if err := s.users.Erase(userID, s.now().UTC()); err != nil {
		return fmt.Errorf("failed to erase user: %w", err)
	}
	// After the row is scrubbed: a failure here leaves only an orphaned
	// file, never a half-deleted account.
	if s.avatars != nil && user.AvatarURL != "" {
		if err := s.avatars.DeleteAvatar(user.AvatarURL); err != nil && !os.IsNotExist(err) {
			log.Printf("[Account] Failed to delete avatar of %s: %v", userID, err)
		}
	}
	if s.forgetPerm != nil {
		s.forgetPerm(userID)
	}
	if s.live != nil {
		s.live.AccountDeleted(userID)
	}
	log.Printf("[Account] Deleted account %s", userID)
	return nil
}
