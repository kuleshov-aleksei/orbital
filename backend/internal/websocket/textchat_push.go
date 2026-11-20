package websocket

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/service/push"
)

// Push notifications for text channels (docs/specs/CHAT_SYSTEM.md §7.4).
//
// Every message pushes to users with no active session whose channel is not
// muted. Mentions push at once (channel "mentions"). Other messages push the
// first one as a preview, then stay quiet for pushCooldown; messages that
// arrive meanwhile are summed up in one "N new messages" push when the
// cooldown ends, which replaces the preview (same tag). Reading the channel
// resets the count.

// pushCooldown is the minimum gap between two message pushes of a channel.
const pushCooldown = 60 * time.Second

// pushPreviewRunes caps the message preview in a push notification.
const pushPreviewRunes = 140

type pushKey struct {
	userID string
	roomID string
}

type pushState struct {
	// missed counts messages since the user last read the channel.
	missed int
	// unsent counts messages that arrived during the current cooldown.
	unsent    int
	lastMsgID string
	// senders of the missed messages, in order of first message.
	senders []string
	// timer is the running cooldown; nil when none is running.
	timer *time.Timer
}

// pushThrottle tracks the cooldown per (user, channel). It never calls out
// while holding its lock.
type pushThrottle struct {
	mu       sync.Mutex
	cooldown time.Duration
	states   map[pushKey]*pushState
}

func newPushThrottle(cooldown time.Duration) *pushThrottle {
	return &pushThrottle{cooldown: cooldown, states: map[pushKey]*pushState{}}
}

// count records a missed message.
func (t *pushThrottle) count(k pushKey, msgID, senderID string) *pushState {
	st := t.states[k]
	if st == nil {
		st = &pushState{}
		t.states[k] = st
	}
	st.missed++
	st.lastMsgID = msgID
	if !containsString(st.senders, senderID) {
		st.senders = append(st.senders, senderID)
	}
	return st
}

// message counts a message and reports whether to push its preview now
// (no cooldown running; one starts and calls flush when it ends).
func (t *pushThrottle) message(k pushKey, msgID, senderID string, flush func()) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	st := t.count(k, msgID, senderID)
	if st.timer == nil {
		st.timer = time.AfterFunc(t.cooldown, flush)
		return true
	}
	st.unsent++
	return false
}

// mention counts a message that got its own (mention) push.
func (t *pushThrottle) mention(k pushKey, msgID, senderID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.count(k, msgID, senderID)
}

// pushSummary is what a cooldown's summary push reports.
type pushSummary struct {
	missed    int
	lastMsgID string
	senders   []string
}

// take ends the cooldown. It returns the summary to push, if messages
// arrived during it.
func (t *pushThrottle) take(k pushKey) (pushSummary, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	st := t.states[k]
	if st == nil {
		return pushSummary{}, false
	}
	st.timer = nil
	if st.unsent == 0 {
		return pushSummary{}, false
	}
	st.unsent = 0
	return pushSummary{missed: st.missed, lastMsgID: st.lastMsgID, senders: append([]string(nil), st.senders...)}, true
}

// restart starts a new cooldown after a summary push, unless one already
// runs (a message pushed its preview in between).
func (t *pushThrottle) restart(k pushKey, flush func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if st := t.states[k]; st != nil && st.timer == nil {
		st.timer = time.AfterFunc(t.cooldown, flush)
	}
}

// reset forgets a channel's count (the user read it).
func (t *pushThrottle) reset(k pushKey) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if st := t.states[k]; st != nil {
		if st.timer != nil {
			st.timer.Stop()
		}
		delete(t.states, k)
	}
}

// pushMessage sends the pushes for a new message. mentioned are the users
// pingMentions notified (they can view the channel and want mentions).
func (h *Hub) pushMessage(tc *TextChat, msg *chatstore.Message, mentioned []string) {
	if !tc.Push.Enabled() {
		return
	}
	isMentioned := make(map[string]bool, len(mentioned))
	for _, id := range mentioned {
		isMentioned[id] = true
	}
	var mentionNote, previewNote *push.Notification
	for _, userID := range tc.Push.UsersWithDevices() {
		if userID == msg.SenderID {
			continue
		}
		k := pushKey{userID: userID, roomID: msg.RoomID}
		if isMentioned[userID] {
			if h.userIsActive(userID) {
				continue
			}
			h.textPushes.mention(k, msg.ID, msg.SenderID)
			if mentionNote == nil {
				n := h.messageNotification(tc, msg, true)
				mentionNote = &n
			}
			tc.Push.NotifyUser(userID, *mentionNote)
			continue
		}
		if !h.wantsMessagePush(tc, userID, msg.RoomID) || h.userIsActive(userID) {
			continue
		}
		if !h.textPushes.message(k, msg.ID, msg.SenderID, func() { h.flushPush(tc, k) }) {
			continue
		}
		if previewNote == nil {
			n := h.messageNotification(tc, msg, false)
			previewNote = &n
		}
		tc.Push.NotifyUser(userID, *previewNote)
	}
}

// flushPush runs when a cooldown ends: it sums up the messages that
// arrived during it, if the user still can't see them.
func (h *Hub) flushPush(tc *TextChat, k pushKey) {
	sum, ok := h.textPushes.take(k)
	if !ok || !h.wantsMessagePush(tc, k.userID, k.roomID) || h.userIsActive(k.userID) {
		return
	}
	h.textPushes.restart(k, func() { h.flushPush(tc, k) })
	tc.Push.NotifyUser(k.userID, push.Notification{
		Title:     h.pushTitle(k.roomID),
		Body:      summaryBody(sum.missed, senderNames(tc, sum.senders)),
		Tag:       k.roomID,
		Data:      map[string]string{"type": "text_message", "room_id": k.roomID, "message_id": sum.lastMsgID},
		ChannelID: push.MessagesChannelID,
	})
}

// pushSummaryNames is how many senders a summary names before "N others".
const pushSummaryNames = 2

// senderNames resolves sender ids to display names, dropping unknown ones.
func senderNames(tc *TextChat, ids []string) []string {
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		if tc.UserName == nil {
			break
		}
		if name := tc.UserName(id); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// summaryBody: "6 new messages from Alice", "... from Alice and Bob",
// "... from Alice, Bob and 2 others"; without known names just "6 new messages".
func summaryBody(missed int, names []string) string {
	body := fmt.Sprintf("%d new messages", missed)
	switch n := len(names); {
	case n == 0:
		return body
	case n == 1:
		return body + " from " + names[0]
	case n <= pushSummaryNames+1:
		return body + " from " + strings.Join(names[:n-1], ", ") + " and " + names[n-1]
	default:
		others := n - pushSummaryNames
		return fmt.Sprintf("%s from %s and %d others", body, strings.Join(names[:pushSummaryNames], ", "), others)
	}
}

// wantsMessagePush: the user can view the channel and hasn't muted it
// (no_mentions still gets message pushes).
func (h *Hub) wantsMessagePush(tc *TextChat, userID, roomID string) bool {
	if h.roomService != nil {
		if _, ok := h.roomService.GetRoom(roomID); !ok {
			return false
		}
	}
	if ps := h.permissionService(); ps != nil && !ps.CanInRoom(ps.SubjectByID(userID), roomID, permissions.ViewRoom) {
		return false
	}
	setting, err := tc.Notify.Get(userID, roomID)
	if err != nil {
		log.Printf("[TextChat] Failed to load notification setting of %s: %v", userID, err)
		return true
	}
	return setting.Effective(tc.Store.Now()).Mode != chatstore.NotifyMuted
}

// pushTitle is "#channel" without custom emoji, or "Orbital".
func (h *Hub) pushTitle(roomID string) string {
	if h.roomService != nil {
		if room, ok := h.roomService.GetRoom(roomID); ok {
			if name := strings.TrimSpace(chatstore.PlainText(room.Name, nil, nil)); name != "" {
				return "#" + name
			}
		}
	}
	return "Orbital"
}

// messageNotification renders the push for one message:
// "#channel" / "Sender: preview". Mentions get their own tag and channel so
// message summaries never replace them.
func (h *Hub) messageNotification(tc *TextChat, msg *chatstore.Message, mention bool) push.Notification {
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

	sender := userName(msg.SenderID)
	if msg.SenderID == chatstore.SystemSenderID {
		sender = "Reminder"
	}
	if sender == "" {
		sender = "Someone"
	}
	text := strings.Join(strings.Fields(chatstore.PlainText(msg.Content, userName, roleName)), " ")
	if msg.Command != nil {
		note := strings.Join(strings.Fields(chatstore.PlainText(msg.Command.Note, userName, roleName)), " ")
		text = commandSummary(msg.Command, note)
	}
	switch {
	case text != "":
	case len(msg.Attachments) > 0:
		text = "sent an attachment"
	case msg.GIF != nil:
		text = "sent a GIF"
	case strings.TrimSpace(msg.Content) != "":
		// Only custom emoji, which a notification can't show.
		text = "sent an emoji"
	}
	if r := []rune(text); len(r) > pushPreviewRunes {
		text = strings.TrimSpace(string(r[:pushPreviewRunes-1])) + "…"
	}
	body := sender
	if text != "" {
		body += ": " + text
	}
	n := push.Notification{
		Title:     h.pushTitle(msg.RoomID),
		Body:      body,
		Tag:       msg.RoomID,
		Data:      map[string]string{"type": "text_message", "room_id": msg.RoomID, "message_id": msg.ID},
		ChannelID: push.MessagesChannelID,
	}
	if mention {
		n.Tag = "mention:" + msg.RoomID
		n.Data["type"] = "text_mention"
		n.ChannelID = push.AndroidChannelID
	}
	return n
}

// commandSummary is the push text of a slash command result.
func commandSummary(c *chatstore.Command, note string) string {
	switch c.Name {
	case chatstore.CommandD20:
		if c.Result == nil {
			return "rolled a d20"
		}
		text := fmt.Sprintf("rolled a d20: %d", *c.Result)
		switch c.Label {
		case chatstore.LabelCriticalSuccess:
			text += " — Critical Success"
		case chatstore.LabelCriticalFailure:
			text += " — Critical Failure"
		}
		return text
	case chatstore.CommandRandom, chatstore.CommandVRandom:
		if c.ResultIndex != nil && *c.ResultIndex < len(c.Options) {
			return "picked " + c.Options[*c.ResultIndex]
		}
		if c.Result != nil && c.Min != nil && c.Max != nil {
			return fmt.Sprintf("rolled %d (%d–%d)", *c.Result, *c.Min, *c.Max)
		}
	case chatstore.CommandRemindMe:
		return "set a reminder"
	case chatstore.CommandReminder:
		if note == "" {
			return "you asked to be reminded"
		}
		return note
	}
	return ""
}
