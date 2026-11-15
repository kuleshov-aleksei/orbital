package websocket

import (
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

func awayEvents(t *testing.T, c *Client) []string {
	t.Helper()
	var out []string
	for _, m := range messagesOfType(t, c, "user_status") {
		d := m.Data.(map[string]interface{})
		out = append(out, d["user_id"].(string)+":"+d["status"].(string))
	}
	return out
}

func TestAwayFollowsSessionActivity(t *testing.T) {
	f := newTextFixture(t)
	f.hub.UpdateUserPing("bob")

	setActive(f.bob, false)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:away" {
		t.Fatalf("after inactive: %v", got)
	}
	// Repeating the same state broadcasts nothing.
	setActive(f.bob, false)
	if got := awayEvents(t, f.alice); len(got) != 0 {
		t.Fatalf("duplicate broadcast: %v", got)
	}
	// The online list carries the away status.
	if pu := f.hub.onlinePublicUser(&models.User{ID: "bob", Nickname: "bob"}); pu.Status != StatusAway {
		t.Fatalf("online list status = %q", pu.Status)
	}

	// A second, active session (e.g. desktop) brings bob back.
	desktop := f.connect("bob")
	f.hub.refreshAway("bob")
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:online" {
		t.Fatalf("after new session: %v", got)
	}
	// It goes idle too: away again.
	setActive(desktop, false)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:away" {
		t.Fatalf("all sessions idle: %v", got)
	}
	setActive(f.bob, true)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:online" {
		t.Fatalf("back: %v", got)
	}
}

func TestOfflineUserIsNeverAway(t *testing.T) {
	f := newTextFixture(t)
	// bob has sockets but no recent ping: not online, so never shown away.
	setActive(f.bob, false)
	if got := awayEvents(t, f.alice); len(got) != 0 {
		t.Fatalf("offline user broadcast as away: %v", got)
	}
}

// joinCall connects a room socket for userID and joins the voice room with
// the given mute state.
func (f *textFixture) joinCall(userID string, muted bool) *Client {
	c := f.connect(userID)
	c.mu.Lock()
	c.roomID = f.voice.ID
	c.mu.Unlock()
	c.handleJoinRoom(map[string]interface{}{
		"room_id":     f.voice.ID,
		"nickname":    userID,
		"media_state": map[string]interface{}{"is_muted": muted},
	})
	return c
}

func setMedia(c *Client, roomID string, muted, deafened bool) {
	c.handleUpdateMediaState(map[string]interface{}{
		"room_id": roomID, "is_muted": muted, "is_deafened": deafened,
	})
}

func TestOpenMicInCallKeepsUserOnline(t *testing.T) {
	f := newTextFixture(t)
	f.hub.UpdateUserPing("bob")

	setActive(f.bob, false)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:away" {
		t.Fatalf("idle: %v", got)
	}

	call := f.joinCall("bob", false)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:online" {
		t.Fatalf("joined unmuted: %v", got)
	}
	setMedia(call, f.voice.ID, true, false)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:away" {
		t.Fatalf("muted: %v", got)
	}
	setMedia(call, f.voice.ID, false, false)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:online" {
		t.Fatalf("unmuted: %v", got)
	}
	setMedia(call, f.voice.ID, false, true)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:away" {
		t.Fatalf("deafened: %v", got)
	}

	setMedia(call, f.voice.ID, false, false)
	_ = awayEvents(t, f.alice)
	call.handleLeaveRoom(nil)
	if got := awayEvents(t, f.alice); len(got) != 1 || got[0] != "bob:away" {
		t.Fatalf("left the call: %v", got)
	}
}

func TestJoiningMutedDoesNotCountAsActive(t *testing.T) {
	f := newTextFixture(t)
	f.hub.UpdateUserPing("bob")
	setActive(f.bob, false)
	_ = awayEvents(t, f.alice)

	f.joinCall("bob", true)
	if got := awayEvents(t, f.alice); len(got) != 0 {
		t.Fatalf("muted join changed status: %v", got)
	}
	if !f.hub.userIsAway("bob") {
		t.Fatal("muted idle user in a call should be away")
	}
}

func TestOpenMicInCallSuppressesMentionPush(t *testing.T) {
	f := newTextFixture(t)
	sender, _ := withPush(f)
	setActive(f.bob, false)

	call := f.joinCall("bob", false)
	f.send(f.alice, f.text.ID, "hi <@bob>")
	if got := sender.take(); len(got) != 0 {
		t.Fatalf("pushed to a user talking in a call: %+v", got)
	}

	setMedia(call, f.voice.ID, true, false)
	f.send(f.alice, f.text.ID, "again <@bob>")
	if got := sender.take(); len(got) != 1 {
		t.Fatalf("muted in call: %d pushes", len(got))
	}
}
