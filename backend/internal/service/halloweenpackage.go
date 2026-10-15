package service

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// Config package (.tar) layout, written and read without compression — tar
// entries are stored verbatim:
//

//	config.json          definitions + base layouts (HalloweenConfigExport schema)
//	assets/<item_id>.png backend-owned art, one entry per item that has a file
//
// Items without an art file are simply absent from assets/ and import artless
// (placeholders are seeded for them on import).
const (
	HalloweenPackageConfigName   = "config.json"
	HalloweenPackageAssetsPrefix = "assets/"
	HalloweenPackageAssetSuffix  = ".png"
)

// Size/shape caps for an uploaded package. The catalog is tiny (dozens of
// items, <=2MB PNGs each); these caps only stop abuse, not legit use.
const (
	MaxHalloweenPackageSize       = 128 << 20
	MaxHalloweenPackageEntries    = 2048
	MaxHalloweenPackageConfigSize = 4 << 20
)

// HalloweenPackageService bundles/unbundles the full pumpkin configuration:
// catalog definitions + base layouts + PNG art. It lives in the same package
// as HalloweenService on purpose, so it reuses its validation and repository.
type HalloweenPackageService struct {
	halloween *HalloweenService
	assets    *PumpkinAssetService
}

func NewHalloweenPackageService(halloween *HalloweenService, assets *PumpkinAssetService) *HalloweenPackageService {
	return &HalloweenPackageService{halloween: halloween, assets: assets}
}

// ExportPackage snapshots the live catalog + layouts + art PNGs into an
// uncompressed tar archive. Only real uploads are bundled: an item is
// included under assets/ when its asset_path is backend-owned and the file
// exists on disk.
func (s *HalloweenPackageService) ExportPackage() ([]byte, error) {
	if s.assets == nil {
		return nil, errors.New("asset storage not configured")
	}
	cfg, err := s.halloween.ExportConfig()
	if err != nil {
		return nil, err
	}

	// ExportConfig drops art columns; reload the live rows for asset_path.
	paths := map[string]string{}
	if catalog, err := s.halloween.repo.GetAllItems(); err != nil {
		return nil, err
	} else {
		for _, c := range catalog {
			paths[c.ID] = c.AssetPath
		}
	}

	configBytes, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	writeEntry := func(name string, data []byte) error {
		if err := tw.WriteHeader(&tar.Header{
			Name:    name,
			Mode:    0644,
			Size:    int64(len(data)),
			ModTime: time.Now().UTC(),
		}); err != nil {
			return err
		}
		_, err := tw.Write(data)
		return err
	}

	if err := writeEntry(HalloweenPackageConfigName, configBytes); err != nil {
		return nil, err
	}
	for _, item := range cfg.Items {
		if !strings.HasPrefix(paths[item.ID], PumpkinAssetURLPrefix) {
			continue
		}
		data, err := s.assets.ReadAsset(item.ID)
		if err != nil {
			if err == ErrPumpkinAssetNotFound {
				continue
			}
			return nil, err
		}
		name := HalloweenPackageAssetsPrefix + item.ID + HalloweenPackageAssetSuffix
		if err := writeEntry(name, data); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ImportPackage replaces the whole catalog + layouts + art from a package
// archive. Everything is validated before anything is written: any error
// aborts with the database untouched. On success the result summarizes what
// was applied (item/art counts, artless ids, removed ids).
func (s *HalloweenPackageService) ImportPackage(data []byte) (*models.HalloweenPackageImportResult, error) {
	if s.assets == nil {
		return nil, errors.New("asset storage not configured")
	}
	if len(data) == 0 {
		return nil, errors.New("package is empty")
	}
	if len(data) > MaxHalloweenPackageSize {
		return nil, errors.New("package exceeds size limit")
	}

	var configBytes []byte
	seen := map[string]bool{}
	art := map[string][]byte{}
	entries := 0

	tr := tar.NewReader(bytes.NewReader(data))
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid package: %w", err)
		}
		entries++
		if entries > MaxHalloweenPackageEntries {
			return nil, errors.New("package has too many entries")
		}
		name := hdr.Name
		if name == "" || name != path.Clean(name) {
			return nil, fmt.Errorf("invalid entry name: %q", hdr.Name)
		}
		if seen[name] {
			return nil, fmt.Errorf("duplicate entry: %s", name)
		}
		seen[name] = true

		switch {
		case name == HalloweenPackageConfigName:
			if hdr.Typeflag != tar.TypeReg && hdr.Typeflag != tar.TypeRegA {
				return nil, fmt.Errorf("invalid entry: %s", name)
			}
			if hdr.Size < 0 || hdr.Size > MaxHalloweenPackageConfigSize {
				return nil, fmt.Errorf("config.json exceeds size limit")
			}
			raw, err := io.ReadAll(io.LimitReader(tr, MaxHalloweenPackageConfigSize+1))
			if err != nil {
				return nil, fmt.Errorf("invalid package: %w", err)
			}
			if len(raw) > MaxHalloweenPackageConfigSize {
				return nil, fmt.Errorf("config.json exceeds size limit")
			}
			configBytes = raw
		case strings.HasPrefix(name, HalloweenPackageAssetsPrefix):
			rest := strings.TrimPrefix(name, HalloweenPackageAssetsPrefix)
			if !strings.HasSuffix(rest, HalloweenPackageAssetSuffix) {
				return nil, fmt.Errorf("unexpected entry: %s", name)
			}
			id := strings.TrimSuffix(rest, HalloweenPackageAssetSuffix)
			if !validPackageItemID(id) {
				return nil, fmt.Errorf("invalid asset id: %s", name)
			}
			if hdr.Typeflag != tar.TypeReg && hdr.Typeflag != tar.TypeRegA {
				return nil, fmt.Errorf("invalid entry: %s", name)
			}
			if hdr.Size < 0 || hdr.Size > MaxPumpkinAssetSize {
				return nil, fmt.Errorf("asset %s exceeds size limit", id)
			}
			raw, err := io.ReadAll(io.LimitReader(tr, MaxPumpkinAssetSize+1))
			if err != nil {
				return nil, fmt.Errorf("invalid package: %w", err)
			}
			if len(raw) > MaxPumpkinAssetSize {
				return nil, fmt.Errorf("asset %s exceeds size limit", id)
			}
			if len(raw) < len(pngMagic) || !bytes.Equal(raw[:len(pngMagic)], pngMagic) {
				return nil, fmt.Errorf("asset %s is not a PNG file", id)
			}
			art[id] = raw
		default:
			return nil, fmt.Errorf("unexpected entry: %s", name)
		}
	}

	if configBytes == nil {
		return nil, errors.New("package is missing config.json")
	}
	var req models.HalloweenConfigImport
	if err := json.Unmarshal(configBytes, &req); err != nil {
		return nil, fmt.Errorf("invalid config.json: %w", err)
	}
	cleanLayouts, err := validateHalloweenConfigImport(&req)
	if err != nil {
		return nil, err
	}

	byID := map[string]bool{}
	for _, item := range req.Items {
		byID[item.ID] = true
	}
	for id := range art {
		if !byID[id] {
			return nil, fmt.Errorf("asset for unknown item id: %s", id)
		}
	}

	stored, err := s.halloween.repo.GetAllItemsAdmin()
	if err != nil {
		return nil, err
	}
	storedIDs := map[string]bool{}
	for _, c := range stored {
		storedIDs[c.ID] = true
	}

	// Write art files before touching the database: validation already
	// passed, and stray files by stable id are harmless if the replace below
	// ever fails.
	assetURLs := map[string]string{}
	for id, png := range art {
		url, err := s.assets.SaveAsset(id, png)
		if err != nil {
			return nil, fmt.Errorf("failed to store asset %s: %w", id, err)
		}
		assetURLs[id] = url
	}

	if err := s.halloween.repo.ReplaceCatalog(req.Items, cleanLayouts); err != nil {
		return nil, err
	}

	missing := []string{}
	for _, item := range req.Items {
		if url, ok := assetURLs[item.ID]; ok {
			if err := s.halloween.repo.SetItemAssetPath(item.ID, url); err != nil {
				return nil, err
			}
		} else {
			if err := s.halloween.repo.SetItemAssetPath(item.ID, ""); err != nil {
				return nil, err
			}
			missing = append(missing, item.ID)
		}
	}

	// Artless items resolve to /api/halloween/assets/<id>, which 404s until a
	// file exists — seed placeholders now so they render immediately.
	seedCatalog := make([]*models.HalloweenItem, 0, len(req.Items))
	for _, item := range req.Items {
		seedCatalog = append(seedCatalog, &models.HalloweenItem{ID: item.ID, Socket: item.Socket})
	}
	if _, err := s.assets.SeedPlaceholders(seedCatalog); err != nil {
		return nil, err
	}

	removed := []string{}
	for id := range storedIDs {
		if !byID[id] {
			removed = append(removed, id)
		}
	}
	sort.Strings(removed)
	sort.Strings(missing)
	for _, id := range removed {
		if err := s.assets.DeleteAsset(id); err != nil {
			return nil, err
		}
	}

	return &models.HalloweenPackageImportResult{
		Status:         "imported",
		Items:          len(req.Items),
		AssetsIncluded: len(assetURLs),
		AssetsMissing:  missing,
		RemovedIDs:     removed,
	}, nil
}

// validPackageItemID accepts the same id charset the studio produces
// (letters, digits, dot, dash, underscore) with no path separators.
func validPackageItemID(id string) bool {
	if id == "" || id == "." || id == ".." {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_' || r == '-' || r == '.':
		default:
			return false
		}
	}
	return true
}
