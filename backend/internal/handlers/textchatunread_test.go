package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func TestTextUnreadListsOnlyVisibleChannels(t *testing.T) {
	f := newTextHandlerFixture(t)
	m := f.post(t, f.openText, "new")
	f.post(t, f.hiddenText, "secret")

	rec := f.do(t, "user", f.text.GetUnread, http.MethodGet, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("unread: %d", rec.Code)
	}
	var resp struct {
		Channels []UnreadChannel `json:"channels"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Channels) != 1 || resp.Channels[0].RoomID != f.openText.ID || resp.Channels[0].NewestSeq != m.Seq || resp.Channels[0].LastReadSeq != 0 {
		t.Fatalf("unread = %+v", resp.Channels)
	}
}

func TestUnreadMentionCountsFollowNotifySettings(t *testing.T) {
	f := newTextHandlerFixture(t)
	general := f.cats.GetGeneralCategoryID()
	quiet, _ := f.rooms.CreateRoom("quiet", general, 5, models.RoomTypeText)
	f.postAs(t, f.openText, "mod", "<@user> look")
	f.postAs(t, f.openText, "mod", "<@&"+f.modRole.ID+"> mods only")
	f.postAs(t, quiet, "mod", "<@user> look here too")
	if err := f.notify.Set("user", quiet.ID, chatstore.NotifySetting{Mode: chatstore.NotifyNoMentions}); err != nil {
		t.Fatal(err)
	}

	unread := func(as string) map[string]UnreadChannel {
		rec := f.do(t, as, f.text.GetUnread, http.MethodGet, nil, nil)
		var body struct {
			Channels []UnreadChannel `json:"channels"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		out := map[string]UnreadChannel{}
		for _, c := range body.Channels {
			out[c.RoomID] = c
		}
		return out
	}
	u := unread("user")
	if c := u[f.openText.ID]; c.MentionCount != 1 || c.NotifyMode != "all" {
		t.Fatalf("open = %+v", c)
	}
	if c := u[quiet.ID]; c.MentionCount != 0 || c.NotifyMode != "no_mentions" {
		t.Fatalf("quiet = %+v", c)
	}
	// Role members count role mentions; the sender never counts their own.
	if c := unread("mod")[f.openText.ID]; c.MentionCount != 0 {
		t.Fatalf("mod (sender) = %+v", c)
	}
	f.postAs(t, f.openText, "user", "<@&"+f.modRole.ID+"> ping")
	if c := unread("mod")[f.openText.ID]; c.MentionCount != 1 {
		t.Fatalf("mod via role = %+v", c)
	}
	// An expired mute reads as "all".
	past := f.store.Now().UnixMilli() - 1
	_ = f.notify.Set("user", f.openText.ID, chatstore.NotifySetting{Mode: chatstore.NotifyMuted, MutedUntil: &past})
	if c := unread("user")[f.openText.ID]; c.NotifyMode != "all" || c.MentionCount != 1 {
		t.Fatalf("expired mute = %+v", c)
	}
}
