package websocket

import (
	"context"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func TestTextSendBroadcastsToViewers(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.text.ID, "hello")
	for _, c := range []*Client{f.alice, f.bob} {
		got := messagesOfType(t, c, "text_message_new")
		if len(got) != 1 {
			t.Fatalf("%s got %d text_message_new", c.userID, len(got))
		}
		data := got[0].Data.(map[string]interface{})
		if data["nonce"] != "n1" || data["message"].(map[string]interface{})["content"] != "hello" {
			t.Fatalf("bad payload: %+v", data)
		}
	}

	// A message in the secret channel never reaches bob.
	f.send(f.alice, f.hidden.ID, "psst")
	if len(messagesOfType(t, f.alice, "text_message_new")) != 1 {
		t.Fatal("alice did not get her own message")
	}
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatalf("bob received a hidden channel message: %+v", got)
	}
}

func TestTextSendDeniedPaths(t *testing.T) {
	f := newTextFixture(t)

	f.send(f.bob, f.hidden.ID, "let me in")
	if code := errorCode(t, f.bob); code != textErrNotFound {
		t.Fatalf("hidden channel: code %q", code)
	}
	f.send(f.bob, f.voice.ID, "not a text channel")
	if code := errorCode(t, f.bob); code != textErrNotFound {
		t.Fatalf("voice room: code %q", code)
	}

	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", 0, permissions.SendMessages)
	f.send(f.bob, f.text.ID, "muted")
	msgs := []string{}
	for {
		msg, ok := nextMessage(t, f.bob)
		if !ok {
			break
		}
		msgs = append(msgs, msg.Type)
	}
	if len(msgs) != 2 || msgs[0] != "permission_denied" || msgs[1] != "text_error" {
		t.Fatalf("send without send_messages got %v", msgs)
	}
	if got := messagesOfType(t, f.alice, "text_message_new"); len(got) != 0 {
		t.Fatal("denied message was broadcast")
	}
}

func TestTextSendRateLimit(t *testing.T) {
	f := newTextFixture(t)
	for i := 0; i < textSendLimit; i++ {
		f.send(f.alice, f.text.ID, "spam")
	}
	drain(f.alice)
	f.send(f.alice, f.text.ID, "one too many")
	if code := errorCode(t, f.alice); code != textErrRateLimited {
		t.Fatalf("code %q, want rate_limited", code)
	}
}

func TestTextEditOnlyByAuthor(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "original")

	f.bob.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "hijacked"})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("edit by other: code %q", code)
	}
	f.alice.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "fixed"})
	got := messagesOfType(t, f.bob, "text_message_updated")
	if len(got) != 1 || got[0].Data.(map[string]interface{})["message"].(map[string]interface{})["content"] != "fixed" {
		t.Fatalf("edit broadcast: %+v", got)
	}
}

func TestTextEditRequiresSendMessages(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.bob, "before the mute")
	drain(f.alice)
	drain(f.bob)

	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", 0, permissions.SendMessages)
	f.bob.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "after the mute"})
	msgs := []string{}
	for {
		msg, ok := nextMessage(t, f.bob)
		if !ok {
			break
		}
		msgs = append(msgs, msg.Type)
	}
	if len(msgs) != 2 || msgs[0] != "permission_denied" || msgs[1] != "text_error" {
		t.Fatalf("edit without send_messages got %v", msgs)
	}
	if got := messagesOfType(t, f.alice, "text_message_updated"); len(got) != 0 {
		t.Fatal("denied edit was broadcast")
	}
	m, err := f.store.Get(context.Background(), id)
	if err != nil || m.Content != "before the mute" {
		t.Fatalf("content after denied edit: %+v, %v", m, err)
	}
}

func TestTextDeleteReportsNewestSeq(t *testing.T) {
	f := newTextFixture(t)
	first := f.postAs(t, f.alice, "stays")
	second := f.postAs(t, f.alice, "goes")
	drain(f.bob)
	kept, _ := f.store.Get(context.Background(), first)

	f.alice.handleTextMessageDelete(map[string]interface{}{"message_id": second})
	got := messagesOfType(t, f.bob, "text_message_deleted")
	if len(got) != 1 {
		t.Fatalf("delete broadcast: %+v", got)
	}
	if seq := int64(got[0].Data.(map[string]interface{})["newest_seq"].(float64)); seq != kept.Seq {
		t.Fatalf("newest_seq = %d, want %d", seq, kept.Seq)
	}
}

func TestTextDeleteRequiresManageMessagesForOthers(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "bob will try to delete this")

	f.bob.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	if code := errorCode(t, f.bob); code != textErrForbidden {
		t.Fatalf("delete without manage_messages: code %q", code)
	}
	if _, err := f.store.Get(context.Background(), id); err != nil {
		t.Fatalf("message gone after denied delete: %v", err)
	}

	f.overwrite(f.text.ID, models.OverwriteSubjectUser, "bob", permissions.ManageMessages, 0)
	f.bob.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	if got := messagesOfType(t, f.alice, "text_message_deleted"); len(got) != 1 {
		t.Fatalf("delete with manage_messages not broadcast: %+v", got)
	}
	page, _ := f.store.History(context.Background(), chatstore.HistoryQuery{RoomID: f.text.ID})
	if len(page.Messages) != 0 {
		t.Fatal("deleted message still in history")
	}
}

func TestTextActionsOnHiddenChannelMessages(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.hidden.ID, "secret")
	id := messagesOfType(t, f.alice, "text_message_new")[0].Data.(map[string]interface{})["message"].(map[string]interface{})["id"].(string)
	// Even with manage_messages server-wide, bob can't touch what he can't see.
	f.overwrite(f.hidden.ID, models.OverwriteSubjectUser, "bob", permissions.ManageMessages, 0)
	f.bob.handleTextMessageDelete(map[string]interface{}{"message_id": id})
	if code := errorCode(t, f.bob); code != textErrNotFound {
		t.Fatalf("delete in hidden channel: code %q", code)
	}
}

func TestTextChannelReadSyncsSessions(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "read me")
	second := f.connect("bob")
	m, _ := f.store.Get(context.Background(), id)

	// Positions beyond the newest message are clamped.
	f.bob.handleTextChannelRead(map[string]interface{}{"room_id": f.text.ID, "seq": m.Seq + 1000})
	got := messagesOfType(t, second, "text_read_state")
	if len(got) != 1 || int64(got[0].Data.(map[string]interface{})["last_read_seq"].(float64)) != m.Seq {
		t.Fatalf("read state sync: %+v", got)
	}
	drain(f.bob)
	f.bob.handleTextChannelRead(map[string]interface{}{"room_id": f.hidden.ID, "seq": 1})
	if got := messagesOfType(t, f.bob, "text_read_state"); len(got) != 0 {
		t.Fatal("read state accepted for a hidden channel")
	}
}
