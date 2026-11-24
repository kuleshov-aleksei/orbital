package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/service/outbound"
)

func TestOutboundProxyHandler(t *testing.T) {
	proxy, err := outbound.New(service.NewMemoryAppSettings())
	if err != nil {
		t.Fatal(err)
	}
	h := NewOutboundProxyHandler(proxy)
	put := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.Update(rec, httptest.NewRequest(http.MethodPut, "/api/admin/outbound-proxy", strings.NewReader(body)))
		return rec
	}

	if rec := put(`{"proxy_url":"ftp://x:21"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad scheme: %d", rec.Code)
	}
	rec := put(`{"proxy_url":"http://bob:pw@127.0.0.1:1081"}`)
	var got OutboundProxyResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.ProxyURL != "http://bob:xxxxx@127.0.0.1:1081" {
		t.Fatalf("set: %d %+v", rec.Code, got)
	}

	rec = httptest.NewRecorder()
	h.Get(rec, httptest.NewRequest(http.MethodGet, "/api/admin/outbound-proxy", nil))
	if strings.Contains(rec.Body.String(), "pw@") {
		t.Fatalf("GET leaks the password: %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.Test(rec, httptest.NewRequest(http.MethodPost, "/api/admin/outbound-proxy/test", strings.NewReader(`{"url":"file:///etc/passwd"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("test with a file URL: %d", rec.Code)
	}
}
