package websocket

import (
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
)

type textTypingRequest struct {
	RoomID string `json:"room_id"`
}

func (c *Client) handleTextTyping(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textTypingRequest
	if err := decodeData(data, &req); err != nil || userID == "" || tc == nil {
		return
	}
	if _, ok := c.textRoom(req.RoomID); !ok {
		return
	}
	if !c.hub.canInRoom(c.hub.permissionService(), c, req.RoomID, permissions.SendMessages) {
		return
	}
	if ok, _ := c.hub.textLimiter.Allow("typing|"+userID+"|"+req.RoomID, 1, textTypingWindow); !ok {
		return
	}
	data2 := marshalMessage(models.WebSocketMessage{
		Type: "text_typing",
		Data: map[string]any{"room_id": req.RoomID, "user_id": userID},
	})
	ps := c.hub.permissionService()
	c.hub.mu.RLock()
	targets := make([]*Client, 0, len(c.hub.clients))
	for client := range c.hub.clients {
		if client.userID != userID {
			targets = append(targets, client)
		}
	}
	c.hub.mu.RUnlock()
	for _, client := range targets {
		if isGlobalClient(client) && c.hub.canInRoom(ps, client, req.RoomID, permissions.ViewRoom) {
			c.hub.trySend(client, data2)
		}
	}
}
