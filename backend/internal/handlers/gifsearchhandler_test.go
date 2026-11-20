package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

func TestGIFSearchConfigDisabled(t *testing.T) {
	h := NewGIFSearchHandler(config.ChatConfig{})
	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/chat/gif-config", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestGIFSearchConfigServesClientKey(t *testing.T) {
	h := NewGIFSearchHandler(config.ChatConfig{
		GIFProvider: "klipy", GIFAPIKey: "test-key", GIFRating: "pg-13",
	})
	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/chat/gif-config", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got GIFSearchConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Provider != "klipy" || got.APIKey != "test-key" || got.Rating != "pg-13" {
		t.Fatalf("bad body: %+v", got)
	}
}

// An incomplete configuration must not leak a key without a usable provider.
func TestGIFSearchConfigKeyWithoutProvider(t *testing.T) {
	h := NewGIFSearchHandler(config.ChatConfig{GIFAPIKey: "test-key"})
	rec := httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/chat/gif-config", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// /api/config only advertises the provider; the key stays behind auth.
func TestAppConfigAdvertisesGIFProviderWithoutKey(t *testing.T) {
	h := &RoomHandler{}
	h.SetTextChat(&websocket.TextChat{GIFProvider: "klipy"})

	rec := httptest.NewRecorder()
	h.GetConfig(rec, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"gif_provider":"klipy"`) {
		t.Fatalf("config does not advertise the provider: %s", body)
	}
	if strings.Contains(body, "api_key") || strings.Contains(body, "test-key") {
		t.Fatalf("config leaks a key: %s", body)
	}
}

func TestAppConfigOmitsGIFProviderWhenOff(t *testing.T) {
	h := &RoomHandler{}
	h.SetTextChat(&websocket.TextChat{})

	rec := httptest.NewRecorder()
	h.GetConfig(rec, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	if strings.Contains(rec.Body.String(), "gif_provider") {
		t.Fatalf("disabled GIF search still advertised: %s", rec.Body.String())
	}
}
