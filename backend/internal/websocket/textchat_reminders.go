package websocket

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// reminderInterval is how often due /remindme reminders are fired.
const reminderInterval = 15 * time.Second

// StartReminders runs FireReminders periodically until ctx ends. Reminders
// that came due while the server was down fire on the first tick.
func (h *Hub) StartReminders(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(reminderInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				h.FireReminders(now)
			}
		}
	}()
}

// FireReminders posts every due reminder as a system message in its
// channel: a reply to the /remindme message that mentions its owner.
func (h *Hub) FireReminders(now time.Time) {
	tc := h.textChatService()
	if tc == nil || tc.Reminders == nil || tc.Store == nil {
		return
	}
	due, err := tc.Reminders.TakeDue(now.UnixMilli())
	if err != nil {
		log.Printf("[TextChat] Failed to load due reminders: %v", err)
		return
	}
	for _, r := range due {
		if !h.reminderDeliverable(r) {
			continue
		}
		msg, err := h.postReminder(tc, r)
		if err != nil {
			// Meilisearch is down: keep the reminder for the next tick.
			log.Printf("[TextChat] Failed to post reminder %d: %v", r.ID, err)
			if err := tc.Reminders.Add(r); err != nil {
				log.Printf("[TextChat] Lost reminder %d: %v", r.ID, err)
			}
			continue
		}
		h.publishNewMessage(tc, msg, "")
	}
}

// reminderDeliverable: the channel still exists and its owner can see it.
func (h *Hub) reminderDeliverable(r chatstore.Reminder) bool {
	if h.roomService != nil {
		if room, ok := h.roomService.GetRoom(r.RoomID); !ok || !room.IsText() {
			return false
		}
	}
	if ps := h.permissionService(); ps != nil && !ps.CanInRoom(ps.SubjectByID(r.UserID), r.RoomID, permissions.ViewRoom) {
		return false
	}
	return true
}

func (h *Hub) postReminder(tc *TextChat, r chatstore.Reminder) (*chatstore.Message, error) {
	ctx := context.Background()
	in := chatstore.CreateInput{
		RoomID:    r.RoomID,
		SenderID:  chatstore.SystemSenderID,
		Content:   "<@" + r.UserID + ">",
		ReplyToID: r.MessageID,
		ReplyPing: true,
		Command: &chatstore.Command{
			Name: chatstore.CommandReminder, ReminderFor: r.UserID,
			DueAtTS: r.DueAtMS, TZ: r.TZ, Note: r.Note,
		},
	}
	if r.Note != "" {
		in.Content += " " + r.Note
	}
	// The /remindme message is normally gone only when it was deleted (which
	// cancels the reminder); if it vanished anyway, post without the reply.
	if _, err := tc.Store.Get(ctx, r.MessageID); errors.Is(err, chatstore.ErrNotFound) {
		in.ReplyToID = ""
	}
	return tc.Store.Create(ctx, in)
}
