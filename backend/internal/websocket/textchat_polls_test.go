package websocket

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func pollInput(extra map[string]interface{}) map[string]interface{} {
	p := map[string]interface{}{"question": "Lunch?", "options": []interface{}{"Pizza", "Sushi"}}
	for k, v := range extra {
		p[k] = v
	}
	return p
}

// createPoll posts a poll as alice and returns its id.
func (f *textFixture) createPoll(t *testing.T, extra map[string]interface{}) string {
	t.Helper()
	f.sendWith(f.alice, map[string]interface{}{"content": "", "poll": pollInput(extra)})
	msg := f.createdMessage(t, f.alice)
	drain(f.alice)
	drain(f.bob)
	return msg["id"].(string)
}

func pollOf(t *testing.T, ws models.WebSocketMessage) map[string]interface{} {
	t.Helper()
	msg := ws.Data.(map[string]interface{})["message"].(map[string]interface{})
	p, ok := msg["poll"].(map[string]interface{})
	if !ok {
		t.Fatalf("message has no poll: %+v", msg)
	}
	return p
}

func onlyUpdate(t *testing.T, c *Client) models.WebSocketMessage {
	t.Helper()
	got := messagesOfType(t, c, "text_message_updated")
	if len(got) != 1 {
		t.Fatalf("%s got %d updates", c.userID, len(got))
	}
	return got[0]
}

func TestPollCreateAndPerViewerResults(t *testing.T) {
	f := newTextFixture(t)
	f.sendWith(f.alice, map[string]interface{}{"content": "", "poll": pollInput(nil)})
	created := f.createdMessage(t, f.bob)
	poll := created["poll"].(map[string]interface{})
	if poll["question"] != "Lunch?" || len(poll["options"].([]interface{})) != 2 || poll["results_visible"] != false {
		t.Fatalf("created poll = %+v", poll)
	}
	id := created["id"].(string)
	drain(f.alice)

	f.bob.handleTextPollVote(map[string]interface{}{"message_id": id, "option_ids": []interface{}{"o2"}})
	// bob voted: he sees counts and himself.
	bobView := pollOf(t, onlyUpdate(t, f.bob))
	opt := bobView["options"].([]interface{})[1].(map[string]interface{})
	if bobView["results_visible"] != true || opt["count"] != float64(1) || opt["user_ids"].([]interface{})[0] != "bob" {
		t.Fatalf("bob's view = %+v", bobView)
	}
	// alice hasn't: only the voter count.
	aliceUpdate := onlyUpdate(t, f.alice)
	aliceView := pollOf(t, aliceUpdate)
	raw, _ := json.Marshal(aliceUpdate)
	if aliceView["results_visible"] != false || aliceView["voter_count"] != float64(1) || strings.Contains(string(raw), `"bob"`) {
		t.Fatalf("alice's view leaks results: %s", raw)
	}
}

func TestPollAnonymousNeverSendsVoters(t *testing.T) {
	f := newTextFixture(t)
	id := f.createPoll(t, map[string]interface{}{"anonymous": true})
	f.alice.handleTextPollVote(map[string]interface{}{"message_id": id, "option_ids": []interface{}{"o1"}})
	f.bob.handleTextPollVote(map[string]interface{}{"message_id": id, "option_ids": []interface{}{"o1"}})
	for _, c := range []*Client{f.alice, f.bob} {
		for _, m := range drainAll(t, c) {
			raw, _ := json.Marshal(m)
			if strings.Contains(string(raw), `"user_ids":["`) {
				t.Fatalf("%s got voter ids of an anonymous poll: %s", c.userID, raw)
			}
		}
	}
}

func TestPollRejectsAttachmentsAndBadInput(t *testing.T) {
	f := newTextFixture(t)
	f.sendWith(f.alice, map[string]interface{}{"poll": map[string]interface{}{"question": "Q?", "options": []interface{}{"only"}}})
	if code := errorCode(t, f.alice); code != textErrInvalid {
		t.Fatalf("one-option poll: %s", code)
	}
	f.sendWith(f.alice, map[string]interface{}{"poll": pollInput(nil), "upload_ids": []interface{}{"x"}})
	if code := errorCode(t, f.alice); code != textErrInvalid {
		t.Fatalf("poll with uploads: %s", code)
	}
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("invalid poll was posted")
	}
	// The caption of a poll is never run as a slash command.
	f.sendWith(f.alice, map[string]interface{}{"content": "/d20", "poll": pollInput(nil)})
	if _, ok := f.createdMessage(t, f.bob)["command"]; ok {
		t.Fatal("poll caption ran as a command")
	}
}

func TestPollVoteDeniedWithoutSendMessages(t *testing.T) {
	f := newTextFixture(t)
	id := f.createPoll(t, nil)
	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", 0, permissions.SendMessages)
	f.bob.handleTextPollVote(map[string]interface{}{"message_id": id, "option_ids": []interface{}{"o1"}})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("vote without SendMessages: %s", code)
	}
	if got := messagesOfType(t, f.alice, "text_message_updated"); len(got) != 0 {
		t.Fatal("denied vote was broadcast")
	}
	if m, _ := f.store.Get(t.Context(), id); m.Poll.VoterCount() != 0 {
		t.Fatal("denied vote was stored")
	}
}

func TestPollCloseEarly(t *testing.T) {
	f := newTextFixture(t)
	id := f.createPoll(t, nil)
	f.bob.handleTextPollVote(map[string]interface{}{"message_id": id, "option_ids": []interface{}{"o2"}})
	drain(f.alice)
	drain(f.bob)

	// bob is neither the author nor a moderator.
	f.bob.handleTextPollClose(map[string]interface{}{"message_id": id})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("close by non-author: %s", code)
	}

	f.alice.handleTextPollClose(map[string]interface{}{"message_id": id})
	all := drainAll(t, f.bob)
	var updated, announced int
	for _, m := range all {
		switch m.Type {
		case "text_message_updated":
			updated++
			if p := pollOf(t, m); p["closed"] != true || p["results_visible"] != true {
				t.Fatalf("closed poll view = %+v", p)
			}
		case "text_message_new":
			announced++
			msg := m.Data.(map[string]interface{})["message"].(map[string]interface{})
			cmd := commandOf(t, msg)
			if msg["sender_id"] != chatstore.SystemSenderID || cmd["name"] != chatstore.CommandPollClosed ||
				cmd["poll_id"] != id || msg["reply_to_id"] != id || cmd["options"].([]interface{})[0] != "Sushi" {
				t.Fatalf("announcement = %+v", msg)
			}
		}
	}
	if updated != 1 || announced != 1 {
		t.Fatalf("updated=%d announced=%d (%+v)", updated, announced, all)
	}
	// Closing again announces nothing.
	f.alice.handleTextPollClose(map[string]interface{}{"message_id": id})
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("second close announced again")
	}
}

func TestPollClosesAtDueDate(t *testing.T) {
	f := newTextFixture(t)
	due := time.Now().Add(time.Hour).UnixMilli()
	id := f.createPoll(t, map[string]interface{}{"closes_at_ts": due})

	f.hub.ClosePollsDue(time.Now())
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("poll closed before its due date")
	}
	f.hub.ClosePollsDue(time.Now().Add(2 * time.Hour))
	announcements := messagesOfType(t, f.bob, "text_message_new")
	if len(announcements) != 1 {
		t.Fatalf("got %d announcements", len(announcements))
	}
	msg := announcements[0].Data.(map[string]interface{})["message"].(map[string]interface{})
	if cmd := commandOf(t, msg); cmd["poll_id"] != id || cmd["voters"] != float64(0) {
		t.Fatalf("announcement = %+v", msg)
	}
	if m, _ := f.store.Get(t.Context(), id); !m.Poll.Closed || *m.Poll.ClosedBy != chatstore.SystemSenderID {
		t.Fatalf("poll not closed: %+v", m.Poll)
	}
	f.hub.ClosePollsDue(time.Now().Add(3 * time.Hour))
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("poll announced twice")
	}
}

func TestPollDeleteCancelsDueDate(t *testing.T) {
	f := newTextFixture(t)
	due := time.Now().Add(time.Hour).UnixMilli()
	id := f.createPoll(t, map[string]interface{}{"closes_at_ts": due})
	f.alice.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	drain(f.bob)
	f.hub.ClosePollsDue(time.Now().Add(2 * time.Hour))
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatal("deleted poll was announced")
	}
}
