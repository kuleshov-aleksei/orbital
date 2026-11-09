package service

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/h2non/bimg"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

const (
	// MaxEmojiFileSize is the upload limit; stored images are re-encoded smaller.
	MaxEmojiFileSize = 256 * 1024
	// MaxEmojiDimension is the stored size (images are scaled down to fit).
	MaxEmojiDimension = 128
	// maxEmojiSourceDimension rejects absurd sources (decompression bombs).
	maxEmojiSourceDimension = 4096
	// MaxCustomEmojis caps the library; every client loads the whole list.
	MaxCustomEmojis = 200
)

var (
	ErrEmojiTooLarge     = errors.New("emoji image exceeds 256KB limit")
	ErrEmojiInvalidType  = errors.New("invalid file type, only PNG images are allowed")
	ErrEmojiInvalidImage = fmt.Errorf("invalid image, must be a PNG up to %dx%d", maxEmojiSourceDimension, maxEmojiSourceDimension)
	ErrEmojiNotFound     = errors.New("emoji not found")
	ErrEmojiLibraryFull  = fmt.Errorf("emoji library is full (%d emojis max)", MaxCustomEmojis)
)


// EmojiService manages the shared custom emoji library. Name and alias rules
// are shared with the soundboard.
type EmojiService struct {
	repo    *repository.EmojiRepository
	dataDir string
}

func NewEmojiService(repo *repository.EmojiRepository, dataDir string) *EmojiService {
	return &EmojiService{repo: repo, dataDir: dataDir}
}

func (s *EmojiService) emojiDir() string {
	return filepath.Join(s.dataDir, "emojis")
}

// processEmojiImage validates a PNG and re-encodes it to fit within
// MaxEmojiDimension (aspect ratio and transparency kept, metadata stripped).
// Re-encoding also drops anything appended to or embedded in the upload.
func processEmojiImage(data []byte) ([]byte, error) {
	if len(data) > MaxEmojiFileSize {
		return nil, ErrEmojiTooLarge
	}
	if !bytes.HasPrefix(data, pngMagic) || bimg.DetermineImageType(data) != bimg.PNG {
		return nil, ErrEmojiInvalidType
	}
	img := bimg.NewImage(data)
	size, err := img.Size()
	if err != nil || size.Width <= 0 || size.Height <= 0 ||
		size.Width > maxEmojiSourceDimension || size.Height > maxEmojiSourceDimension {
		return nil, ErrEmojiInvalidImage
	}

	opts := bimg.Options{Type: bimg.PNG, StripMetadata: true}
	if size.Width > MaxEmojiDimension || size.Height > MaxEmojiDimension {
		w, h := MaxEmojiDimension, MaxEmojiDimension
		if size.Width >= size.Height {
			h = max(1, size.Height*MaxEmojiDimension/size.Width)
		} else {
			w = max(1, size.Width*MaxEmojiDimension/size.Height)
		}
		opts.Width, opts.Height, opts.Force = w, h, true
	}
	out, err := img.Process(opts)
	if err != nil {
		return nil, ErrEmojiInvalidImage
	}
	return out, nil
}

// withImageURL sets the image URL. The image endpoint is cached as immutable;
// the filename acts as a version in case images are ever replaced.
func withImageURL(e *models.CustomEmoji) *models.CustomEmoji {
	version := strings.TrimSuffix(e.Filename, filepath.Ext(e.Filename))
	e.ImageURL = fmt.Sprintf("/api/emojis/%s/image?v=%s", e.ID, version)
	return e
}

func (s *EmojiService) Create(userID string, data []byte, name string, aliases []string) (*models.CustomEmoji, error) {
	if len(data) > MaxEmojiFileSize {
		return nil, ErrEmojiTooLarge
	}
	name, err := NormalizeSoundName(name)
	if err != nil {
		return nil, err
	}
	aliases, err = NormalizeSoundAliases(aliases)
	if err != nil {
		return nil, err
	}
	count, err := s.repo.Count()
	if err != nil {
		return nil, fmt.Errorf("failed to count emojis: %w", err)
	}
	if count >= MaxCustomEmojis {
		return nil, ErrEmojiLibraryFull
	}
	image, err := processEmojiImage(data)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(s.emojiDir(), 0755); err != nil {
		return nil, fmt.Errorf("failed to create emoji directory: %w", err)
	}
	id := uuid.New().String()
	filename := id + ".png"
	filePath := filepath.Join(s.emojiDir(), filename)
	if err := os.WriteFile(filePath, image, 0644); err != nil {
		return nil, fmt.Errorf("failed to save emoji: %w", err)
	}

	emoji := &models.CustomEmoji{
		ID:         id,
		Name:       name,
		Aliases:    aliases,
		Filename:   filename,
		FileSize:   int64(len(image)),
		UploadedBy: userID,
		CreatedAt:  time.Now(),
	}
	if err := s.repo.Create(emoji); err != nil {
		_ = os.Remove(filePath)
		return nil, fmt.Errorf("failed to save emoji record: %w", err)
	}
	return withImageURL(emoji), nil
}

func (s *EmojiService) List() ([]*models.CustomEmoji, error) {
	emojis, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	for _, e := range emojis {
		withImageURL(e)
	}
	return emojis, nil
}

// Update applies the non-nil fields of req.
func (s *EmojiService) Update(id string, req models.UpdateCustomEmojiRequest) (*models.CustomEmoji, error) {
	emoji, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if emoji == nil {
		return nil, ErrEmojiNotFound
	}
	if req.Name != nil {
		name, err := NormalizeSoundName(*req.Name)
		if err != nil {
			return nil, err
		}
		emoji.Name = name
	}
	if req.Aliases != nil {
		aliases, err := NormalizeSoundAliases(*req.Aliases)
		if err != nil {
			return nil, err
		}
		emoji.Aliases = aliases
	}
	if err := s.repo.Update(emoji); err != nil {
		return nil, err
	}
	return withImageURL(emoji), nil
}

// Delete removes the emoji and its file. References to it (statuses,
// soundboard clips) are left as-is; clients hide unknown custom emojis.
func (s *EmojiService) Delete(id string) error {
	emoji, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if emoji == nil {
		return ErrEmojiNotFound
	}
	if err := s.repo.Delete(id); err != nil {
		return err
	}
	if filename, ok := safeEmojiFilename(emoji.Filename); ok {
		if err := os.Remove(filepath.Join(s.emojiDir(), filename)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to delete emoji file: %w", err)
		}
	}
	return nil
}

func safeEmojiFilename(filename string) (string, bool) {
	if filename == "" || filename == "." || filename == ".." || filename != filepath.Base(filename) {
		return "", false
	}
	if filepath.Ext(filename) != ".png" {
		return "", false
	}
	return filename, true
}

// ImagePath returns the on-disk path of an emoji's image.
func (s *EmojiService) ImagePath(id string) (string, error) {
	emoji, err := s.repo.GetByID(id)
	if err != nil {
		return "", err
	}
	if emoji == nil {
		return "", ErrEmojiNotFound
	}
	filename, ok := safeEmojiFilename(emoji.Filename)
	if !ok {
		return "", ErrEmojiNotFound
	}
	filePath := filepath.Join(s.emojiDir(), filename)
	if _, err := os.Stat(filePath); err != nil {
		return "", ErrEmojiNotFound
	}
	return filePath, nil
}

// EmojiExists reports whether a custom emoji id exists (used to validate
// "custom:<id>" references).
func (s *EmojiService) EmojiExists(id string) bool {
	emoji, err := s.repo.GetByID(id)
	return err == nil && emoji != nil
}
