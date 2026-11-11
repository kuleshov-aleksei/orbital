package websocket

import (
	"context"
	"errors"
	"log"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

type textSendRequest struct {
	RoomID    string   `json:"room_id"`
	Content   string   `json:"content"`
	ReplyToID string   `json:"reply_to_id"`
	ReplyPing *bool    `json:"reply_ping"`
	UploadIDs []string `json:"upload_ids"`
	Nonce     string   `json:"nonce"`
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
	in := chatstore.CreateInput{
		RoomID: req.RoomID, SenderID: userID, Content: req.Content,
		ReplyToID: req.ReplyToID, ReplyPing: replyPing,
	}
	var msg *chatstore.Message
	var err error
	if len(req.UploadIDs) == 0 {
		msg, err = tc.Store.Create(context.Background(), in)
	} else {
		if tc.Media == nil {
			c.sendTextError(textErrUnavailable, "Attachments are disabled", req.Nonce, "")
			return
		}
		if !c.hub.canInRoom(c.hub.permissionService(), c, req.RoomID, permissions.AttachFiles) {
			sendPermissionDenied(c, "text_message_send", req.RoomID)
			c.sendTextError(textErrForbidden, "You don't have permission to attach files here", req.Nonce, "")
			return
		}
		err = tc.Media.Attach(context.Background(), userID, req.RoomID, req.UploadIDs,
			func(atts []chatstore.Attachment) (string, error) {
				in.Attachments = atts
				m, err := tc.Store.Create(context.Background(), in)
				if err != nil {
					return "", err
				}
				msg = m
				return m.ID, nil
			})
		if errors.Is(err, chatmedia.ErrInvalid) {
			c.sendTextError(textErrInvalid, err.Error(), req.Nonce, "")
			return
		}
		if err != nil && msg != nil {
			// The message exists; only the bookkeeping update failed.
			log.Printf("[TextChat] Failed to mark uploads attached to %s: %v", msg.ID, err)
			err = nil
		}
	}
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
	c.hub.pingMentions(tc, msg)
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
	c.hub.broadcastUpdated(msg)
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
	if tc.Media != nil && len(msg.Attachments) > 0 {
		if err := tc.Media.RemoveForMessage(msg.ID); err != nil {
			log.Printf("[TextChat] Failed to remove attachments of deleted message %s: %v", msg.ID, err)
		}
	}
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
