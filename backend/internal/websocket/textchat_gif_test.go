package websocket

import "testing"

const (
	testGIFURL    = "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/MCCBoQlZ.mp4"
	testGIFPoster = "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/LyWpim71.jpg"
)

func gifPayload() map[string]interface{} {
	return map[string]interface{}{
		"provider": "klipy", "id": "8041071659142944",
		"url": testGIFURL, "preview_url": testGIFPoster,
		"width": 498, "height": 498, "title": "Hello",
	}
}

func TestTextSendGIFOnlyMessage(t *testing.T) {
	f := newTextFixture(t)
	f.sendWith(f.alice, map[string]interface{}{"content": "", "gif": gifPayload()})

	for _, c := range []*Client{f.alice, f.bob} {
		got := messagesOfType(t, c, "text_message_new")
		if len(got) != 1 {
			t.Fatalf("%s got %d text_message_new, want 1", c.userID, len(got))
		}
		msg, ok := got[0].Data.(map[string]interface{})["message"].(map[string]interface{})
		if !ok {
			t.Fatalf("%s: no message in %+v", c.userID, got[0].Data)
		}
		if msg["content"] != "" {
			t.Fatalf("%s: content = %v, want empty", c.userID, msg["content"])
		}
		gif, ok := msg["gif"].(map[string]interface{})
		if !ok {
			t.Fatalf("%s: message has no gif: %+v", c.userID, msg)
		}
		if gif["provider"] != "klipy" || gif["id"] != "8041071659142944" || gif["url"] != testGIFURL {
			t.Fatalf("%s: bad gif payload: %+v", c.userID, gif)
		}
	}
}

func TestTextSendRejectsForeignGIFHost(t *testing.T) {
	f := newTextFixture(t)
	payload := gifPayload()
	payload["url"] = "https://evil.example/tracker.gif"
	f.sendWith(f.alice, map[string]interface{}{"gif": payload})

	if code := errorCode(t, f.alice); code != textErrInvalid {
		t.Fatalf("code = %q, want %q", code, textErrInvalid)
	}
	if got := messagesOfType(t, f.bob, "text_message_new"); len(got) != 0 {
		t.Fatalf("invalid GIF was broadcast: %+v", got)
	}
}

func TestTextSendGIFWithText(t *testing.T) {
	f := newTextFixture(t)
	f.sendWith(f.alice, map[string]interface{}{"content": "reaction", "gif": gifPayload()})

	got := messagesOfType(t, f.bob, "text_message_new")
	if len(got) != 1 {
		t.Fatalf("bob got %d messages, want 1", len(got))
	}
	msg := got[0].Data.(map[string]interface{})["message"].(map[string]interface{})
	if msg["content"] != "reaction" || msg["gif"] == nil {
		t.Fatalf("bad message: %+v", msg)
	}
}

// Editing text must not drop or replace the GIF.
func TestTextGIFSurvivesEdit(t *testing.T) {
	f := newTextFixture(t)
	f.sendWith(f.alice, map[string]interface{}{"gif": gifPayload()})
	created := f.createdMessage(t, f.alice)
	drain(f.bob)

	id := created["id"].(string)
	f.alice.handleTextMessageEdit(map[string]interface{}{"message_id": id, "content": "caption"})

	got := messagesOfType(t, f.bob, "text_message_updated")
	if len(got) != 1 {
		t.Fatalf("bob got %d updates, want 1", len(got))
	}
	msg := got[0].Data.(map[string]interface{})["message"].(map[string]interface{})
	if msg["content"] != "caption" {
		t.Fatalf("content = %v", msg["content"])
	}
	if gif, ok := msg["gif"].(map[string]interface{}); !ok || gif["id"] != "8041071659142944" {
		t.Fatalf("edit dropped the gif: %+v", msg)
	}
}
