package websocket

import (
	"context"

	"github.com/kuleshov-aleksei/orbital/internal/permissions"
)

type textPinRequest struct {
	MessageID string `json:"message_id"`
	Pinned    bool   `json:"pinned"`
}

func (c *Client) handleTextPin(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textPinRequest
	if err := decodeData(data, &req); err != nil || userID == "" || req.MessageID == "" {
		return
	}
	if tc == nil {
		c.sendTextError(textErrUnavailable, "Text channels are disabled", "", req.MessageID)
		return
	}
	msg, err := c.visibleMessage(tc, req.MessageID)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	if !c.hub.canInRoom(c.hub.permissionService(), c, msg.RoomID, permissions.ManageMessages) {
		sendPermissionDenied(c, "text_pin", msg.RoomID)
		c.sendTextError(textErrForbidden, "You don't have permission to pin messages here", "", req.MessageID)
		return
	}
	updated, changed, err := tc.Store.SetPinned(context.Background(), req.MessageID, userID, req.Pinned)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	if changed {
		c.hub.broadcastUpdated(updated)
	}
}
