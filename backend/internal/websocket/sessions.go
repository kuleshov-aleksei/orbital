package websocket

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

// CloseSessionRevoked is the close code sent to a socket whose sign-in
// session was revoked (signed out from another device). The frontend
// (services/websocket.ts) treats it as an expired session and stops
// reconnecting.
const CloseSessionRevoked = 4401

func closeSessionRevoked(conn *websocket.Conn) {
	msg := websocket.FormatCloseMessage(CloseSessionRevoked, "session_revoked")
	_ = conn.WriteControl(websocket.CloseMessage, msg, time.Now().Add(time.Second))
}

// CloseSessions closes the user's sockets opened with one of sessionIDs.
func (h *Hub) CloseSessions(userID string, sessionIDs []string) {
	ended := make(map[string]bool, len(sessionIDs))
	for _, id := range sessionIDs {
		ended[id] = true
	}
	h.closeUserSockets(userID, func(sessionID string) bool { return sessionID != "" && ended[sessionID] })
}

// CloseOtherSessions closes every socket of the user except those of
// keepSessionID, including sockets opened with legacy session-less tokens.
func (h *Hub) CloseOtherSessions(userID, keepSessionID string) {
	h.closeUserSockets(userID, func(sessionID string) bool { return sessionID != keepSessionID })
}

// closeUserSockets closes matching sockets; their readPump then fails and the
// usual cleanup runs.
func (h *Hub) closeUserSockets(userID string, match func(sessionID string) bool) {
	h.mu.RLock()
	var targets []*Client
	for c := range h.clients {
		c.mu.RLock()
		hit := c.userID == userID && match(c.sessionID)
		c.mu.RUnlock()
		if hit {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		log.Printf("[WebSocket] Closing socket of user %s: session revoked", userID)
		closeSessionRevoked(c.conn)
		_ = c.conn.Close()
	}
}
