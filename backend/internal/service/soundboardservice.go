package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

const (
	// MaxSoundboardFileSize keeps clips short; clients preload the whole library.
	MaxSoundboardFileSize = 1024 * 1024
	// MaxSoundboardSounds caps the library so preloading stays cheap.
	MaxSoundboardSounds     = 200
	MaxSoundboardNameRunes  = 32
	MaxSoundboardAliases    = 10
	MaxSoundboardAliasRunes = 32
)

var (
	ErrSoundTooLarge     = errors.New("sound file exceeds 1MB limit")
	ErrSoundInvalidType  = errors.New("invalid file type, only MP3 and OGG files are allowed")
	ErrSoundNotFound     = errors.New("sound not found")
	ErrSoundInvalidName  = fmt.Errorf("name must be 1-%d characters", MaxSoundboardNameRunes)
	ErrSoundInvalidAlias = fmt.Errorf("up to %d aliases of 1-%d characters each", MaxSoundboardAliases, MaxSoundboardAliasRunes)
	ErrSoundLibraryFull  = fmt.Errorf("soundboard is full (%d sounds max)", MaxSoundboardSounds)
)

// SoundboardService manages the shared soundboard library. Emoji validation is
// done by the HTTP layer (shared with custom status validation).
type SoundboardService struct {
	repo    *repository.SoundboardRepository
	dataDir string
}

func NewSoundboardService(repo *repository.SoundboardRepository, dataDir string) *SoundboardService {
	return &SoundboardService{repo: repo, dataDir: dataDir}
}

func (s *SoundboardService) soundDir() string {
	return filepath.Join(s.dataDir, "soundboard")
}

// NormalizeSoundName trims and validates a sound name.
func NormalizeSoundName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > MaxSoundboardNameRunes {
		return "", ErrSoundInvalidName
	}
	return name, nil
}

// NormalizeSoundAliases trims, lowercases and de-duplicates aliases, dropping
// empty entries.
func NormalizeSoundAliases(aliases []string) ([]string, error) {
	out := make([]string, 0, len(aliases))
	seen := make(map[string]struct{}, len(aliases))
	for _, a := range aliases {
		a = strings.ToLower(strings.TrimSpace(a))
		if a == "" {
			continue
		}
		if utf8.RuneCountInString(a) > MaxSoundboardAliasRunes {
			return nil, ErrSoundInvalidAlias
		}
		if _, dup := seen[a]; dup {
			continue
		}
		seen[a] = struct{}{}
		out = append(out, a)
	}
	if len(out) > MaxSoundboardAliases {
		return nil, ErrSoundInvalidAlias
	}
	return out, nil
}

func soundFormat(data []byte) (ext, format string, err error) {
	t, err := detectAudioType(data)
	if err != nil {
		return "", "", ErrSoundInvalidType
	}
	if t.contentType == "audio/ogg" {
		return ".ogg", "ogg", nil
	}
	return ".mp3", "mp3", nil
}

func withAudioURL(sound *models.SoundboardSound) *models.SoundboardSound {
	sound.AudioURL = fmt.Sprintf("/api/soundboard/%s/audio", sound.ID)
	return sound
}

func (s *SoundboardService) Create(userID string, data []byte, name, emoji string, aliases []string) (*models.SoundboardSound, error) {
	if len(data) > MaxSoundboardFileSize {
		return nil, ErrSoundTooLarge
	}
	name, err := NormalizeSoundName(name)
	if err != nil {
		return nil, err
	}
	aliases, err = NormalizeSoundAliases(aliases)
	if err != nil {
		return nil, err
	}
	ext, format, err := soundFormat(data)
	if err != nil {
		return nil, err
	}
	count, err := s.repo.Count()
	if err != nil {
		return nil, fmt.Errorf("failed to count sounds: %w", err)
	}
	if count >= MaxSoundboardSounds {
		return nil, ErrSoundLibraryFull
	}

	if err := os.MkdirAll(s.soundDir(), 0755); err != nil {
		return nil, fmt.Errorf("failed to create soundboard directory: %w", err)
	}
	id := uuid.New().String()
	filename := id + ext
	filePath := filepath.Join(s.soundDir(), filename)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return nil, fmt.Errorf("failed to save sound: %w", err)
	}

	sound := &models.SoundboardSound{
		ID:         id,
		Name:       name,
		Emoji:      emoji,
		Aliases:    aliases,
		Filename:   filename,
		Format:     format,
		FileSize:   int64(len(data)),
		UploadedBy: userID,
		CreatedAt:  time.Now(),
	}
	if err := s.repo.Create(sound); err != nil {
		_ = os.Remove(filePath)
		return nil, fmt.Errorf("failed to save sound record: %w", err)
	}
	return withAudioURL(sound), nil
}

func (s *SoundboardService) List() ([]*models.SoundboardSound, error) {
	sounds, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	for _, sound := range sounds {
		withAudioURL(sound)
	}
	return sounds, nil
}

// Update applies the non-nil fields of req. Emoji must already be validated.
func (s *SoundboardService) Update(id string, req models.UpdateSoundboardSoundRequest) (*models.SoundboardSound, error) {
	sound, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if sound == nil {
		return nil, ErrSoundNotFound
	}
	if req.Name != nil {
		name, err := NormalizeSoundName(*req.Name)
		if err != nil {
			return nil, err
		}
		sound.Name = name
	}
	if req.Emoji != nil {
		sound.Emoji = strings.TrimSpace(*req.Emoji)
	}
	if req.Aliases != nil {
		aliases, err := NormalizeSoundAliases(*req.Aliases)
		if err != nil {
			return nil, err
		}
		sound.Aliases = aliases
	}
	if err := s.repo.Update(sound); err != nil {
		return nil, err
	}
	return withAudioURL(sound), nil
}

func (s *SoundboardService) Delete(id string) error {
	sound, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if sound == nil {
		return ErrSoundNotFound
	}
	if err := s.repo.Delete(id); err != nil {
		return err
	}
	if filename, ok := safeSoundFilename(sound.Filename); ok {
		if err := os.Remove(filepath.Join(s.soundDir(), filename)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to delete sound file: %w", err)
		}
	}
	return nil
}

func safeSoundFilename(filename string) (string, bool) {
	if filename == "" || filename == "." || filename == ".." || filename != filepath.Base(filename) {
		return "", false
	}
	switch filepath.Ext(filename) {
	case ".mp3", ".ogg":
		return filename, true
	default:
		return "", false
	}
}

// AudioPath returns the on-disk path and content type of a sound's file.
func (s *SoundboardService) AudioPath(id string) (string, string, error) {
	sound, err := s.repo.GetByID(id)
	if err != nil {
		return "", "", err
	}
	if sound == nil {
		return "", "", ErrSoundNotFound
	}
	filename, ok := safeSoundFilename(sound.Filename)
	if !ok {
		return "", "", ErrSoundNotFound
	}
	filePath := filepath.Join(s.soundDir(), filename)
	if _, err := os.Stat(filePath); err != nil {
		return "", "", ErrSoundNotFound
	}
	contentType := "audio/mpeg"
	if sound.Format == "ogg" {
		contentType = "audio/ogg"
	}
	return filePath, contentType, nil
}

// SoundExists reports whether a sound id is in the library (used by the WS hub).
func (s *SoundboardService) SoundExists(id string) bool {
	sound, err := s.repo.GetByID(id)
	return err == nil && sound != nil
}
