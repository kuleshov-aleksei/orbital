package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

func TestNotifySettings(t *testing.T) {
	f := newTextHandlerFixture(t)
	vars := map[string]string{"id": f.openText.ID}
	set := func(as string, body map[string]string) *httptest.ResponseRecorder {
		return f.do(t, as, f.text.SetNotify, http.MethodPut, vars, body)
	}
	for _, bad := range []map[string]string{
		{"mode": "loud"},
		{"mode": "muted"},
		{"mode": "muted", "mute_duration": "2h"},
		{"mode": "all", "mute_duration": "1h"},
	} {
		if rec := set("user", bad); rec.Code != http.StatusBadRequest {
			t.Fatalf("%v: %d", bad, rec.Code)
		}
	}
	if rec := f.do(t, "user", f.text.SetNotify, http.MethodPut, map[string]string{"id": f.hiddenText.ID},
		map[string]string{"mode": "muted", "mute_duration": "forever"}); rec.Code != http.StatusNotFound {
		t.Fatalf("hidden channel: %d", rec.Code)
	}

	rec := set("user", map[string]string{"mode": "muted", "mute_duration": "1h"})
	var got chatstore.NotifySetting
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.Mode != chatstore.NotifyMuted || got.MutedUntil == nil {
		t.Fatalf("mute 1h: %d %+v", rec.Code, got)
	}
	if want := f.store.Now().UnixMilli() + 3_600_000; *got.MutedUntil < want-5000 || *got.MutedUntil > want+5000 {
		t.Fatalf("muted_until = %d, want ~%d", *got.MutedUntil, want)
	}
	if len(f.events.sent) != 1 || f.events.sent[0] != "user:text_notify_settings" {
		t.Fatalf("events = %v", f.events.sent)
	}
	stored, _ := f.notify.Get("user", f.openText.ID)
	if stored.Mode != chatstore.NotifyMuted {
		t.Fatalf("stored = %+v", stored)
	}
	if rec := set("user", map[string]string{"mode": "all"}); rec.Code != http.StatusOK {
		t.Fatalf("reset: %d", rec.Code)
	}
	if all, _ := f.notify.ForUser("user"); len(all) != 0 {
		t.Fatalf("mode all keeps a row: %v", all)
	}
}
