package service

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

type DebugLogService struct {
	repo    *repository.DebugLogRepository
	dataDir string
}

func NewDebugLogService(repo *repository.DebugLogRepository, dataDir string) *DebugLogService {
	return &DebugLogService{
		repo:    repo,
		dataDir: dataDir,
	}
}

func (s *DebugLogService) SaveLog(userID, username, version, logs string) (*models.DebugLog, error) {
	logsDir := filepath.Join(s.dataDir, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	timestamp := time.Now().Format("20060102_150405")
	uniqueID := uuid.New().String()[:8]
	filename := fmt.Sprintf("%s_%s_%s.log", timestamp, uniqueID, userID)

	filePath := filepath.Join(logsDir, filename)
	if err := os.WriteFile(filePath, []byte(logs), 0644); err != nil {
		return nil, fmt.Errorf("failed to save log file: %w", err)
	}

	debugLog := &models.DebugLog{
		UserID:      userID,
		Username:    username,
		Version:     version,
		CreatedAt:   time.Now(),
		LogFilename: filename,
	}

	if err := s.repo.Create(debugLog); err != nil {
		os.Remove(filePath)
		return nil, fmt.Errorf("failed to save log record: %w", err)
	}

	return debugLog, nil
}

func (s *DebugLogService) GetAllLogs() ([]*models.DebugLog, error) {
	return s.repo.GetAll()
}

func (s *DebugLogService) GetLog(id int64) (*models.DebugLog, string, error) {
	debugLog, err := s.repo.GetByID(id)
	if err != nil {
		return nil, "", err
	}
	if debugLog == nil {
		return nil, "", nil
	}

	filePath := filepath.Join(s.dataDir, "logs", debugLog.LogFilename)
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to read log file: %w", err)
	}

	return debugLog, string(content), nil
}

func (s *DebugLogService) DeleteLog(id int64) error {
	debugLog, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if debugLog == nil {
		return nil
	}

	filePath := filepath.Join(s.dataDir, "logs", debugLog.LogFilename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete log file: %w", err)
	}

	return s.repo.Delete(id)
}
