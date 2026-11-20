package websocket

import (
	"context"
	"errors"
	"log"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatcmd"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

type textSendRequest struct {
	RoomID    string   `json:"room_id"`
	Content   string   `json:"content"`
	ReplyToID string   `json:"reply_to_id"`
	ReplyPing *bool    `json:"reply_ping"`
	UploadIDs []string `json:"upload_ids"`
	// SpoilerIDs is the subset of UploadIDs (images and videos) shown behind
	// a spoiler cover; other ids are ignored.
	SpoilerIDs []string `json:"spoiler_ids"`
	Nonce      string   `json:"nonce"`
	// TZ is the sender's IANA time zone, used by /remindme.
	TZ string `json:"tz"`
	// GIF is a shared third-party GIF (docs/specs/CHAT_SYSTEM.md §7.17).
	GIF *chatstore.GIF `json:"gif"`
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
	if req.Nonce != "" {
		switch existingID, state := c.hub.textNonces.claim(userID, req.Nonce); state {
		case nonceDone:
			// A resend after a lost echo: confirm the original message.
			c.ackExistingMessage(tc, existingID, req.Nonce)
			return
		case nonceInFlight:
			// The first copy is still being stored; its broadcast is the answer.
			return
		}
	}
	created := false
	defer func() {
		if req.Nonce != "" && !created {
			c.hub.textNonces.release(userID, req.Nonce)
		}
	}()
	if ok, _ := c.hub.textLimiter.Allow(userID+"|"+req.RoomID, textSendLimit, textSendWindow); !ok {
		c.sendTextError(textErrRateLimited, "You are sending messages too fast", req.Nonce, "")
		return
	}

	replyPing := req.ReplyPing == nil || *req.ReplyPing
	gif, err := chatstore.NormalizeGIF(req.GIF)
	if err != nil {
		c.sendTextError(textErrInvalid, err.Error(), req.Nonce, "")
		return
	}
	in := chatstore.CreateInput{
		RoomID: req.RoomID, SenderID: userID, Content: req.Content,
		ReplyToID: req.ReplyToID, ReplyPing: replyPing, GIF: gif,
	}
	reminder, ok := c.runCommand(tc, userID, &req, &in)
	if !ok {
		return
	}
	var msg *chatstore.Message
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
				markSpoilers(atts, req.SpoilerIDs)
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
	if req.Nonce != "" {
		created = true
		c.hub.textNonces.complete(userID, req.Nonce, msg.ID)
	}
	if reminder != nil {
		err := tc.Reminders.Add(chatstore.Reminder{
			UserID: userID, RoomID: msg.RoomID, MessageID: msg.ID,
			DueAtMS: reminder.DueAt.UnixMilli(), TZ: reminder.TZ, Note: reminder.Note,
		})
		if err != nil {
			log.Printf("[TextChat] Failed to store reminder of message %s: %v", msg.ID, err)
		}
	}
	c.hub.publishNewMessage(tc, msg, req.Nonce)
}

// publishNewMessage broadcasts a stored message and sends its mention pings
// and pushes (user sends and fired reminders).
func (h *Hub) publishNewMessage(tc *TextChat, msg *chatstore.Message, nonce string) {
	payload := map[string]any{"room_id": msg.RoomID, "message": msg.Public()}
	if nonce != "" {
		payload["nonce"] = nonce
	}
	if msg.ReplyToID != nil {
		if replied, err := tc.Store.Replied(context.Background(), msg); err == nil {
			payload["replied"] = replied
		}
	}
	h.broadcastText(msg.RoomID, models.WebSocketMessage{Type: "text_message_new", Data: payload})
	h.pushMessage(tc, msg, h.pingMentions(tc, msg))
	if msg.Command == nil {
		tc.Previews.Schedule(msg, h.broadcastUpdated)
	}
}

// maxPendingReminders caps /remindme per user.
const maxPendingReminders = 25

// runCommand turns a slash command into its result on in.Command. It
// returns false after answering the sender with an error. A /remindme
// returns the reminder to store once the message exists.
func (c *Client) runCommand(tc *TextChat, userID string, req *textSendRequest, in *chatstore.CreateInput) (*chatcmd.ReminderSpec, bool) {
	inv, ok := chatcmd.Parse(req.Content)
	if !ok {
		return nil, true
	}
	if len(req.UploadIDs) > 0 {
		c.sendTextError(textErrInvalid, "Commands can't have attachments", req.Nonce, "")
		return nil, false
	}
	if inv.Name == chatstore.CommandRemindMe {
		n, err := tc.Reminders.CountPending(userID)
		if err != nil {
			log.Printf("[TextChat] Failed to count reminders of %s: %v", userID, err)
			c.sendTextError(textErrWriteFailed, "Couldn't save the reminder", req.Nonce, "")
			return nil, false
		}
		if n >= maxPendingReminders {
			c.sendTextError(textErrInvalid, "You have too many pending reminders", req.Nonce, "")
			return nil, false
		}
	}
	cmd, reminder, err := chatcmd.Execute(inv, tc.Store.Now(), req.TZ)
	if err != nil {
		if chatcmd.IsUsage(err) {
			c.sendTextError(textErrInvalid, err.Error(), req.Nonce, "")
		} else {
			log.Printf("[TextChat] Command /%s failed: %v", inv.Name, err)
			c.sendTextError(textErrWriteFailed, "The command failed", req.Nonce, "")
		}
		return nil, false
	}
	in.Command = cmd
	return reminder, true
}

// markSpoilers flags the images and videos whose ids the sender listed.
func markSpoilers(atts []chatstore.Attachment, ids []string) {
	if len(ids) == 0 {
		return
	}
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	for i := range atts {
		k := atts[i].Kind
		if set[atts[i].ID] && (k == chatmedia.KindImage || k == chatmedia.KindVideo) {
			atts[i].Spoiler = true
		}
	}
}

// ackExistingMessage answers a duplicate send with the message the nonce
// already created, to this client only (everyone else has it already).
func (c *Client) ackExistingMessage(tc *TextChat, messageID, nonce string) {
	msg, err := c.visibleMessage(tc, messageID)
	if err != nil {
		// Deleted (or hidden) since: nothing to resend, and nothing to retry.
		c.sendTextError(textErrNotFound, "Message not found", nonce, messageID)
		return
	}
	payload := map[string]any{"room_id": msg.RoomID, "message": msg.Public(), "nonce": nonce}
	if msg.ReplyToID != nil {
		if replied, err := tc.Store.Replied(context.Background(), msg); err == nil {
			payload["replied"] = replied
		}
	}
	c.hub.trySend(c, marshalMessage(models.WebSocketMessage{Type: "text_message_new", Data: payload}))
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
	current, err := c.visibleMessage(tc, req.MessageID)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	// An edit publishes new text, so it needs the same permission as a send.
	if !c.hub.canInRoom(c.hub.permissionService(), c, current.RoomID, permissions.SendMessages) {
		sendPermissionDenied(c, "text_message_edit", current.RoomID)
		c.sendTextError(textErrForbidden, "You don't have permission to send messages here", "", req.MessageID)
		return
	}
	msg, err := tc.Store.Edit(context.Background(), req.MessageID, userID, req.Content)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	c.hub.broadcastUpdated(msg)
	tc.Previews.Schedule(msg, c.hub.broadcastUpdated)
}

type textSuppressEmbedsRequest struct {
	MessageID string `json:"message_id"`
}

// handleTextMessageSuppressEmbeds removes a message's link previews. The
// author may always; others need ManageMessages in the channel.
func (c *Client) handleTextMessageSuppressEmbeds(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textSuppressEmbedsRequest
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
	msg, err := tc.Store.SuppressEmbeds(context.Background(), req.MessageID, userID, func(roomID string) bool {
		return c.hub.canInRoom(ps, c, roomID, permissions.ManageMessages)
	})
	if err != nil {
		if errors.Is(err, chatstore.ErrForbidden) {
			sendPermissionDenied(c, "text_message_suppress_embeds", "")
		}
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
	if msg.Command != nil && msg.Command.Name == chatstore.CommandRemindMe {
		// Deleting a /remindme cancels it.
		if err := tc.Reminders.DeleteByMessage(msg.ID); err != nil {
			log.Printf("[TextChat] Failed to cancel reminder of message %s: %v", msg.ID, err)
		}
	}
	c.hub.broadcastText(msg.RoomID, models.WebSocketMessage{
		Type: "text_message_deleted",
		Data: map[string]any{"room_id": msg.RoomID, "id": msg.ID, "newest_seq": tc.Store.NewestSeq(msg.RoomID)},
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
	// Reading the channel anywhere ends its push summaries.
	c.hub.textPushes.reset(pushKey{userID: userID, roomID: req.RoomID})
	c.hub.sendTextToUser(userID, models.WebSocketMessage{
		Type: "text_read_state",
		Data: map[string]any{"room_id": req.RoomID, "last_read_seq": stored},
	})
}
