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
