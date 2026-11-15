package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/service/outbound"
)

// proxyTestTimeout bounds one "Test connection" request.
const proxyTestTimeout = 10 * time.Second

// defaultProxyTestURL is checked when the admin gives no URL.
const defaultProxyTestURL = "https://www.youtube.com/"

// OutboundProxyHandler serves the super admin Network tab: the proxy for
// the server's calls to the internet (outbound.Proxy).
type OutboundProxyHandler struct {
	proxy *outbound.Proxy
}

func NewOutboundProxyHandler(proxy *outbound.Proxy) *OutboundProxyHandler {
	return &OutboundProxyHandler{proxy: proxy}
}

// OutboundProxyResponse is the body of GET/PUT /api/admin/outbound-proxy.
// The password is masked ("xxxxx"); sending the masked URL back keeps it.
type OutboundProxyResponse struct {
	ProxyURL string `json:"proxy_url"`
}

type outboundProxyRequest struct {
	ProxyURL string `json:"proxy_url"`
}

// Get handles GET /api/admin/outbound-proxy.
func (h *OutboundProxyHandler) Get(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, OutboundProxyResponse{ProxyURL: h.proxy.Redacted()})
}

// Update handles PUT /api/admin/outbound-proxy ("" = direct connections).
func (h *OutboundProxyHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req outboundProxyRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		sendJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.proxy.Set(req.ProxyURL); err != nil {
		sendJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Printf("[OutboundProxy] Proxy set to %q", h.proxy.Redacted())
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, OutboundProxyResponse{ProxyURL: h.proxy.Redacted()})
}

type outboundProxyTestRequest struct {
	// ProxyURL is tested as typed (not saved); "" tests a direct connection.
	ProxyURL string `json:"proxy_url"`
	// URL is fetched through it; "" = defaultProxyTestURL.
	URL string `json:"url"`
}

// OutboundProxyTestResponse reports one test request.
type OutboundProxyTestResponse struct {
	OK        bool   `json:"ok"`
	Status    int    `json:"status,omitempty"`
	ElapsedMS int64  `json:"elapsed_ms"`
	Error     string `json:"error,omitempty"`
}

// Test handles POST /api/admin/outbound-proxy/test: fetches a URL through
// the given proxy, so the admin can check it before saving.
func (h *OutboundProxyHandler) Test(w http.ResponseWriter, r *http.Request) {
	var req outboundProxyTestRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		sendJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	proxyURL, err := h.proxy.Resolve(req.ProxyURL)
	if err != nil {
		sendJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	target := strings.TrimSpace(req.URL)
	if target == "" {
		target = defaultProxyTestURL
	}
	if u, err := url.Parse(target); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		sendJSONError(w, "Test URL must be an http(s) URL", http.StatusBadRequest)
		return
	}

	client := &http.Client{
		Timeout:   proxyTestTimeout,
		Transport: &http.Transport{Proxy: func(*http.Request) (*url.URL, error) { return proxyURL, nil }},
	}
	defer client.CloseIdleConnections()
	start := time.Now()
	resp, err := client.Get(target)
	out := OutboundProxyTestResponse{}
	if err != nil {
		out.Error = err.Error()
	} else {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
		out.Status = resp.StatusCode
		out.OK = resp.StatusCode < 500
	}
	out.ElapsedMS = time.Since(start).Milliseconds()
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, out)
}
