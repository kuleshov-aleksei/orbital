package service

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

const MaxPumpkinAssetSize = 2 * 1024 * 1024

var (
	ErrPumpkinAssetTooLarge    = errors.New("file size exceeds 2MB limit")
	ErrPumpkinAssetInvalidType = errors.New("invalid file type, only PNG files are allowed")
	ErrPumpkinAssetNotFound    = errors.New("pumpkin asset not found")
)

var pngMagic = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}

// PumpkinAssetService stores backend-owned pumpkin decoration art under
// <dataDir>/halloween/, mirroring AudioService. Files are named
// <item_id>.png so the catalog row is the source of truth. Nothing is
// embedded in the binary: initial art is seeded from <seedDir>/user-pumpkins/
// (<socket>.png) on server start, and uploads overwrite per-item files.
type PumpkinAssetService struct {
	dataDir string
	seedDir string
}

func NewPumpkinAssetService(dataDir string, seedDir string) *PumpkinAssetService {
	return &PumpkinAssetService{dataDir: dataDir, seedDir: seedDir}
}

func (s *PumpkinAssetService) SaveAsset(itemID string, fileData []byte) (string, error) {
	if len(fileData) > MaxPumpkinAssetSize {
		return "", ErrPumpkinAssetTooLarge
	}
	if len(fileData) < len(pngMagic) || !bytes.Equal(fileData[:len(pngMagic)], pngMagic) {
		return "", ErrPumpkinAssetInvalidType
	}

	dir := filepath.Join(s.dataDir, "halloween")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create halloween asset directory: %w", err)
	}

	filePath := filepath.Join(dir, itemID+".png")
	if err := os.WriteFile(filePath, fileData, 0644); err != nil {
		return "", fmt.Errorf("failed to save pumpkin asset: %w", err)
	}

	return fmt.Sprintf("/api/halloween/assets/%s", itemID), nil
}

func (s *PumpkinAssetService) AssetPath(itemID string) (string, error) {
	filePath := filepath.Join(s.dataDir, "halloween", itemID+".png")
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return "", ErrPumpkinAssetNotFound
	}

	return filePath, nil
}

// SeedPlaceholders copies the bundled per-socket placeholder art into the data
// dir for every catalog item that has no art file yet. Existing files
// (uploads or previous seeds) are never overwritten. Returns files created.
func (s *PumpkinAssetService) SeedPlaceholders(catalog []*models.HalloweenItem) (int, error) {
	dir := filepath.Join(s.dataDir, "halloween")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return 0, fmt.Errorf("failed to create halloween asset directory: %w", err)
	}

	seeded := 0
	for _, item := range catalog {
		switch item.Socket {
		case "base", "hat", "eyes", "mouth", "feet":
		default:
			continue
		}

		target := filepath.Join(dir, item.ID+".png")
		if _, err := os.Stat(target); err == nil {
			continue
		}

		source := filepath.Join(s.seedDir, "user-pumpkins", item.Socket+".png")
		data, err := os.ReadFile(source)
		if err != nil {
			return seeded, fmt.Errorf("missing seed art %s: %w", source, err)
		}
		if err := os.WriteFile(target, data, 0644); err != nil {
			return seeded, fmt.Errorf("failed to seed %s: %w", target, err)
		}
		seeded++
	}
	return seeded, nil
}
