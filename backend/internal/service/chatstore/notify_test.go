package chatstore

import (
	"fmt"
	"testing"
	"time"
)

func TestNotifySettingExpiry(t *testing.T) {
	now := time.UnixMilli(1_000_000)
	past, future := int64(999_999), int64(1_000_001)
	cases := []struct {
		s    NotifySetting
		want string
	}{
		{NotifySetting{}, NotifyAll},
		{NotifySetting{Mode: NotifyNoMentions}, NotifyNoMentions},
		{NotifySetting{Mode: NotifyMuted}, NotifyMuted},
		{NotifySetting{Mode: NotifyMuted, MutedUntil: &future}, NotifyMuted},
		{NotifySetting{Mode: NotifyMuted, MutedUntil: &past}, NotifyAll},
	}
	for _, c := range cases {
		if got := c.s.Effective(now).Mode; got != c.want {
			t.Errorf("%+v -> %s, want %s", c.s, got, c.want)
		}
	}
	n := NewMemoryNotify()
	_ = n.Set("u", "a", NotifySetting{Mode: NotifyMuted, MutedUntil: &past})
	_ = n.Set("u", "b", NotifySetting{Mode: NotifyMuted, MutedUntil: &future})
	_ = n.Set("u", "c", NotifySetting{Mode: NotifyMuted})
	expired, _ := n.TakeExpired(now.UnixMilli())
	if fmt.Sprint(expired) != "[{u a}]" {
		t.Fatalf("expired = %v", expired)
	}
	all, _ := n.ForUser("u")
	if len(all) != 2 {
		t.Fatalf("left = %v", all)
	}
	_ = n.Set("u", "b", NotifySetting{Mode: NotifyAll})
	if got, _ := n.Get("u", "b"); got.Mode != NotifyAll || got.MutedUntil != nil {
		t.Fatalf("reset = %+v", got)
	}
}
