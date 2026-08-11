package websocket

import (
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// sessionDedupeWindow is how long a session row is considered "the same call".
// Reconnects within this window reuse the existing row (1 call = 1 row per user).
const sessionDedupeWindow = 5 * time.Minute

// deviceInfoJSON mirrors the relevant fields of the client's system info payload
type deviceInfoJSON struct {
	IsElectron bool `json:"is_electron"`
	IsMobile   bool `json:"is_mobile"`
	Browser    struct {
		Name string `json:"name"`
	} `json:"browser"`
	Electron *struct {
		OsType string `json:"os_type"`
	} `json:"electron"`
}

// parseDeviceInfo extracts platform ("web-desktop"/"web-mobile"/"electron")
// and system_name (browser name for web, OS name for electron) from the
// client's JSON system info payload. Falls back to "unknown" for missing values.
func parseDeviceInfo(jsonStr string) (platform, systemName string) {
	platform = "unknown"
	systemName = "unknown"

	if jsonStr == "" {
		return
	}

	var info deviceInfoJSON
	if err := json.Unmarshal([]byte(jsonStr), &info); err != nil {
		log.Printf("[Session] Failed to parse device info JSON: %v", err)
		return
	}

	if info.IsElectron {
		platform = "electron"
		if info.Electron != nil && info.Electron.OsType != "" {
			systemName = strings.ToLower(info.Electron.OsType)
		}
	} else {
		if info.IsMobile {
			platform = "web-mobile"
		} else {
			platform = "web-desktop"
		}
		if name := strings.ToLower(info.Browser.Name); name != "" {
			systemName = name
		}
	}

	return platform, systemName
}

// recordSessionStart creates or reuses the session row for a user joining a call.
// A "call" = joining a room; reconnects within the dedupe window reuse the row.
func (h *Hub) recordSessionStart(userID, roomID, deviceInfo string) {
	if h.sessionRepo == nil || userID == "" || roomID == "" {
		return
	}

	now := time.Now()
	recent, err := h.sessionRepo.FindRecentByUserRoom(userID, roomID, now.Add(-sessionDedupeWindow))
	if err != nil {
		log.Printf("[Session] Failed to find recent session for user %s in room %s: %v", userID, roomID, err)
		return
	}

	if recent != nil {
		if deviceInfo != "" {
			platform, systemName := parseDeviceInfo(deviceInfo)
			if platform != "unknown" && platform != recent.Platform {
				recent.Platform = platform
				recent.SystemName = systemName
				recent.DeviceInfo = deviceInfo
			}
		}
		recent.LastSeen = now
		if err := h.sessionRepo.UpdateLastSeen(recent.UserID, recent.RoomID, now); err != nil {
			log.Printf("[Session] Failed to update last_seen on join for user %s: %v", userID, err)
		}
		return
	}

	platform, systemName := parseDeviceInfo(deviceInfo)
	session := &models.UserSession{
		UserID:     userID,
		RoomID:     roomID,
		FirstSeen:  now,
		LastSeen:   now,
		Platform:   platform,
		SystemName: systemName,
		DeviceInfo: deviceInfo,
	}
	if err := h.sessionRepo.Create(session); err != nil {
		log.Printf("[Session] Failed to create session for user %s in room %s: %v", userID, roomID, err)
		return
	}
	log.Printf("[Session] Session started for user %s in room %s (platform: %s, system: %s)", userID, roomID, platform, systemName)
}

// updateSessionLastSeen refreshes the session row for a user in a room.
// Called on every ping and on call exit to keep durations accurate.
func (h *Hub) updateSessionLastSeen(userID, roomID string) {
	if h.sessionRepo == nil || userID == "" || roomID == "" {
		return
	}
	if err := h.sessionRepo.UpdateLastSeen(userID, roomID, time.Now()); err != nil {
		log.Printf("[Session] Failed to update last_seen for user %s in room %s: %v", userID, roomID, err)
	}
}
