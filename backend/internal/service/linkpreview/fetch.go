// Package linkpreview makes link previews (embeds) for text channel
// messages: it fetches the linked page on the server, reads its OpenGraph
// tags and proxies the preview image through S3, so viewers never contact
// third-party sites (docs/specs/CHAT_SYSTEM.md §7.15).
package linkpreview

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

const (
	fetchTimeout  = 6 * time.Second
	maxRedirects  = 3
	maxHTMLBytes  = 1 << 20
	maxImageBytes = 8 << 20
	userAgent     = "Mozilla/5.0 (compatible; OrbitalBot/1.0; link previews)"
)

var (
	errBlockedAddress = errors.New("address not allowed")
	errTooLarge       = errors.New("response too large")
)

// cgnat is 100.64.0.0/10 (carrier-grade NAT, also Tailscale/Headscale).
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// publicAddr reports whether a resolved address may be fetched: no
// loopback, private, link-local (cloud metadata), CGNAT, multicast or
// unspecified addresses.
func publicAddr(a netip.Addr) bool {
	a = a.Unmap()
	return a.IsValid() && a.IsGlobalUnicast() && !a.IsPrivate() && !cgnat.Contains(a) &&
		!a.IsLoopback() && !a.IsLinkLocalUnicast()
}

// Fetcher downloads pages and images. Every connection is checked after
// DNS resolution (in the dialer), which covers redirects and DNS rebinding.
type Fetcher struct {
	client *http.Client
}

// NewFetcher returns a Fetcher. allowPrivate turns the address check off
// (tests against httptest servers only).
func NewFetcher(allowPrivate bool) *Fetcher {
	dialer := &net.Dialer{
		Timeout: fetchTimeout,
		Control: func(_, address string, _ syscall.RawConn) error {
			if allowPrivate {
				return nil
			}
			ap, err := netip.ParseAddrPort(address)
			if err != nil || !publicAddr(ap.Addr()) {
				return errBlockedAddress
			}
			return nil
		},
	}
	transport := &http.Transport{
		Proxy:                 nil, // a proxy would hide the real destination from the check
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   fetchTimeout,
		ResponseHeaderTimeout: fetchTimeout,
		MaxIdleConns:          16,
		IdleConnTimeout:       30 * time.Second,
	}
	return &Fetcher{client: &http.Client{
		Transport: transport,
		Timeout:   fetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("too many redirects")
			}
			if !allowedURL(req.URL) {
				return errBlockedAddress
			}
			return nil
		},
	}}
}

// allowedURL accepts http(s) URLs without credentials.
func allowedURL(u *url.URL) bool {
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil
}

// response is a fetched body.
type response struct {
	finalURL    *url.URL
	contentType string // media type, lower case, no parameters
	charset     string
	body        []byte
}

// get fetches rawURL. HTML bodies are cut at maxHTMLBytes (the head is all
// we need); images larger than maxImageBytes fail.
func (f *Fetcher) get(ctx context.Context, rawURL, accept string) (*response, error) {
	u, err := url.Parse(rawURL)
	if err != nil || !allowedURL(u) {
		return nil, fmt.Errorf("bad url")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	req.Header.Set("Accept-Language", "en,ru;q=0.8,*;q=0.5")
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	mt, params, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	out := &response{finalURL: resp.Request.URL, contentType: strings.ToLower(mt), charset: params["charset"]}

	limit := int64(maxHTMLBytes)
	if strings.HasPrefix(out.contentType, "image/") {
		limit = maxImageBytes
		if resp.ContentLength > limit {
			return nil, errTooLarge
		}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		if strings.HasPrefix(out.contentType, "image/") {
			return nil, errTooLarge
		}
		body = body[:limit]
	}
	out.body = body
	return out, nil
}
