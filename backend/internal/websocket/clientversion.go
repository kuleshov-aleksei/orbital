package websocket

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// CloseClientOutdated is the close code sent to an app below the minimum
// version (frontend services/websocket.ts stops reconnecting on it).
const CloseClientOutdated = 4426

// SetClientVersionService enables the minimum app version check.
func (h *Hub) SetClientVersionService(s *service.ClientVersionService) {
	h.clientVersions = s
}

// closeOutdated sends the client_outdated close frame. WriteControl may run
// concurrently with the client's writePump.
func closeOutdated(conn *websocket.Conn) {
	msg := websocket.FormatCloseMessage(CloseClientOutdated, "client_outdated")
	_ = conn.WriteControl(websocket.CloseMessage, msg, time.Now().Add(time.Second))
}

// OnClientVersionChanged closes connections of apps that are now below the
// minimum version, so a raised floor applies immediately. Their readPump then
// fails and the usual cleanup runs.
func (h *Hub) OnClientVersionChanged() {
	if h.clientVersions == nil {
		return
	}
	h.mu.RLock()
	var outdated []*Client
	for c := range h.clients {
		if h.clientVersions.IsOutdated(c.clientID) {
			outdated = append(outdated, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range outdated {
		log.Printf("[WebSocket] Closing outdated client %q (user %s)", c.clientID, c.userID)
		closeOutdated(c.conn)
		_ = c.conn.Close()
	}
}
