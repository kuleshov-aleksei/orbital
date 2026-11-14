package websocket

import (
	"log"
	"strings"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/service/push"
)

// resolveMentions keeps users that exist and can view the channel, and
// roles that exist; @everyone and Guest are never mentionable.
func (h *Hub) resolveMentions(tc *TextChat, roomID string, users, roles []string) ([]string, []string) {
	ps := h.permissionService()
	keptUsers := make([]string, 0, len(users))
	for _, id := range users {
		if tc.UserExists != nil && !tc.UserExists(id) {
			continue
		}
		if ps != nil && !ps.CanInRoom(ps.SubjectByID(id), roomID, permissions.ViewRoom) {
			continue
		}
		keptUsers = append(keptUsers, id)
	}
	keptRoles := make([]string, 0, len(roles))
	known := map[string]bool{}
	if ps != nil {
		for _, r := range ps.Roles() {
			known[r.ID] = true
		}
	}
	for _, id := range roles {
		if id == models.SystemRoleEveryone || id == models.SystemRoleGuest {
			continue
		}
		if ps != nil && !known[id] {
			continue
		}
		keptRoles = append(keptRoles, id)
	}
	return keptUsers, keptRoles
}

// mentionTargets lists the users a new message pings: direct mentions
// (including the reply ping) and current members of mentioned roles, who
// can view the channel and want mention pings there. Never the sender.
func (h *Hub) mentionTargets(tc *TextChat, msg *chatstore.Message) []string {
	targets := map[string]bool{}
	for _, id := range msg.MentionUserIDs {
		targets[id] = true
	}
	ps := h.permissionService()
	if len(msg.MentionRoleIDs) > 0 && ps != nil {
		for userID, roleIDs := range ps.AllUserRoleIDs() {
			for _, r := range roleIDs {
				if containsString(msg.MentionRoleIDs, r) {
					targets[userID] = true
					break
				}
			}
		}
	}
	delete(targets, msg.SenderID)
	now := tc.Store.Now()
	out := make([]string, 0, len(targets))
	for userID := range targets {
		if ps != nil && !ps.CanInRoom(ps.SubjectByID(userID), msg.RoomID, permissions.ViewRoom) {
			continue
		}
		setting, err := tc.Notify.Get(userID, msg.RoomID)
		if err != nil {
			log.Printf("[TextChat] Failed to load notification setting of %s: %v", userID, err)
		} else if !setting.WantsMentions(now) {
			continue
		}
		out = append(out, userID)
	}
	return out
}

func (h *Hub) pingMentions(tc *TextChat, msg *chatstore.Message) {
	var note *push.Notification
	for _, userID := range h.mentionTargets(tc, msg) {
		h.sendTextToUser(userID, models.WebSocketMessage{
			Type: "text_mention",
			Data: map[string]any{"room_id": msg.RoomID, "message_id": msg.ID, "sender_id": msg.SenderID},
		})
		if !tc.Push.Enabled() || h.userIsActive(userID) {
			continue
		}
		if note == nil {
			n := h.mentionNotification(tc, msg)
			note = &n
		}
		tc.Push.NotifyUser(userID, *note)
	}
}

// pushPreviewRunes caps the message preview in a push notification.
const pushPreviewRunes = 140

// mentionNotification renders the push for a mention:
// "#channel" / "Sender: preview".
func (h *Hub) mentionNotification(tc *TextChat, msg *chatstore.Message) push.Notification {
	userName := func(id string) string {
		if tc.UserName != nil {
			return tc.UserName(id)
		}
		return ""
	}
	roleNames := map[string]string{}
	if ps := h.permissionService(); ps != nil {
		for _, r := range ps.Roles() {
			roleNames[r.ID] = r.Name
		}
	}
	roleName := func(id string) string { return roleNames[id] }

	title := "Orbital"
	if h.roomService != nil {
		if room, ok := h.roomService.GetRoom(msg.RoomID); ok && room.Name != "" {
			title = "#" + chatstore.PlainText(room.Name, nil, nil)
		}
	}
	sender := userName(msg.SenderID)
	if sender == "" {
		sender = "Someone"
	}
	text := strings.Join(strings.Fields(chatstore.PlainText(msg.Content, userName, roleName)), " ")
	if text == "" && len(msg.Attachments) > 0 {
		text = "sent an attachment"
	}
	if r := []rune(text); len(r) > pushPreviewRunes {
		text = strings.TrimSpace(string(r[:pushPreviewRunes-1])) + "…"
	}
	body := sender
	if text != "" {
		body += ": " + text
	}
	return push.Notification{
		Title: title,
		Body:  body,
		Tag:   msg.RoomID,
		Data:  map[string]string{"type": "text_mention", "room_id": msg.RoomID, "message_id": msg.ID},
	}
}
