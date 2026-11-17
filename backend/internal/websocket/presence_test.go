package websocket

import (
	"testing"
	"time"

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
	f.hub.refreshPresence("bob")
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

// mobileEvents pops user_status messages as "user:mobile|desktop".
func mobileEvents(t *testing.T, c *Client) []string {
	t.Helper()
	var out []string
	for _, m := range messagesOfType(t, c, "user_status") {
		d := m.Data.(map[string]interface{})
		kind := "desktop"
		if mobile, _ := d["mobile"].(bool); mobile {
			kind = "mobile"
		}
		out = append(out, d["user_id"].(string)+":"+kind)
	}
	return out
}

func TestMobileOnlyWhenEverySessionIsTheApp(t *testing.T) {
	f := newTextFixture(t)
	f.hub.UpdateUserPing("bob")
	bob := &models.User{ID: "bob", Nickname: "bob"}

	// bob's only socket is the Android app.
	f.bob.clientID = "android/1.5.2"
	f.hub.refreshPresence("bob")
	if got := mobileEvents(t, f.alice); len(got) != 1 || got[0] != "bob:mobile" {
		t.Fatalf("app only: %v", got)
	}
	if pu := f.hub.onlinePublicUser(bob); !pu.Mobile || pu.Status != "" {
		t.Fatalf("online list: mobile=%v status=%q", pu.Mobile, pu.Status)
	}
	// Nothing changed: no broadcast.
	f.hub.refreshPresence("bob")
	if got := mobileEvents(t, f.alice); len(got) != 0 {
		t.Fatalf("duplicate broadcast: %v", got)
	}

	// A desktop session next to the phone hides the indicator.
	desktop := f.connect("bob")
	f.hub.refreshPresence("bob")
	if got := mobileEvents(t, f.alice); len(got) != 1 || got[0] != "bob:desktop" {
		t.Fatalf("app + desktop: %v", got)
	}
	if pu := f.hub.onlinePublicUser(bob); pu.Mobile {
		t.Fatal("online list still mobile with a desktop session")
	}

	// Closing the desktop brings it back.
	f.hub.mu.Lock()
	delete(f.hub.clients, desktop)
	f.hub.mu.Unlock()
	f.hub.refreshPresence("bob")
	if got := mobileEvents(t, f.alice); len(got) != 1 || got[0] != "bob:mobile" {
		t.Fatalf("desktop closed: %v", got)
	}

	// Away and mobile are independent.
	setActive(f.bob, false)
	msgs := messagesOfType(t, f.alice, "user_status")
	if len(msgs) != 1 {
		t.Fatalf("idle on app: %d user_status", len(msgs))
	}
	if d := msgs[0].Data.(map[string]interface{}); d["status"] != StatusAway || d["mobile"] != true {
		t.Fatalf("idle on app: %v", d)
	}
}

func TestWebAndOfflineUsersAreNotMobile(t *testing.T) {
	f := newTextFixture(t)
	// Offline (no recent ping) with an app socket: never mobile.
	f.bob.clientID = "android/1.5.2"
	f.hub.refreshPresence("bob")
	if got := mobileEvents(t, f.alice); len(got) != 0 {
		t.Fatalf("offline user broadcast: %v", got)
	}

	// Online from the web (no ?client=) or Electron-like ids: not mobile.
	f.hub.UpdateUserPing("alice")
	f.hub.refreshPresence("alice")
	if f.hub.presenceOf("alice").Mobile {
		t.Fatal("web user marked mobile")
	}
	if has, mobile := f.hub.userOnMobileOnly("nobody"); has || mobile {
		t.Fatal("user without sockets is mobile")
	}
}

func TestMobileLingersAfterAppClosesUntilOffline(t *testing.T) {
	f := newTextFixture(t)
	f.hub.UpdateUserPing("bob")
	f.bob.clientID = "android/1.5.2"
	f.hub.refreshPresence("bob")
	_ = mobileEvents(t, f.alice)

	// The app closes: no sockets, but the last ping keeps bob online.
	f.hub.mu.Lock()
	delete(f.hub.clients, f.bob)
	f.hub.mu.Unlock()
	f.hub.refreshPresence("bob")
	if got := mobileEvents(t, f.alice); len(got) != 0 {
		t.Fatalf("mobile flag dropped while still online: %v", got)
	}
	if pu := f.hub.onlinePublicUser(&models.User{ID: "bob", Nickname: "bob"}); !pu.Mobile {
		t.Fatal("online list lost mobile while lingering")
	}

	// bob comes back from the desktop before the ping expires: not mobile.
	f.connect("bob")
	f.hub.refreshPresence("bob")
	if got := mobileEvents(t, f.alice); len(got) != 1 || got[0] != "bob:desktop" {
		t.Fatalf("back on desktop: %v", got)
	}
}

func TestPresenceForgottenOnPingExpiry(t *testing.T) {
	f := newTextFixture(t)
	f.hub.UpdateUserPing("bob")
	f.bob.clientID = "android/1.5.2"
	f.hub.refreshPresence("bob")

	f.hub.mu.Lock()
	delete(f.hub.clients, f.bob)
	f.hub.onlineUsers["bob"] = time.Now().Add(-time.Minute)
	f.hub.mu.Unlock()
	f.hub.checkGlobalPresenceTimeouts()
	if f.hub.presenceOf("bob").Mobile {
		t.Fatal("mobile kept after bob went offline")
	}
}
