package websocket

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// Polls (docs/specs/CHAT_SYSTEM.md §7.18). A poll is created with
// text_message_send ({poll: ...}); these handle voting and closing.

type textPollVoteRequest struct {
	MessageID string   `json:"message_id"`
	OptionIDs []string `json:"option_ids"`
}

type textPollCloseRequest struct {
	MessageID string `json:"message_id"`
}

// maxPollVoteIDs bounds a vote request (more than any poll has options).
const maxPollVoteIDs = 2 * chatstore.MaxPollOptions

// handleTextPollVote replaces the sender's vote; no options retracts it.
// Voting needs SendMessages, like reacting.
func (c *Client) handleTextPollVote(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textPollVoteRequest
	if err := decodeData(data, &req); err != nil || userID == "" || req.MessageID == "" {
		return
	}
	if tc == nil {
		c.sendTextError(textErrUnavailable, "Text channels are disabled", "", req.MessageID)
		return
	}
	if len(req.OptionIDs) > maxPollVoteIDs {
		c.sendTextError(textErrInvalid, "Too many options", "", req.MessageID)
		return
	}
	msg, err := c.visibleMessage(tc, req.MessageID)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	if !c.hub.canInRoom(c.hub.permissionService(), c, msg.RoomID, permissions.SendMessages) {
		sendPermissionDenied(c, "text_poll_vote", msg.RoomID)
		c.sendTextError(textErrForbidden, "You don't have permission to vote here", "", req.MessageID)
		return
	}
	if ok, _ := c.hub.textLimiter.Allow("poll|"+userID, 10, 5*time.Second); !ok {
		c.sendTextError(textErrRateLimited, "You are voting too fast", "", req.MessageID)
		return
	}
	updated, err := tc.Store.Vote(context.Background(), req.MessageID, userID, req.OptionIDs)
	if err != nil {
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	c.hub.broadcastUpdated(updated)
}

// handleTextPollClose ends a poll early: its author may, others need
// ManageMessages in the channel.
func (c *Client) handleTextPollClose(data interface{}) {
	tc := c.hub.textChatService()
	userID := c.identity()
	var req textPollCloseRequest
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
	msg, changed, err := tc.Store.ClosePoll(context.Background(), req.MessageID, userID, func(roomID string) bool {
		return c.hub.canInRoom(ps, c, roomID, permissions.ManageMessages)
	})
	if err != nil {
		if errors.Is(err, chatstore.ErrForbidden) {
			sendPermissionDenied(c, "text_poll_close", "")
		}
		c.sendStoreError(err, "", req.MessageID)
		return
	}
	if !changed {
		c.hub.broadcastUpdated(msg) // answers the client's pending state
		return
	}
	if err := tc.PollDeadlines.DeleteByMessage(msg.ID); err != nil {
		log.Printf("[TextChat] Failed to drop the due date of poll %s: %v", msg.ID, err)
	}
	c.hub.finishPoll(tc, msg)
}

// ClosePollsDue closes every poll whose due date passed (run by the
// reminder ticker; polls that came due while the server was down close on
// the first tick).
func (h *Hub) ClosePollsDue(now time.Time) {
	tc := h.textChatService()
	if tc == nil || tc.PollDeadlines == nil || tc.Store == nil {
		return
	}
	due, err := tc.PollDeadlines.TakeDue(now.UnixMilli())
	if err != nil {
		log.Printf("[TextChat] Failed to load due polls: %v", err)
		return
	}
	for _, d := range due {
		msg, changed, err := tc.Store.ClosePoll(context.Background(), d.MessageID, chatstore.SystemSenderID, nil)
		switch {
		case errors.Is(err, chatstore.ErrNotFound) || errors.Is(err, chatstore.ErrInvalid):
			continue // deleted meanwhile
		case err != nil:
			// Meilisearch is down: keep the deadline for the next tick.
			log.Printf("[TextChat] Failed to close poll %s: %v", d.MessageID, err)
			if err := tc.PollDeadlines.Add(d); err != nil {
				log.Printf("[TextChat] Lost the due date of poll %s: %v", d.MessageID, err)
			}
			continue
		case !changed:
			continue // ended early, already announced
		}
		h.finishPoll(tc, msg)
	}
}

// finishPoll broadcasts a just-closed poll and announces its result.
func (h *Hub) finishPoll(tc *TextChat, poll *chatstore.Message) {
	h.broadcastUpdated(poll)
	if h.roomService != nil {
		if room, ok := h.roomService.GetRoom(poll.RoomID); !ok || !room.IsText() {
			return
		}
	}
	msg, err := tc.Store.Create(context.Background(), pollClosedInput(poll))
	if err != nil {
		log.Printf("[TextChat] Failed to announce the end of poll %s: %v", poll.ID, err)
		return
	}
	h.publishNewMessage(tc, msg, "")
}

// pollClosedInput is the system message announcing a closed poll: a reply
// to it (no ping) carrying the result.
func pollClosedInput(poll *chatstore.Message) chatstore.CreateInput {
	winners, top, voters := poll.Poll.PollResult()
	topVotes, voterCount := int64(top), int64(voters)
	return chatstore.CreateInput{
		RoomID:    poll.RoomID,
		SenderID:  chatstore.SystemSenderID,
		Content:   "Poll ended: " + poll.Poll.Question,
		ReplyToID: poll.ID,
		Command: &chatstore.Command{
			Name: chatstore.CommandPollClosed, PollID: poll.ID,
			Options: winners, Result: &topVotes, Voters: &voterCount,
		},
	}
}
