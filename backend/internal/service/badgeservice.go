package service

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

const (
	// MaxBadgeFileSize is the upload limit; the stored image is re-encoded smaller.
	MaxBadgeFileSize = 512 * 1024
	// MaxBadgeDimension is the stored size (images are scaled down to fit).
	MaxBadgeDimension = 256
	// maxBadgeSourceDimension rejects absurd sources (decompression bombs).
	maxBadgeSourceDimension = 2048
	// maxAnimatedBadgeSourceDimension is lower: every frame is decoded in memory.
	maxAnimatedBadgeSourceDimension = 512
	// MaxBadgeNameLength and MaxBadgeDescriptionLength are rune counts.
	MaxBadgeNameLength        = 48
	MaxBadgeDescriptionLength = 200
)

var (
	ErrBadgeTooLarge     = errors.New("badge image exceeds 512KB limit")
	ErrBadgeInvalidType  = errors.New("invalid file type, only PNG, GIF and WebP images are allowed")
	ErrBadgeInvalidImage = errors.New("invalid badge image")
	ErrBadgeNotFound     = errors.New("badge not found")
	ErrBadgeUserNotFound = errors.New("user not found")
	ErrBadgeNotHeld      = errors.New("you don't hold this badge")
	ErrBadgeNameTaken    = errors.New("a badge with this name already exists")
	ErrBadgeInvalidName  = fmt.Errorf("badge name must be 1-%d characters", MaxBadgeNameLength)
	ErrBadgeInvalidDesc  = fmt.Errorf("badge description must be at most %d characters", MaxBadgeDescriptionLength)
)

// BadgeService manages the badge library (profile achievements). Definitions
// are shared: one badge can be awarded to any number of users.
type BadgeService struct {
	repo    *repository.BadgeRepository
	users   *repository.UserRepository
	dataDir string

	// nameMu serializes the name uniqueness check with the write that follows
	// it (Create, Update).
	nameMu sync.Mutex
}

func NewBadgeService(repo *repository.BadgeRepository, users *repository.UserRepository, dataDir string) *BadgeService {
	return &BadgeService{repo: repo, users: users, dataDir: dataDir}
}

func (s *BadgeService) badgeDir() string {
	return filepath.Join(s.dataDir, "badges")
}

// NormalizeBadgeText validates and trims a badge name or description.
func NormalizeBadgeText(name, description string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > MaxBadgeNameLength {
		return "", "", ErrBadgeInvalidName
	}
	description = strings.TrimSpace(description)
	if utf8.RuneCountInString(description) > MaxBadgeDescriptionLength {
		return "", "", ErrBadgeInvalidDesc
	}
	return name, description, nil
}

// withImageURL sets the image URL. The endpoint is cached as immutable; the
// filename acts as a version so a replaced image is fetched again.
func withBadgeImageURL(b *models.Badge) *models.Badge {
	version := strings.TrimSuffix(b.Filename, filepath.Ext(b.Filename))
	b.ImageURL = fmt.Sprintf("/api/badges/%s/image?v=%s", b.ID, version)
	return b
}

// processBadgeImage validates a PNG, GIF or WebP and re-encodes it as WebP
// fitting MaxBadgeDimension. Animation is kept but not reported: badges have
// no still variant.
func processBadgeImage(data []byte) ([]byte, error) {
	if len(data) > MaxBadgeFileSize {
		return nil, ErrBadgeTooLarge
	}
	if !isAllowedImageType(data) {
		return nil, ErrBadgeInvalidType
	}
	encoded, _, err := encodeBadgeWebP(data)
	return encoded, err
}

func (s *BadgeService) writeImage(encoded []byte) (filename string, err error) {
	if err := os.MkdirAll(s.badgeDir(), 0755); err != nil {
		return "", fmt.Errorf("failed to create badge directory: %w", err)
	}
	filename = uuid.New().String() + ".webp"
	if err := os.WriteFile(filepath.Join(s.badgeDir(), filename), encoded, 0644); err != nil {
		return "", fmt.Errorf("failed to save badge image: %w", err)
	}
	return filename, nil
}

// List returns every badge in upload order.
func (s *BadgeService) List() ([]*models.Badge, error) {
	badges, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	for _, b := range badges {
		withBadgeImageURL(b)
	}
	return badges, nil
}

func (s *BadgeService) Create(createdBy string, data []byte, name, description string) (*models.Badge, error) {
	name, description, err := NormalizeBadgeText(name, description)
	if err != nil {
		return nil, err
	}
	s.nameMu.Lock()
	defer s.nameMu.Unlock()
	taken, err := s.repo.NameTaken(name, "")
	if err != nil {
		return nil, fmt.Errorf("failed to check badge name: %w", err)
	}
	if taken {
		return nil, ErrBadgeNameTaken
	}
	encoded, err := processBadgeImage(data)
	if err != nil {
		return nil, err
	}
	filename, err := s.writeImage(encoded)
	if err != nil {
		return nil, err
	}

	badge := &models.Badge{
		ID:          uuid.New().String(),
		Name:        name,
		Description: description,
		Filename:    filename,
		FileSize:    int64(len(encoded)),
		CreatedBy:   createdBy,
		CreatedAt:   time.Now(),
	}
	if err := s.repo.Create(badge); err != nil {
		_ = os.Remove(filepath.Join(s.badgeDir(), filename))
		return nil, fmt.Errorf("failed to save badge: %w", err)
	}
	return withBadgeImageURL(badge), nil
}

// Update edits a badge's name and/or description.
func (s *BadgeService) Update(id string, req models.UpdateBadgeRequest) (*models.Badge, error) {
	badge, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if badge == nil {
		return nil, ErrBadgeNotFound
	}
	name, description := badge.Name, badge.Description
	if req.Name != nil {
		name = *req.Name
	}
	if req.Description != nil {
		description = *req.Description
	}
	name, description, err = NormalizeBadgeText(name, description)
	if err != nil {
		return nil, err
	}
	s.nameMu.Lock()
	defer s.nameMu.Unlock()
	taken, err := s.repo.NameTaken(name, id)
	if err != nil {
		return nil, fmt.Errorf("failed to check badge name: %w", err)
	}
	if taken {
		return nil, ErrBadgeNameTaken
	}
	badge.Name, badge.Description = name, description
	if err := s.repo.Update(badge); err != nil {
		return nil, fmt.Errorf("failed to update badge: %w", err)
	}
	return withBadgeImageURL(badge), nil
}

// ReplaceImage swaps a badge's image. The new filename is a fresh uuid, so the
// image URL (and its on-device cache key) changes and clients refetch it.
func (s *BadgeService) ReplaceImage(id string, data []byte) (*models.Badge, error) {
	badge, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if badge == nil {
		return nil, ErrBadgeNotFound
	}
	encoded, err := processBadgeImage(data)
	if err != nil {
		return nil, err
	}
	filename, err := s.writeImage(encoded)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateFile(id, filename, int64(len(encoded))); err != nil {
		_ = os.Remove(filepath.Join(s.badgeDir(), filename))
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrBadgeNotFound
		}
		return nil, fmt.Errorf("failed to update badge image: %w", err)
	}
	if old, ok := safeBadgeFilename(badge.Filename); ok && old != filename {
		_ = os.Remove(filepath.Join(s.badgeDir(), old))
	}
	badge.Filename = filename
	badge.FileSize = int64(len(encoded))
	return withBadgeImageURL(badge), nil
}

// Delete removes the badge, every assignment of it and its image file.
func (s *BadgeService) Delete(id string) error {
	badge, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if badge == nil {
		return ErrBadgeNotFound
	}
	if err := s.repo.Delete(id); err != nil {
		return fmt.Errorf("failed to delete badge: %w", err)
	}
	if filename, ok := safeBadgeFilename(badge.Filename); ok {
		if err := os.Remove(filepath.Join(s.badgeDir(), filename)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to delete badge image: %w", err)
		}
	}
	return nil
}

func safeBadgeFilename(filename string) (string, bool) {
	if filename == "" || filename == "." || filename == ".." || filename != filepath.Base(filename) {
		return "", false
	}
	if ext := filepath.Ext(filename); ext != ".webp" {
		return "", false
	}
	return filename, true
}

// ImagePath returns the on-disk path of a badge's image.
func (s *BadgeService) ImagePath(id string) (string, error) {
	badge, err := s.repo.GetByID(id)
	if err != nil {
		return "", err
	}
	if badge == nil {
		return "", ErrBadgeNotFound
	}
	filename, ok := safeBadgeFilename(badge.Filename)
	if !ok {
		return "", ErrBadgeNotFound
	}
	filePath := filepath.Join(s.badgeDir(), filename)
	if _, err := os.Stat(filePath); err != nil {
		return "", ErrBadgeNotFound
	}
	return filePath, nil
}

// Assignments returns every user's badges with their award dates.
func (s *BadgeService) Assignments() (models.BadgeAssignments, error) {
	return s.repo.Assignments()
}

// SetUserBadges makes the user hold exactly badgeIDs (unknown ids are an
// error). Badges that stay keep their original award date.
func (s *BadgeService) SetUserBadges(userID string, badgeIDs []string, assignedBy string) ([]models.UserBadge, error) {
	badges, err := s.repo.List()
	if err != nil {
		return nil, fmt.Errorf("failed to load badges: %w", err)
	}
	known := make(map[string]struct{}, len(badges))
	for _, b := range badges {
		known[b.ID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(badgeIDs))
	wanted := make([]string, 0, len(badgeIDs))
	for _, id := range badgeIDs {
		if _, ok := known[id]; !ok {
			return nil, ErrBadgeNotFound
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		wanted = append(wanted, id)
	}
	if s.users != nil {
		user, err := s.users.GetByID(userID)
		if err != nil {
			return nil, fmt.Errorf("failed to load user: %w", err)
		}
		if user == nil {
			return nil, ErrBadgeUserNotFound
		}
	}
	return s.repo.ReplaceUserBadges(userID, wanted, assignedBy)
}

// SetDisplayedBadge pins one of the user's own badges next to their nickname.
// "" clears the pin (clients fall back to the newest award).
func (s *BadgeService) SetDisplayedBadge(userID, badgeID string) ([]models.UserBadge, error) {
	badges, err := s.repo.SetDisplayedBadge(userID, badgeID)
	if errors.Is(err, repository.ErrBadgeNotHeld) {
		return nil, ErrBadgeNotHeld
	}
	if err != nil {
		return nil, err
	}
	return badges, nil
}
