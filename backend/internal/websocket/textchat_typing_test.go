package websocket

import (
	"testing"
)

func TestTypingIndicator(t *testing.T) {
	f := newTextFixture(t)
	f.alice.handleTextTyping(map[string]interface{}{"room_id": f.text.ID})
	f.alice.handleTextTyping(map[string]interface{}{"room_id": f.text.ID}) // throttled
	if got := messagesOfType(t, f.bob, "text_typing"); len(got) != 1 {
		t.Fatalf("bob got %d typing events", len(got))
	}
	if got := messagesOfType(t, f.alice, "text_typing"); len(got) != 0 {
		t.Fatal("typing echoed to the typist")
	}
	f.alice.handleTextTyping(map[string]interface{}{"room_id": f.hidden.ID})
	if got := messagesOfType(t, f.bob, "text_typing"); len(got) != 0 {
		t.Fatal("bob saw typing in a hidden channel")
	}
}
