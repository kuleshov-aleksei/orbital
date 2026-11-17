package websocket

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func (f *textFixture) sendWith(c *Client, data map[string]interface{}) {
	if _, ok := data["nonce"]; !ok {
		f.nonceSeq++
		data["nonce"] = fmt.Sprintf("n%d", f.nonceSeq)
	}
	if _, ok := data["room_id"]; !ok {
		data["room_id"] = f.text.ID
	}
	c.handleTextMessageSend(data)
}

func commandOf(t *testing.T, msg map[string]interface{}) map[string]interface{} {
	t.Helper()
	cmd, ok := msg["command"].(map[string]interface{})
	if !ok {
		t.Fatalf("message has no command: %+v", msg)
	}
	return cmd
}

func TestCommandResultIsStoredAndBroadcast(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.text.ID, "/random 5 10")
	mine := f.createdMessage(t, f.alice)
	theirs := f.createdMessage(t, f.bob)
	a, b := commandOf(t, mine), commandOf(t, theirs)
	if a["name"] != chatstore.CommandRandom || a["result"] != b["result"] {
		t.Fatalf("command = %+v / %+v", a, b)
	}
	if v := a["result"].(float64); v < 5 || v > 10 {
		t.Fatalf("result %v out of range", v)
	}
	if mine["content"] != "/random 5 10" {
		t.Fatalf("content = %v", mine["content"])
	}

	// Plain messages and unknown commands carry no command.
	f.send(f.alice, f.text.ID, "/shrug")
	if _, ok := f.createdMessage(t, f.alice)["command"]; ok {
		t.Fatal("unknown command got a result")
	}
}

func TestCommandUsageErrorStoresNothing(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.text.ID, "/random onlyone")
	if code := errorCode(t, f.alice); code != textErrInvalid {
		t.Fatalf("code = %s", code)
	}
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("invalid command was posted")
	}
}

func TestCommandResendKeepsResult(t *testing.T) {
	f := newTextFixture(t)
	f.sendWith(f.alice, map[string]interface{}{"content": "/random 1 1000000", "nonce": "same-nonce"})
	first := commandOf(t, f.createdMessage(t, f.alice))
	drain(f.bob)
	f.sendWith(f.alice, map[string]interface{}{"content": "/random 1 1000000", "nonce": "same-nonce"})
	again := commandOf(t, f.createdMessage(t, f.alice))
	if first["result"] != again["result"] {
		t.Fatalf("resend re-rolled: %v → %v", first["result"], again["result"])
	}
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("resend was broadcast again")
	}
}

func TestCommandMessageCannotBeEdited(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "/d20")
	f.alice.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "/d20 again"})
	if code := errorCode(t, f.alice); code != textErrForbidden {
		t.Fatalf("code = %s", code)
	}
}

func TestRemindMeFiresAsReply(t *testing.T) {
	f := newTextFixture(t)
	f.sendWith(f.alice, map[string]interface{}{"content": "/remindme 2h renew the cert", "tz": "Europe/Berlin"})
	set := f.createdMessage(t, f.alice)
	cmd := commandOf(t, set)
	if cmd["tz"] != "Europe/Berlin" || cmd["note"] != "renew the cert" {
		t.Fatalf("remindme command = %+v", cmd)
	}
	due := int64(cmd["due_at_ts"].(float64))
	if d := time.Until(time.UnixMilli(due)); d < 119*time.Minute || d > 121*time.Minute {
		t.Fatalf("due in %v", d)
	}
	drain(f.alice)
	drain(f.bob)

	f.hub.FireReminders(time.Now().Add(time.Hour))
	if got := messagesOfType(t, f.alice, "text_message_new"); len(got) != 0 {
		t.Fatal("reminder fired early")
	}

	f.hub.FireReminders(time.Now().Add(3 * time.Hour))
	pings := 0
	var fired map[string]interface{}
	for _, m := range drainAll(t, f.alice) {
		switch m.Type {
		case "text_mention":
			pings++
		case "text_message_new":
			fired = m.Data.(map[string]interface{})["message"].(map[string]interface{})
		}
	}
	if fired == nil || pings != 1 {
		t.Fatalf("fired=%v pings=%d", fired, pings)
	}
	if fired["sender_id"] != chatstore.SystemSenderID || fired["reply_to_id"] != set["id"] {
		t.Fatalf("fired message = %+v", fired)
	}
	fc := commandOf(t, fired)
	if fc["name"] != chatstore.CommandReminder || fc["reminder_for"] != "alice" || fc["note"] != "renew the cert" {
		t.Fatalf("fired command = %+v", fc)
	}
	if got := mentionPings(t, f.bob); got != 0 {
		t.Fatal("bob was pinged by alice's reminder")
	}

	// It fires once.
	f.hub.FireReminders(time.Now().Add(4 * time.Hour))
	if got := messagesOfType(t, f.alice, "text_message_new"); len(got) != 0 {
		t.Fatal("reminder fired twice")
	}

	// Alice may dismiss it; bob may not.
	firedID := fired["id"].(string)
	f.bob.handleTextMessageDelete(map[string]interface{}{"message_id": firedID})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("bob delete code = %s", code)
	}
	f.alice.handleTextMessageDelete(map[string]interface{}{"message_id": firedID})
	if got := messagesOfType(t, f.alice, "text_message_deleted"); len(got) != 1 {
		t.Fatal("alice could not dismiss her reminder")
	}
}

func TestRemindMePingsInMutedChannel(t *testing.T) {
	f := newTextFixture(t)
	if err := f.notify().Set("alice", f.text.ID, chatstore.NotifySetting{Mode: chatstore.NotifyMuted}); err != nil {
		t.Fatal(err)
	}
	f.postAs(t, f.alice, "/remindme 5min")
	f.hub.FireReminders(time.Now().Add(time.Hour))
	if got := mentionPings(t, f.alice); got != 1 {
		t.Fatalf("pings = %d", got)
	}
}

func TestRemindMeCancelledByDelete(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "/remindme 2h")
	f.alice.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	drain(f.alice)
	f.hub.FireReminders(time.Now().Add(3 * time.Hour))
	if got := messagesOfType(t, f.alice, "text_message_new"); len(got) != 0 {
		t.Fatal("deleted /remindme still fired")
	}
}

func TestRemindMeDroppedWithoutAccess(t *testing.T) {
	f := newTextFixture(t)
	f.postAs(t, f.alice, "/remindme 2h")
	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "alice", 0, permissions.ViewRoom)
	f.hub.FireReminders(time.Now().Add(3 * time.Hour))
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("reminder posted for a user who can't see the channel")
	}
	if n, _ := f.hub.textChatService().Reminders.CountPending("alice"); n != 0 {
		t.Fatalf("pending = %d", n)
	}
}

func TestRemindMeCap(t *testing.T) {
	f := newTextFixture(t)
	r := f.hub.textChatService().Reminders
	for i := 0; i < maxPendingReminders; i++ {
		if err := r.Add(chatstore.Reminder{UserID: "alice", RoomID: f.text.ID, MessageID: "x", DueAtMS: time.Now().Add(time.Hour).UnixMilli()}); err != nil {
			t.Fatal(err)
		}
	}
	f.send(f.alice, f.text.ID, "/remindme 2h")
	if code := errorCode(t, f.alice); code != textErrInvalid {
		t.Fatalf("code = %s", code)
	}
}

func TestReminderPostedWithoutReplyWhenOriginalGone(t *testing.T) {
	f := newTextFixture(t)
	tc := f.hub.textChatService()
	msg, err := f.store.Create(context.Background(), chatstore.CreateInput{RoomID: f.text.ID, SenderID: "alice", Content: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.Delete(context.Background(), msg.ID, "alice", nil); err != nil {
		t.Fatal(err)
	}
	if err := tc.Reminders.Add(chatstore.Reminder{UserID: "alice", RoomID: f.text.ID, MessageID: msg.ID, DueAtMS: 1, Note: "hi"}); err != nil {
		t.Fatal(err)
	}
	f.hub.FireReminders(time.Now())
	fired := f.createdMessage(t, f.alice)
	if fired["reply_to_id"] != nil {
		t.Fatalf("reply_to_id = %v", fired["reply_to_id"])
	}
}

// drainAll pops every queued message.
func drainAll(t *testing.T, c *Client) []models.WebSocketMessage {
	t.Helper()
	var out []models.WebSocketMessage
	for {
		m, ok := nextMessage(t, c)
		if !ok {
			return out
		}
		out = append(out, m)
	}
}
