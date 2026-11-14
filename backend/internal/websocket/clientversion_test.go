package websocket

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

func newVersionTestHub(t *testing.T, min string) (*Hub, *service.ClientVersionService) {
	t.Helper()
	versions, err := service.NewClientVersionService(service.NewMemoryAppSettings())
	if err != nil {
		t.Fatal(err)
	}
	if err := versions.SetAndroidMinVersion(min); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{WebSocket: config.WebSocketConfig{PingTimeout: 30 * time.Second, PingCheckInterval: time.Hour}}
	hub := NewHub(service.NewRoomService(nil, nil), nil, nil, nil, nil, cfg)
	hub.SetClientVersionService(versions)
	versions.OnChange(hub.OnClientVersionChanged)
	return hub, versions
}

// readCloseCode reads until the server closes the socket and returns the close code (0 = none).
func readCloseCode(t *testing.T, conn *websocket.Conn) int {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			var ce *websocket.CloseError
			if errors.As(err, &ce) {
				return ce.Code
			}
			return 0
		}
	}
}

func dialWS(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestOutdatedClientRejectedOnConnect(t *testing.T) {
	hub, _ := newVersionTestHub(t, "1.5.0")
	srv := httptest.NewServer(http.HandlerFunc(hub.HandleGlobalWebSocket))
	defer srv.Close()
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	if code := readCloseCode(t, dialWS(t, base+"/ws?client=android/1.4.0")); code != CloseClientOutdated {
		t.Fatalf("outdated app: close code = %d, want %d", code, CloseClientOutdated)
	}
	// A current app passes the version check (and is then refused for the
	// missing token, without the outdated code).
	if code := readCloseCode(t, dialWS(t, base+"/ws?client=android/1.5.0")); code == CloseClientOutdated {
		t.Fatal("current app got the outdated close code")
	}
	if code := readCloseCode(t, dialWS(t, base+"/ws")); code == CloseClientOutdated {
		t.Fatal("web client got the outdated close code")
	}
}

func TestRaisedFloorClosesConnectedApps(t *testing.T) {
	hub, versions := newVersionTestHub(t, "")
	registered := make(chan struct{}, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := hub.upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := &Client{hub: hub, conn: conn, send: make(chan []byte, 1), clientID: r.URL.Query().Get("client"), userID: "qkUrdzLDoqslx8EEy2cM7Q=="}
		hub.mu.Lock()
		hub.clients[c] = true
		hub.mu.Unlock()
		registered <- struct{}{}
	}))
	defer srv.Close()
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	oldApp := dialWS(t, base+"?client=android/1.4.0")
	newApp := dialWS(t, base+"?client=android/1.5.0")
	<-registered
	<-registered

	if err := versions.SetAndroidMinVersion("1.5.0"); err != nil {
		t.Fatal(err)
	}
	if code := readCloseCode(t, oldApp); code != CloseClientOutdated {
		t.Fatalf("old app: close code = %d, want %d", code, CloseClientOutdated)
	}
	_ = newApp.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, _, err := newApp.ReadMessage(); err == nil || websocket.IsCloseError(err, CloseClientOutdated) {
		t.Fatalf("current app should stay connected, got %v", err)
	}
}
