package service

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/h2non/bimg"
)

const (
	MaxAvatarSize   = 5 * 1024 * 1024
	MaxAvatarWidth  = 512
	MaxAvatarHeight = 512
	JPEGQuality     = 85
)

var (
	ErrFileTooLarge     = errors.New("file size exceeds 5MB limit")
	ErrInvalidFileType  = errors.New("invalid file type, only PNG and JPG are allowed")
	ErrInvalidImageData = errors.New("invalid image data")
)

type AvatarService struct {
	dataDir string
}

func NewAvatarService(dataDir string) *AvatarService {
	return &AvatarService{
		dataDir: dataDir,
	}
}

type AvatarUploadResult struct {
	GUID      string
	AvatarURL string
	FilePath  string
}

func (s *AvatarService) UploadAvatar(userID string, fileData []byte, currentAvatarURL string) (*AvatarUploadResult, error) {
	if len(fileData) > MaxAvatarSize {
		return nil, ErrFileTooLarge
	}

	if !s.isValidImageType(fileData) {
		return nil, ErrInvalidFileType
	}

	imgType := bimg.DetermineImageType(fileData)
	if imgType == bimg.UNKNOWN {
		return nil, ErrInvalidImageData
	}

	avatarGUID := uuid.New().String()

	resized, err := bimg.NewImage(fileData).Process(bimg.Options{
		Width:         MaxAvatarWidth,
		Height:        MaxAvatarHeight,
		Embed:         true,
		Type:          bimg.JPEG,
		Quality:       JPEGQuality,
		StripMetadata: true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to process image: %w", err)
	}

	avatarsDir := filepath.Join(s.dataDir, "avatars")
	if err := os.MkdirAll(avatarsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create avatars directory: %w", err)
	}

	filename := fmt.Sprintf("%s.jpg", avatarGUID)
	filePath := filepath.Join(avatarsDir, filename)

	if err := os.WriteFile(filePath, resized, 0644); err != nil {
		return nil, fmt.Errorf("failed to save avatar: %w", err)
	}

	avatarURL := fmt.Sprintf("/api/avatars/%s", avatarGUID)

	if currentAvatarURL != "" {
		s.deleteOldAvatar(currentAvatarURL)
	}

	return &AvatarUploadResult{
		GUID:      avatarGUID,
		AvatarURL: avatarURL,
		FilePath:  filePath,
	}, nil
}

func (s *AvatarService) isValidImageType(data []byte) bool {
	if len(data) < 8 {
		return false
	}

	if bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}) {
		return true
	}

	if bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}) {
		return true
	}

	return false
}

func normalizeAvatarGUID(raw string) (string, bool) {
	if raw == "" {
		return "", false
	}
	base := filepath.Base(raw)
	if base == "" || base == "." || base == ".." {
		return "", false
	}

	if ext := filepath.Ext(base); ext != "" {
		if ext != ".jpg" {
			return "", false
		}
		base = strings.TrimSuffix(base, ext)
	}

	parsed, err := uuid.Parse(base)
	if err != nil {
		return "", false
	}
	return parsed.String(), true
}

func (s *AvatarService) deleteOldAvatar(avatarURL string) {
	guid, ok := normalizeAvatarGUID(avatarURL)
	if !ok {
		return
	}

	oldPath := filepath.Join(s.dataDir, "avatars", guid+".jpg")
	_ = os.Remove(oldPath)
}

func (s *AvatarService) GetAvatarPath(guid string) (string, error) {
	normalized, ok := normalizeAvatarGUID(guid)
	if !ok {
		return "", errors.New("invalid avatar guid")
	}

	filePath := filepath.Join(s.dataDir, "avatars", normalized+".jpg")
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return "", errors.New("avatar not found")
	}

	return filePath, nil
}

func (s *AvatarService) DeleteAvatar(avatarURL string) error {
	if avatarURL == "" {
		return nil
	}

	guid, ok := normalizeAvatarGUID(avatarURL)
	if !ok {
		return nil
	}

	filePath := filepath.Join(s.dataDir, "avatars", guid+".jpg")
	return os.Remove(filePath)
}
