package websocket

import (
	"context"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/permissions"
)

type textReactionRequest struct {
	MessageID string `json:"message_id"`
	Emoji     string `json:"emoji"`
}

func (c *Client) handleTextReactionToggle(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textReactionRequest
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
	if !c.hub.canInRoom(c.hub.permissionService(), c, msg.RoomID, permissions.SendMessages) {
		sendPermissionDenied(c, "text_reaction_toggle", msg.RoomID)
		c.sendTextError(textErrForbidden, "You don't have permission to react here", "", req.MessageID)
		return
	}
	if ok, _ := c.hub.textLimiter.Allow("react|"+userID, 10, 5*time.Second); !ok {
		c.sendTextError(textErrRateLimited, "You are reacting too fast", "", req.MessageID)
		return
	}
	updated, err := tc.Store.ToggleReaction(context.Background(), req.MessageID, userID, req.Emoji)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	c.hub.broadcastUpdated(updated)
}
