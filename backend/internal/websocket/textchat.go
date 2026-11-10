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
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// Text channel send rate limit, per user and channel.
const (
	textSendLimit  = 5
	textSendWindow = 5 * time.Second
)

// TextChat bundles the text channel store and read state for the hub.
type TextChat struct {
	Store     *chatstore.Service
	ReadState chatstore.ReadStateStore
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

type textSendRequest struct {
	RoomID    string `json:"room_id"`
	Content   string `json:"content"`
	ReplyToID string `json:"reply_to_id"`
	ReplyPing *bool  `json:"reply_ping"`
	Nonce     string `json:"nonce"`
}

func (c *Client) handleTextMessageSend(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textSendRequest
	if err := decodeData(data, &req); err != nil || userID == "" {
		return
	}
	if len(req.Nonce) > 64 {
		req.Nonce = req.Nonce[:64]
	}
	if tc == nil {
		c.sendTextError(textErrUnavailable, "Text channels are disabled", req.Nonce, "")
		return
	}
	if _, ok := c.textRoom(req.RoomID); !ok {
		c.sendTextError(textErrNotFound, "Channel not found", req.Nonce, "")
		return
	}
	if !c.hub.canInRoom(c.hub.permissionService(), c, req.RoomID, permissions.SendMessages) {
		sendPermissionDenied(c, "text_message_send", req.RoomID)
		c.sendTextError(textErrForbidden, "You don't have permission to send messages here", req.Nonce, "")
		return
	}
	if ok, _ := c.hub.textLimiter.Allow(userID+"|"+req.RoomID, textSendLimit, textSendWindow); !ok {
		c.sendTextError(textErrRateLimited, "You are sending messages too fast", req.Nonce, "")
		return
	}

	replyPing := req.ReplyPing == nil || *req.ReplyPing
	msg, err := tc.Store.Create(context.Background(), chatstore.CreateInput{
		RoomID: req.RoomID, SenderID: userID, Content: req.Content,
		ReplyToID: req.ReplyToID, ReplyPing: replyPing,
	})
	if err != nil {
		c.sendStoreError(err, req.Nonce, "")
		return
	}
	payload := map[string]any{"room_id": msg.RoomID, "message": msg.Public()}
	if req.Nonce != "" {
		payload["nonce"] = req.Nonce
	}
	if msg.ReplyToID != nil {
		if replied, err := tc.Store.Replied(context.Background(), msg); err == nil {
			payload["replied"] = replied
		}
	}
	c.hub.broadcastText(msg.RoomID, models.WebSocketMessage{Type: "text_message_new", Data: payload})
}

type textEditRequest struct {
	MessageID string `json:"message_id"`
	Content   string `json:"content"`
}

// visibleMessage loads a message the client can see (its channel is visible).
func (c *Client) visibleMessage(tc *TextChat, id string) (*chatstore.Message, error) {
	msg, err := tc.Store.Get(context.Background(), id)
	if err != nil {
		return nil, err
	}
	if _, ok := c.textRoom(msg.RoomID); !ok {
		return nil, chatstore.ErrNotFound
	}
	return msg, nil
}

func (c *Client) handleTextMessageEdit(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textEditRequest
	if err := decodeData(data, &req); err != nil || userID == "" || req.MessageID == "" {
		return
	}
	if tc == nil {
		c.sendTextError(textErrUnavailable, "Text channels are disabled", "", req.MessageID)
		return
	}
	if _, err := c.visibleMessage(tc, req.MessageID); err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	msg, err := tc.Store.Edit(context.Background(), req.MessageID, userID, req.Content)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	c.hub.broadcastText(msg.RoomID, models.WebSocketMessage{
		Type: "text_message_updated",
		Data: map[string]any{"room_id": msg.RoomID, "id": msg.ID, "message": msg.Public()},
	})
}

type textDeleteRequest struct {
	MessageID string `json:"message_id"`
}

func (c *Client) handleTextMessageDelete(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textDeleteRequest
	if err := decodeData(data, &req); err != nil || userID == "" || req.MessageID == "" {
		return
	}
	if tc == nil {
		c.sendTextError(textErrUnavailable, "Text channels are disabled", "", req.MessageID)
		return
	}
	if _, err := c.visibleMessage(tc, req.MessageID); err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	ps := c.hub.permissionService()
	msg, err := tc.Store.Delete(context.Background(), req.MessageID, userID, func(roomID string) bool {
		return c.hub.canInRoom(ps, c, roomID, permissions.ManageMessages)
	})
	if err != nil {
		if errors.Is(err, chatstore.ErrForbidden) {
			sendPermissionDenied(c, "text_message_delete", "")
		}
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	c.hub.broadcastText(msg.RoomID, models.WebSocketMessage{
		Type: "text_message_deleted",
		Data: map[string]any{"room_id": msg.RoomID, "id": msg.ID},
	})
}

type textReadRequest struct {
	RoomID string `json:"room_id"`
	Seq    int64  `json:"seq"`
}

func (c *Client) handleTextChannelRead(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textReadRequest
	if err := decodeData(data, &req); err != nil || userID == "" || tc == nil || req.Seq <= 0 {
		return
	}
	if _, ok := c.textRoom(req.RoomID); !ok {
		return
	}
	// Never record a position beyond the newest message.
	if newest := tc.Store.NewestSeq(req.RoomID); req.Seq > newest {
		req.Seq = newest
	}
	if req.Seq <= 0 {
		return
	}
	stored, err := tc.ReadState.Advance(userID, req.RoomID, req.Seq)
	if err != nil {
		log.Printf("[TextChat] Failed to store read state for %s in %s: %v", userID, req.RoomID, err)
		return
	}
	c.hub.sendTextToUser(userID, models.WebSocketMessage{
		Type: "text_read_state",
		Data: map[string]any{"room_id": req.RoomID, "last_read_seq": stored},
	})
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
