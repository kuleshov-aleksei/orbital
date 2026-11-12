package websocket

import (
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func TestMentionPings(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.text.ID, "hey <@bob> and <@alice> and <@ghost>")
	msg := f.createdMessage(t, f.alice)
	if users := msg["mention_user_ids"].([]interface{}); len(users) != 2 {
		t.Fatalf("mention_user_ids = %v (unknown users must be dropped)", users)
	}
	if n := mentionPings(t, f.bob); n != 1 {
		t.Fatalf("bob got %d pings", n)
	}
	// Mentioning yourself never pings.
	if n := mentionPings(t, f.alice); n != 0 {
		t.Fatalf("alice pinged herself %d times", n)
	}
}

func TestMentionsOfUsersWhoCannotViewAreDropped(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.hidden.ID, "secret for <@bob>")
	msg := f.createdMessage(t, f.alice)
	if users := msg["mention_user_ids"].([]interface{}); len(users) != 0 {
		t.Fatalf("bob kept as a mention in a channel he can't see: %v", users)
	}
	if n := mentionPings(t, f.bob); n != 0 {
		t.Fatalf("bob got %d pings for a hidden channel", n)
	}
}

func TestSystemRoleMentionsPingNobody(t *testing.T) {
	f := newTextFixture(t)
	f.send(f.alice, f.text.ID, "<@&everyone> <@&guest> <@&no-such-role>")
	msg := f.createdMessage(t, f.alice)
	if roles := msg["mention_role_ids"].([]interface{}); len(roles) != 0 {
		t.Fatalf("mention_role_ids = %v", roles)
	}
	if n := mentionPings(t, f.bob); n != 0 {
		t.Fatalf("bob got %d pings", n)
	}
}

func TestRoleMentionFansOutToMembers(t *testing.T) {
	f := newTextFixture(t)
	name := "Crew"
	role, err := f.ps.CreateRole(ownerSubject, service.RoleInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.ps.SetUserRoles(ownerSubject, "bob", []string{role.ID}); err != nil {
		t.Fatal(err)
	}
	drain(f.alice)
	drain(f.bob)
	f.send(f.alice, f.text.ID, "<@&"+role.ID+"> standup")
	drain(f.alice)
	if n := mentionPings(t, f.bob); n != 1 {
		t.Fatalf("role member got %d pings", n)
	}
}

func TestReplyPingIsDelivered(t *testing.T) {
	f := newTextFixture(t)
	parent := f.postAs(t, f.bob, "question")
	f.alice.handleTextMessageSend(map[string]interface{}{"room_id": f.text.ID, "content": "answer", "reply_to_id": parent})
	if n := mentionPings(t, f.bob); n != 1 {
		t.Fatalf("reply ping: %d", n)
	}
	f.alice.handleTextMessageSend(map[string]interface{}{"room_id": f.text.ID, "content": "quiet", "reply_to_id": parent, "reply_ping": false})
	if n := mentionPings(t, f.bob); n != 0 {
		t.Fatalf("reply without ping: %d", n)
	}
}

func TestMentionPingsRespectNotifySettings(t *testing.T) {
	f := newTextFixture(t)
	until := time.Now().Add(time.Hour).UnixMilli()
	for _, s := range []chatstore.NotifySetting{
		{Mode: chatstore.NotifyNoMentions},
		{Mode: chatstore.NotifyMuted},
		{Mode: chatstore.NotifyMuted, MutedUntil: &until},
	} {
		if err := f.notify().Set("bob", f.text.ID, s); err != nil {
			t.Fatal(err)
		}
		f.send(f.alice, f.text.ID, "<@bob> hi")
		if got := messagesOfType(t, f.bob, "text_mention"); len(got) != 0 {
			t.Fatalf("%+v: bob was pinged", s)
		}
	}
	// An expired mute pings again, and the expiry pass tells bob.
	past := time.Now().Add(-time.Second).UnixMilli()
	_ = f.notify().Set("bob", f.text.ID, chatstore.NotifySetting{Mode: chatstore.NotifyMuted, MutedUntil: &past})
	f.send(f.alice, f.text.ID, "<@bob> hi again")
	if n := mentionPings(t, f.bob); n != 1 {
		t.Fatalf("expired mute: %d pings", n)
	}
	f.hub.ExpireMutes(time.Now())
	got := messagesOfType(t, f.bob, "text_notify_settings")
	if len(got) != 1 || got[0].Data.(map[string]interface{})["mode"] != "all" {
		t.Fatalf("expiry push = %+v", got)
	}
	if s, _ := f.notify().Get("bob", f.text.ID); s.Mode != chatstore.NotifyAll {
		t.Fatalf("expired mute kept: %+v", s)
	}
}

func TestEditsNeverPing(t *testing.T) {
	f := newTextFixture(t)
	id := f.postAs(t, f.alice, "plain")
	f.alice.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "now <@bob>"})
	if n := mentionPings(t, f.bob); n != 0 {
		t.Fatalf("edit pinged %d times", n)
	}
}
