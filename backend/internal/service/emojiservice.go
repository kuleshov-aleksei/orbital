package service

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
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
	// maxAnimatedSourceDimension is lower than for static images: every frame
	// of an animation is decoded in memory, so this bounds decompression bombs.
	maxAnimatedSourceDimension = 512
	// maxEmojiFrames caps animation length.
	maxEmojiFrames = 300
	// MaxCustomEmojis caps the library; every client loads the whole list.
	MaxCustomEmojis = 200
)

var gifMagics = [][]byte{[]byte("GIF87a"), []byte("GIF89a")}

var (
	ErrEmojiTooLarge     = errors.New("emoji image exceeds 256KB limit")
	ErrEmojiInvalidType  = errors.New("invalid file type, only PNG, GIF and WebP images are allowed")
	ErrEmojiInvalidImage = fmt.Errorf("invalid image, must be up to %dx%d (animated: up to %dx%d with at most %d frames)",
		maxEmojiSourceDimension, maxEmojiSourceDimension, maxAnimatedSourceDimension, maxAnimatedSourceDimension, maxEmojiFrames)
	ErrEmojiNotFound    = errors.New("emoji not found")
	ErrEmojiLibraryFull = fmt.Errorf("emoji library is full (%d emojis max)", MaxCustomEmojis)
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

// isAllowedEmojiType checks the magic bytes. libvips sniffs and loads many
// more formats (SVG, PDF, TIFF...), so only these reach it.
func isAllowedEmojiType(data []byte) bool {
	if bytes.HasPrefix(data, pngMagic) || isWebP(data) {
		return true
	}
	for _, magic := range gifMagics {
		if bytes.HasPrefix(data, magic) {
			return true
		}
	}
	return false
}

// processEmojiImage validates a PNG, GIF or WebP and re-encodes it as WebP
// fitting MaxEmojiDimension (aspect ratio, transparency and animation kept).
func processEmojiImage(data []byte) (encoded []byte, animated bool, err error) {
	if len(data) > MaxEmojiFileSize {
		return nil, false, ErrEmojiTooLarge
	}
	if !isAllowedEmojiType(data) {
		return nil, false, ErrEmojiInvalidType
	}
	return encodeEmojiWebP(data)
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
	encoded, animated, err := processEmojiImage(data)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(s.emojiDir(), 0755); err != nil {
		return nil, fmt.Errorf("failed to create emoji directory: %w", err)
	}
	id := uuid.New().String()
	filename := id + ".webp"
	filePath := filepath.Join(s.emojiDir(), filename)
	if err := os.WriteFile(filePath, encoded, 0644); err != nil {
		return nil, fmt.Errorf("failed to save emoji: %w", err)
	}

	emoji := &models.CustomEmoji{
		ID:         id,
		Name:       name,
		Aliases:    aliases,
		Filename:   filename,
		FileSize:   int64(len(encoded)),
		Animated:   animated,
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
	// .png/.gif are emojis stored before WebP; MigrateToWebP converts them.
	if ext := filepath.Ext(filename); ext != ".webp" && ext != ".png" && ext != ".gif" {
		return "", false
	}
	return filename, true
}

// emojiFile returns an emoji and the on-disk path of its image.
func (s *EmojiService) emojiFile(id string) (*models.CustomEmoji, string, error) {
	emoji, err := s.repo.GetByID(id)
	if err != nil {
		return nil, "", err
	}
	if emoji == nil {
		return nil, "", ErrEmojiNotFound
	}
	filename, ok := safeEmojiFilename(emoji.Filename)
	if !ok {
		return nil, "", ErrEmojiNotFound
	}
	filePath := filepath.Join(s.emojiDir(), filename)
	if _, err := os.Stat(filePath); err != nil {
		return nil, "", ErrEmojiNotFound
	}
	return emoji, filePath, nil
}

// ImagePath returns the on-disk path of an emoji's image.
func (s *EmojiService) ImagePath(id string) (string, error) {
	_, filePath, err := s.emojiFile(id)
	return filePath, err
}

// StillImage returns the first frame of an animated emoji as a PNG. ok is
// false for static emojis, which are served as-is.
func (s *EmojiService) StillImage(id string) (data []byte, ok bool, err error) {
	emoji, filePath, err := s.emojiFile(id)
	if err != nil {
		return nil, false, err
	}
	if !emoji.Animated {
		return nil, false, nil
	}
	src, err := os.ReadFile(filePath)
	if err != nil {
		return nil, false, ErrEmojiNotFound
	}
	still, err := emojiStillPNG(src)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read emoji: %w", err)
	}
	return still, true, nil
}

// MigrateToWebP re-encodes emojis stored before WebP (.png/.gif) as WebP.
// The new filename changes image_url, so cached copies are not reused.
// Failures are logged and skipped; the old file keeps being served. Returns
// how many emojis were converted.
func (s *EmojiService) MigrateToWebP() int {
	emojis, err := s.repo.List()
	if err != nil {
		log.Printf("emoji webp migration: failed to list emojis: %v", err)
		return 0
	}
	converted := 0
	for _, e := range emojis {
		if filepath.Ext(e.Filename) == ".webp" {
			continue
		}
		if err := s.migrateOneToWebP(e); err != nil {
			log.Printf("emoji webp migration: %s (%s): %v", e.ID, e.Filename, err)
			continue
		}
		converted++
	}
	if converted > 0 {
		log.Printf("emoji webp migration: converted %d emojis", converted)
	}
	return converted
}

func (s *EmojiService) migrateOneToWebP(e *models.CustomEmoji) error {
	oldName, ok := safeEmojiFilename(e.Filename)
	if !ok {
		return errors.New("unsafe filename")
	}
	oldPath := filepath.Join(s.emojiDir(), oldName)
	src, err := os.ReadFile(oldPath)
	if err != nil {
		return err
	}
	// Stored files were already validated and scaled on upload, so the size
	// limit does not apply here.
	if !isAllowedEmojiType(src) {
		return ErrEmojiInvalidType
	}
	encoded, animated, err := encodeEmojiWebP(src)
	if err != nil {
		return err
	}
	newName := e.ID + "-w.webp"
	newPath := filepath.Join(s.emojiDir(), newName)
	if err := os.WriteFile(newPath, encoded, 0644); err != nil {
		return err
	}
	if err := s.repo.UpdateFile(e.ID, newName, int64(len(encoded)), animated); err != nil {
		_ = os.Remove(newPath)
		return err
	}
	if err := os.Remove(oldPath); err != nil && !os.IsNotExist(err) {
		log.Printf("emoji webp migration: failed to remove %s: %v", oldName, err)
	}
	return nil
}

// EmojiExists reports whether a custom emoji id exists (used to validate
// "custom:<id>" references).
func (s *EmojiService) EmojiExists(id string) bool {
	emoji, err := s.repo.GetByID(id)
	return err == nil && emoji != nil
}
