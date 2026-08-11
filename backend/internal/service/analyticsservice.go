package service

import (
	"sort"
	"time"
	"unicode"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

// AnalyticsService computes usage analytics from user sessions
type AnalyticsService struct {
	sessionRepo *repository.SessionRepository
}

func NewAnalyticsService(sessionRepo *repository.SessionRepository) *AnalyticsService {
	return &AnalyticsService{sessionRepo: sessionRepo}
}

// GetReport fetches all sessions and pre-calculates the analytics report
// consumed by the admin frontend. The users sankey shows distinct users per
// platform (a user using both web and electron appears in both branches),
// while the time sankey shows total call time per platform.
// Returns an empty report when session tracking is unavailable (memory-only mode).
func (s *AnalyticsService) GetReport() (*models.AnalyticsReport, error) {
	report := &models.AnalyticsReport{
		GeneratedAt: time.Now(),
	}

	if s.sessionRepo == nil {
		report.UsersSankey = models.SankeyDistribution{Nodes: []models.AnalyticsNode{}, Links: []models.AnalyticsLink{}}
		report.TimeSankey = models.SankeyDistribution{Nodes: []models.AnalyticsNode{}, Links: []models.AnalyticsLink{}}
		report.Platforms = []models.PlatformStat{}
		return report, nil
	}

	sessions, err := s.sessionRepo.GetAll()
	if err != nil {
		return nil, err
	}

	// statByPlatformSystem: platform -> system_name -> aggregate stats
	statByPlatformSystem := make(map[string]map[string]*models.PlatformStat)
	// usersByPlatform: platform -> user set (distinct users using that platform)
	usersByPlatform := make(map[string]map[string]struct{})
	// usersByPlatformSystem: platform -> system_name -> user set
	usersByPlatformSystem := make(map[string]map[string]map[string]struct{})
	// platformUsage: user -> platforms used (to detect web + electron overlap)
	platformUsage := make(map[string]map[string]struct{})

	for _, session := range sessions {
		duration := int64(session.LastSeen.Sub(session.FirstSeen).Seconds())
		if duration < 0 {
			duration = 0
		}
		report.TotalSessions++
		report.TotalDurationSeconds += duration

		platform := normalizePlatform(session.Platform)
		systemName := normalize(session.SystemName)

		// Aggregate time/session stats per platform + system
		if statByPlatformSystem[platform] == nil {
			statByPlatformSystem[platform] = make(map[string]*models.PlatformStat)
		}
		stat := statByPlatformSystem[platform][systemName]
		if stat == nil {
			stat = &models.PlatformStat{
				Platform:   platform,
				SystemName: systemName,
				FirstSeen:  session.FirstSeen,
				LastSeen:   session.LastSeen,
			}
			statByPlatformSystem[platform][systemName] = stat
		}
		stat.Sessions++
		stat.DurationSeconds += duration
		if session.FirstSeen.Before(stat.FirstSeen) {
			stat.FirstSeen = session.FirstSeen
		}
		if session.LastSeen.After(stat.LastSeen) {
			stat.LastSeen = session.LastSeen
		}

		// Track distinct users
		if usersByPlatform[platform] == nil {
			usersByPlatform[platform] = make(map[string]struct{})
		}
		usersByPlatform[platform][session.UserID] = struct{}{}
		if usersByPlatformSystem[platform] == nil {
			usersByPlatformSystem[platform] = make(map[string]map[string]struct{})
		}
		if usersByPlatformSystem[platform][systemName] == nil {
			usersByPlatformSystem[platform][systemName] = make(map[string]struct{})
		}
		usersByPlatformSystem[platform][systemName][session.UserID] = struct{}{}
		if platformUsage[session.UserID] == nil {
			platformUsage[session.UserID] = make(map[string]struct{})
		}
		platformUsage[session.UserID][platform] = struct{}{}
	}

	report.TotalUsers = int64(len(platformUsage))
	for _, platforms := range platformUsage {
		if len(platforms) > 1 {
			report.BothPlatformsUsers++
		}
	}

	// Fill platform stats with distinct user counts
	for platform, systems := range statByPlatformSystem {
		for systemName, stat := range systems {
			stat.Users = int64(len(usersByPlatformSystem[platform][systemName]))
		}
	}

	report.UsersSankey = buildUserSankey(statByPlatformSystem, usersByPlatform, usersByPlatformSystem)
	report.TimeSankey = buildTimeSankey(statByPlatformSystem)

	stats := make([]models.PlatformStat, 0, len(statByPlatformSystem))
	for _, systems := range statByPlatformSystem {
		for _, stat := range systems {
			stats = append(stats, *stat)
		}
	}
	sort.Slice(stats, func(i, j int) bool {
		if stats[i].Users != stats[j].Users {
			return stats[i].Users > stats[j].Users
		}
		return stats[i].Platform < stats[j].Platform
	})
	report.Platforms = stats

	return report, nil
}

// buildUserSankey creates: All users -> platform -> system, values are distinct
// user counts. Users who used multiple platforms/systems are counted in each
// branch they used, so branch values may overlap.
func buildUserSankey(statByPlatformSystem map[string]map[string]*models.PlatformStat, usersByPlatform map[string]map[string]struct{}, usersByPlatformSystem map[string]map[string]map[string]struct{}) models.SankeyDistribution {
	dist := models.SankeyDistribution{
		Nodes: []models.AnalyticsNode{
			{ID: "all", Name: "All users"},
		},
		Links: []models.AnalyticsLink{},
	}

	for _, platform := range sortedKeys(statByPlatformSystem) {
		platformUsers := len(usersByPlatform[platform])
		if platformUsers == 0 {
			continue
		}

		dist.Nodes = append(dist.Nodes, models.AnalyticsNode{ID: platform, Name: displayName(platform)})
		dist.Links = append(dist.Links, models.AnalyticsLink{
			Source: "all",
			Target: platform,
			Value:  float64(platformUsers),
		})

		for _, systemName := range sortedKeys(statByPlatformSystem[platform]) {
			systemUsers := len(usersByPlatformSystem[platform][systemName])
			if systemUsers == 0 {
				continue
			}

			nodeID := platform + ":" + systemName
			dist.Nodes = append(dist.Nodes, models.AnalyticsNode{ID: nodeID, Name: displayName(systemName)})
			dist.Links = append(dist.Links, models.AnalyticsLink{
				Source: platform,
				Target: nodeID,
				Value:  float64(systemUsers),
			})
		}
	}

	return dist
}

// buildTimeSankey creates: All time -> platform -> system, values are total
// call durations in seconds (summed across sessions).
func buildTimeSankey(statByPlatformSystem map[string]map[string]*models.PlatformStat) models.SankeyDistribution {
	dist := models.SankeyDistribution{
		Nodes: []models.AnalyticsNode{
			{ID: "all", Name: "All call time"},
		},
		Links: []models.AnalyticsLink{},
	}

	for _, platform := range sortedKeys(statByPlatformSystem) {
		var platformDuration int64
		for _, stat := range statByPlatformSystem[platform] {
			platformDuration += stat.DurationSeconds
		}
		if platformDuration == 0 {
			continue
		}

		dist.Nodes = append(dist.Nodes, models.AnalyticsNode{ID: platform, Name: displayName(platform)})
		dist.Links = append(dist.Links, models.AnalyticsLink{
			Source: "all",
			Target: platform,
			Value:  float64(platformDuration),
		})

		for _, systemName := range sortedKeys(statByPlatformSystem[platform]) {
			stat := statByPlatformSystem[platform][systemName]
			if stat.DurationSeconds == 0 {
				continue
			}

			nodeID := platform + ":" + systemName
			dist.Nodes = append(dist.Nodes, models.AnalyticsNode{ID: nodeID, Name: displayName(systemName)})
			dist.Links = append(dist.Links, models.AnalyticsLink{
				Source: platform,
				Target: nodeID,
				Value:  float64(stat.DurationSeconds),
			})
		}
	}

	return dist
}

// normalize returns a non-empty identifier, defaulting to "unknown"
func normalize(key string) string {
	if key == "" {
		return "unknown"
	}
	return key
}

// normalizePlatform maps legacy "web" sessions (recorded before mobile
// detection existed) to "web-desktop" so old data folds into the new
// structure instead of appearing as a separate "web" bucket.
func normalizePlatform(key string) string {
	if key == "web" {
		return "web-desktop"
	}
	return normalize(key)
}

// sortedKeys returns the map keys sorted alphabetically
func sortedKeys[T any](m map[string]T) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// displayName prettifies internal platform/system identifiers
func displayName(key string) string {
	switch key {
	case "web":
		return "Web"
	case "web-desktop":
		return "Web Desktop"
	case "web-mobile":
		return "Web Mobile"
	case "electron":
		return "Electron"
	case "darwin", "macos", "mac":
		return "macOS"
	case "windows", "win32", "windows_nt":
		return "Windows"
	case "linux":
		return "Linux"
	case "android":
		return "Android"
	case "ios":
		return "iOS"
	case "unknown", "":
		return "Unknown"
	default:
		r := []rune(key)
		if len(r) == 0 {
			return "Unknown"
		}
		r[0] = unicode.ToUpper(r[0])
		return string(r)
	}
}
