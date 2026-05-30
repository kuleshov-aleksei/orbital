package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

const (
	MaxAudioFileSize = 50 * 1024 * 1024
)

var (
	ErrAudioFileTooLarge    = errors.New("file size exceeds 50MB limit")
	ErrAudioInvalidFileType = errors.New("invalid file type, only MP3 and OPUS files are allowed")
	ErrAudioNotFound        = errors.New("audio file not found")
)

type audioTypeInfo struct {
	extension   string
	contentType string
}

type AudioService struct {
	repo    *repository.AudioRepository
	dataDir string
}

func NewAudioService(repo *repository.AudioRepository, dataDir string) *AudioService {
	return &AudioService{
		repo:    repo,
		dataDir: dataDir,
	}
}

type AudioUploadResult struct {
	ID          string
	DisplayName string
	AudioURL    string
	FilePath    string
}

func (s *AudioService) UploadAudio(userID string, fileData []byte, displayName string) (*AudioUploadResult, error) {
	if len(fileData) > MaxAudioFileSize {
		return nil, ErrAudioFileTooLarge
	}

	audioType, err := detectAudioType(fileData)
	if err != nil {
		return nil, err
	}

	fileID := uuid.New().String()
	audioDir := filepath.Join(s.dataDir, "audio")
	if err := os.MkdirAll(audioDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create audio directory: %w", err)
	}

	filename := fmt.Sprintf("%s%s", fileID, audioType.extension)
	filePath := filepath.Join(audioDir, filename)

	if err := os.WriteFile(filePath, fileData, 0644); err != nil {
		return nil, fmt.Errorf("failed to save audio file: %w", err)
	}

	audioFile := &models.AudioFile{
		ID:          fileID,
		Filename:    filename,
		DisplayName: displayName,
		UploadedBy:  userID,
		FileSize:    int64(len(fileData)),
		IsSystem:    false,
		CreatedAt:   time.Now(),
	}

	if err := s.repo.Create(audioFile); err != nil {
		os.Remove(filePath)
		return nil, fmt.Errorf("failed to save audio record: %w", err)
	}

	audioURL := fmt.Sprintf("/api/audio/%s", fileID)

	return &AudioUploadResult{
		ID:          fileID,
		DisplayName: displayName,
		AudioURL:    audioURL,
		FilePath:    filePath,
	}, nil
}

func (s *AudioService) GetAllAudio() ([]*models.AudioFile, error) {
	return s.repo.GetAll()
}

func (s *AudioService) GetAudioPath(id string) (string, error) {
	file, err := s.repo.GetByID(id)
	if err != nil {
		return "", err
	}
	if file == nil {
		return "", ErrAudioNotFound
	}

	filePath := filepath.Join(s.dataDir, "audio", file.Filename)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return "", ErrAudioNotFound
	}

	return filePath, nil
}

func (s *AudioService) DeleteAudio(id string) error {
	file, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if file == nil {
		return ErrAudioNotFound
	}

	if file.IsSystem {
		return errors.New("cannot delete system audio files")
	}

	filePath := filepath.Join(s.dataDir, "audio", file.Filename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete audio file: %w", err)
	}

	return s.repo.Delete(id)
}

func detectAudioType(data []byte) (*audioTypeInfo, error) {
	if len(data) < 4 {
		return nil, ErrAudioInvalidFileType
	}

	// OPUS in Ogg container: "OggS" magic
	if data[0] == 0x4F && data[1] == 0x67 && data[2] == 0x67 && data[3] == 0x53 {
		return &audioTypeInfo{extension: ".opus", contentType: "audio/ogg"}, nil
	}

	// MP3 ID3 tag (ID3v2)
	if data[0] == 0x49 && data[1] == 0x44 && data[2] == 0x33 {
		return &audioTypeInfo{extension: ".mp3", contentType: "audio/mpeg"}, nil
	}

	// MP3 MPEG sync word (no ID3 tag)
	if len(data) >= 2 && data[0] == 0xFF && (data[1]&0xE0) == 0xE0 {
		return &audioTypeInfo{extension: ".mp3", contentType: "audio/mpeg"}, nil
	}

	return nil, ErrAudioInvalidFileType
}
