package websocket

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/ratelimit"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// Text channel send rate limit, per user and channel.
const (
	textSendLimit  = 5
	textSendWindow = 5 * time.Second
	// One typing event per user and channel every 3 s.
	textTypingWindow = 3 * time.Second
	// How often expired mutes are pushed to their owners.
	muteExpiryInterval = 10 * time.Second
)

// TextChat bundles the text channel store, read state and notification
// settings for the hub.
type TextChat struct {
	Store     *chatstore.Service
	ReadState chatstore.ReadStateStore
	Notify    chatstore.NotifyStore
	// UserExists filters mentions of unknown users; nil accepts every id.
	UserExists func(userID string) bool
	// Media stores attachments; nil when S3 is not configured.
	Media *chatmedia.Service
}

// SetTextChat enables text channel messaging over WebSocket.
func (h *Hub) SetTextChat(tc *TextChat) {
	h.mu.Lock()
	h.textChat = tc
	if h.textLimiter == nil {
		h.textLimiter = ratelimit.New()
	}
	h.mu.Unlock()
	if tc != nil && tc.Store != nil {
		tc.Store.SetRevertHandler(h.onTextRevert)
		tc.Store.SetMentionResolver(func(roomID string, users, roles []string) ([]string, []string) {
			return h.resolveMentions(tc, roomID, users, roles)
		})
	}
	if tc != nil && tc.Notify == nil {
		tc.Notify = chatstore.NewMemoryNotify()
	}
	if tc != nil && tc.Media != nil && tc.Store != nil {
		tc.Media.SetMessageHook(func(ctx context.Context, rec *chatmedia.Record, apply func(a *chatstore.Attachment) bool) {
			msg, err := tc.Store.SetAttachmentState(ctx, rec.MessageID, rec.ID, apply)
			if err != nil {
				if !errors.Is(err, chatstore.ErrNotFound) {
					log.Printf("[TextChat] Failed to update attachment %s in message %s: %v", rec.ID, rec.MessageID, err)
				}
				return
			}
			h.broadcastUpdated(msg)
		})
	}
}

func (h *Hub) textChatService() *TextChat {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.textChat
}

// isGlobalClient: text channel events go to the global socket only, so a
// user in a call (room socket + global socket) gets each event once.
func isGlobalClient(c *Client) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.roomID == ""
}

// broadcastText sends a text channel event to every global socket that can
// see the channel (VIEW_ROOM is re-checked per event, so permission changes
// apply immediately).
func (h *Hub) broadcastText(roomID string, message models.WebSocketMessage) {
	data := marshalMessage(message)
	ps := h.permissionService()
	h.mu.RLock()
	targets := make([]*Client, 0, len(h.clients))
	for client := range h.clients {
		targets = append(targets, client)
	}
	h.mu.RUnlock()
	for _, client := range targets {
		if !isGlobalClient(client) || !h.canInRoom(ps, client, roomID, permissions.ViewRoom) {
			continue
		}
		h.trySend(client, data)
	}
}

// sendTextToUser sends an event to all global sockets of one user.
func (h *Hub) sendTextToUser(userID string, message models.WebSocketMessage) {
	data := marshalMessage(message)
	h.mu.RLock()
	targets := make([]*Client, 0)
	for client := range h.clients {
		if client.userID == userID {
			targets = append(targets, client)
		}
	}
	h.mu.RUnlock()
	for _, client := range targets {
		if isGlobalClient(client) {
			h.trySend(client, data)
		}
	}
}

// Text error codes sent in text_error.
const (
	textErrUnavailable = "chat_unavailable"
	textErrRateLimited = "rate_limited"
	textErrInvalid     = "invalid"
	textErrNotFound    = "not_found"
	textErrForbidden   = "forbidden"
	textErrWriteFailed = "write_failed"
)

func (c *Client) sendTextError(code, message, nonce, messageID string) {
	data := map[string]string{"code": code, "message": message}
	if nonce != "" {
		data["nonce"] = nonce
	}
	if messageID != "" {
		data["message_id"] = messageID
	}
	c.hub.trySend(c, marshalMessage(models.WebSocketMessage{Type: "text_error", Data: data}))
}

// sendStoreError maps chatstore errors onto text_error codes.
func (c *Client) sendStoreError(err error, nonce, messageID string) {
	switch {
	case errors.Is(err, chatstore.ErrInvalid):
		c.sendTextError(textErrInvalid, err.Error(), nonce, messageID)
	case errors.Is(err, chatstore.ErrNotFound):
		c.sendTextError(textErrNotFound, "Message not found", nonce, messageID)
	case errors.Is(err, chatstore.ErrForbidden):
		c.sendTextError(textErrForbidden, "You can't do that", nonce, messageID)
	default:
		log.Printf("[TextChat] Store error: %v", err)
		c.sendTextError(textErrUnavailable, "Chat is temporarily unavailable", nonce, messageID)
	}
}

func decodeData(data interface{}, out any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

func (c *Client) identity() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.userID
}

// textRoom returns the room if it exists and is a text channel the client
// can see. Hidden channels are reported as not found.
func (c *Client) textRoom(roomID string) (*models.Room, bool) {
	if roomID == "" || c.hub.roomService == nil {
		return nil, false
	}
	room, ok := c.hub.roomService.GetRoom(roomID)
	if !ok || !room.IsText() {
		return nil, false
	}
	if !c.hub.canInRoom(c.hub.permissionService(), c, roomID, permissions.ViewRoom) {
		return nil, false
	}
	return room, true
}

// onTextRevert tells clients about a write Meilisearch failed to apply.
func (h *Hub) onTextRevert(rv chatstore.Revert) {
	if rv.Message == nil {
		h.broadcastText(rv.RoomID, models.WebSocketMessage{
			Type: "text_message_deleted",
			Data: map[string]any{"room_id": rv.RoomID, "id": rv.ID},
		})
	} else {
		h.broadcastText(rv.RoomID, models.WebSocketMessage{
			Type: "text_message_updated",
			Data: map[string]any{"room_id": rv.RoomID, "id": rv.ID, "message": rv.Message.Public()},
		})
	}
	if rv.SenderID != "" {
		h.sendTextToUser(rv.SenderID, models.WebSocketMessage{
			Type: "text_error",
			Data: map[string]string{"code": textErrWriteFailed, "message_id": rv.ID,
				"message": "A message change could not be saved"},
		})
	}
}

// BroadcastTextEvent lets REST handlers emit text channel events.
func (h *Hub) BroadcastTextEvent(roomID string, message models.WebSocketMessage) {
	h.broadcastText(roomID, message)
}

// SendTextToUser sends an event to all global sockets of one user (REST
// handlers use it for notification settings).
func (h *Hub) SendTextToUser(userID string, message models.WebSocketMessage) {
	h.sendTextToUser(userID, message)
}

func containsString(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (h *Hub) broadcastUpdated(msg *chatstore.Message) {
	h.broadcastText(msg.RoomID, models.WebSocketMessage{
		Type: "text_message_updated",
		Data: map[string]any{"room_id": msg.RoomID, "id": msg.ID, "message": msg.Public()},
	})
}
