package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

type memPushDevices struct{ owner map[string]string }

func (m *memPushDevices) Upsert(token, userID, _ string) error {
	m.owner[token] = userID
	return nil
}

func (m *memPushDevices) DeleteForUser(userID, token string) error {
	if m.owner[token] == userID {
		delete(m.owner, token)
	}
	return nil
}

func TestPushDeviceHandlers(t *testing.T) {
	const user = "qkUrdzLDoqslx8EEy2cM7Q=="
	store := &memPushDevices{owner: map[string]string{}}
	h := NewPushHandler(store)
	call := func(fn http.HandlerFunc, method, body string, authed bool) int {
		req := httptest.NewRequest(method, "/api/push/devices", bytes.NewBufferString(body))
		if authed {
			req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{UserID: user}))
		}
		rec := httptest.NewRecorder()
		fn(rec, req)
		return rec.Code
	}

	if code := call(h.RegisterDevice, http.MethodPost, `{"token":"t1","platform":"android"}`, false); code != http.StatusUnauthorized {
		t.Fatalf("anonymous register: %d", code)
	}
	for _, bad := range []string{`{"token":"t1","platform":"ios"}`, `{"platform":"android"}`, `nope`} {
		if code := call(h.RegisterDevice, http.MethodPost, bad, true); code != http.StatusBadRequest {
			t.Fatalf("%s: %d", bad, code)
		}
	}
	if len(store.owner) != 0 {
		t.Fatalf("rejected requests stored tokens: %v", store.owner)
	}
	if code := call(h.RegisterDevice, http.MethodPost, `{"token":"t1","platform":"android"}`, true); code != http.StatusNoContent {
		t.Fatalf("register: %d", code)
	}
	if store.owner["t1"] != user {
		t.Fatalf("owner = %v", store.owner)
	}
	if code := call(h.UnregisterDevice, http.MethodDelete, `{"token":"t1"}`, true); code != http.StatusNoContent {
		t.Fatalf("unregister: %d", code)
	}
	if len(store.owner) != 0 {
		t.Fatalf("token kept after unregister: %v", store.owner)
	}
}
