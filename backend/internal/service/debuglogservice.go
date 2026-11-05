package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

const MaxDebugLogSize = 20 * 1024 * 1024

var ErrDebugLogQuotaExceeded = errors.New("debug log storage quota exceeded")

type DebugLogService struct {
	repo            *repository.DebugLogRepository
	dataDir         string
	maxStorageBytes int64
}

func NewDebugLogService(repo *repository.DebugLogRepository, dataDir string, maxStorageBytes int64) *DebugLogService {
	return &DebugLogService{
		repo:            repo,
		dataDir:         dataDir,
		maxStorageBytes: maxStorageBytes,
	}
}

func (s *DebugLogService) SaveLog(userID, username, version, systemInfo, logs string) (*models.DebugLog, error) {
	total, err := s.repo.TotalSizeByUserID(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to check debug log quota: %w", err)
	}
	fileSize := int64(len(logs))
	if total+fileSize > s.maxStorageBytes {
		return nil, ErrDebugLogQuotaExceeded
	}

	logsDir := filepath.Join(s.dataDir, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%s.log", timestamp, uuid.New().String())

	filePath := filepath.Join(logsDir, filename)
	if err := os.WriteFile(filePath, []byte(logs), 0644); err != nil {
		return nil, fmt.Errorf("failed to save log file: %w", err)
	}

	debugLog := &models.DebugLog{
		UserID:      userID,
		Username:    username,
		Version:     version,
		SystemInfo:  systemInfo,
		CreatedAt:   time.Now(),
		LogFilename: filename,
		FileSize:    fileSize,
	}

	if err := s.repo.Create(debugLog); err != nil {
		_ = os.Remove(filePath)
		return nil, fmt.Errorf("failed to save log record: %w", err)
	}

	return debugLog, nil
}

func (s *DebugLogService) GetAllLogs() ([]*models.DebugLog, error) {
	return s.repo.GetAll()
}

func (s *DebugLogService) BackfillFileSizes() error {
	logs, err := s.repo.GetAll()
	if err != nil {
		return err
	}

	for _, log := range logs {
		if log.FileSize >= 0 {
			continue
		}

		var size int64
		if filePath, err := s.logPath(log.LogFilename); err == nil {
			if info, statErr := os.Stat(filePath); statErr == nil {
				size = info.Size()
			} else if !os.IsNotExist(statErr) {
				return fmt.Errorf("failed to stat debug log %d: %w", log.ID, statErr)
			}
		}

		if err := s.repo.SetFileSize(log.ID, size); err != nil {
			return fmt.Errorf("failed to backfill debug log %d size: %w", log.ID, err)
		}
	}

	return nil
}

func (s *DebugLogService) logPath(filename string) (string, error) {
	if filename == "" || filename == "." || filename == ".." {
		return "", fmt.Errorf("invalid log filename")
	}
	if filename != filepath.Base(filename) || strings.ContainsAny(filename, `/\`) {
		return "", fmt.Errorf("invalid log filename")
	}
	if filepath.Ext(filename) != ".log" {
		return "", fmt.Errorf("invalid log filename")
	}
	return filepath.Join(s.dataDir, "logs", filename), nil
}

func (s *DebugLogService) GetLog(id int64) (*models.DebugLog, string, error) {
	debugLog, err := s.repo.GetByID(id)
	if err != nil {
		return nil, "", err
	}
	if debugLog == nil {
		return nil, "", nil
	}

	filePath, err := s.logPath(debugLog.LogFilename)
	if err != nil {
		return nil, "", err
	}
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

	filePath, err := s.logPath(debugLog.LogFilename)
	if err != nil {
		return err
	}
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete log file: %w", err)
	}

	return s.repo.Delete(id)
}
