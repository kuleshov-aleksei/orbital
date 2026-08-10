package websocket

import (
	"encoding/json"
	"log"

	"github.com/google/uuid"
	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// handleRequestLogs processes a super admin request for a target user's debug logs.
// The target user is notified via their room WebSocket connection and uploads
// the logs through the regular /api/logs endpoint.
func (c *Client) handleRequestLogs(data interface{}) {
	c.mu.RLock()
	requesterID := c.userID
	roomID := c.roomID
	c.mu.RUnlock()

	if requesterID == "" || roomID == "" {
		log.Printf("[LogRequest] Request from user %s ignored (not in a room)", requesterID)
		return
	}

	if c.hub.authService == nil {
		log.Printf("[LogRequest] authService is nil, cannot verify requester %s", requesterID)
		return
	}

	requester, err := c.hub.authService.GetUserByID(requesterID)
	if err != nil {
		log.Printf("[LogRequest] Failed to lookup requester %s: %v", requesterID, err)
		return
	}
	if requester == nil || requester.Role != models.RoleSuperAdmin {
		log.Printf("[LogRequest] User %s is not a super admin, request denied", requesterID)
		return
	}

	var req models.RequestLogsMessage
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil {
		log.Printf("[LogRequest] Failed to parse request: %v", err)
		return
	}
	if req.TargetUserID == "" {
		log.Printf("[LogRequest] Missing target_user_id from super admin %s", requesterID)
		return
	}

	command := models.WebSocketMessage{
		Type: "request_logs",
		Data: models.RequestLogsCommand{
			RequestID: uuid.New().String(),
		},
	}

	log.Printf("[LogRequest] Super admin %s requested logs from user %s in room %s", requesterID, req.TargetUserID, roomID)
	c.hub.SendToUser(roomID, req.TargetUserID, command)
}