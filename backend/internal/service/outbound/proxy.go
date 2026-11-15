// Package outbound holds the proxy for the server's calls to the internet
// (link previews today). It is set by a super admin in the admin panel
// (Network tab) and stored in app_settings, never in the environment.
//
// To route a new outbound HTTP client through it, set the transport's
// Proxy to Proxy.Func().
package outbound

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// settingKey is the app_settings key of the proxy URL.
const settingKey = "outbound_proxy"

// redactedPassword is what url.URL.Redacted puts in place of a password.
const redactedPassword = "xxxxx"

// SettingsStore persists the proxy URL (repository.AppSettingsRepository).
type SettingsStore interface {
	Get(key string) (string, error)
	Set(key, value string) error
}

// Proxy is the current outbound proxy; the zero URL means direct
// connections. Safe for concurrent use.
type Proxy struct {
	store SettingsStore

	mu  sync.RWMutex
	url *url.URL

	listenersMu sync.RWMutex
	listeners   []func()
}

// New loads the stored proxy. A stored value that no longer parses is
// ignored (direct connections) rather than failing startup.
func New(store SettingsStore) (*Proxy, error) {
	p := &Proxy{store: store}
	raw, err := store.Get(settingKey)
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", settingKey, err)
	}
	if raw != "" {
		if u, err := Parse(raw); err == nil {
			p.url = u
		}
	}
	return p, nil
}

// Parse validates a proxy URL: http, https, socks5 or socks5h, with a host
// and port; credentials are allowed.
func Parse(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("not a valid URL")
	}
	switch u.Scheme {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, errors.New("scheme must be http, https, socks5 or socks5h")
	}
	if u.Hostname() == "" || u.Port() == "" {
		return nil, errors.New("proxy URL needs a host and a port, e.g. socks5://127.0.0.1:1080")
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("proxy URL must not have a path or query")
	}
	u.Path = ""
	return u, nil
}

// URL returns a copy of the proxy URL, or nil for direct connections.
func (p *Proxy) URL() *url.URL {
	if p == nil {
		return nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.url == nil {
		return nil
	}
	c := *p.url
	if p.url.User != nil {
		uc := *p.url.User
		c.User = &uc
	}
	return &c
}

// Redacted returns the proxy URL with the password masked, "" when unset.
func (p *Proxy) Redacted() string {
	if u := p.URL(); u != nil {
		return u.Redacted()
	}
	return ""
}

// Resolve parses a URL from the admin panel. A masked password ("xxxxx",
// as Redacted shows it) for the same user and host keeps the stored one, so
// saving the form unchanged does not wipe the password. "" means no proxy.
func (p *Proxy) Resolve(raw string) (*url.URL, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	u, err := Parse(raw)
	if err != nil {
		return nil, err
	}
	if pw, ok := u.User.Password(); ok && pw == redactedPassword {
		cur := p.URL()
		if cur == nil || cur.User == nil || cur.Host != u.Host || cur.User.Username() != u.User.Username() {
			return nil, errors.New("enter the proxy password again")
		}
		curPw, _ := cur.User.Password()
		u.User = url.UserPassword(u.User.Username(), curPw)
	}
	return u, nil
}

// Set stores a new proxy (see Resolve; "" removes it) and notifies listeners.
func (p *Proxy) Set(raw string) error {
	u, err := p.Resolve(raw)
	if err != nil {
		return err
	}
	value := ""
	if u != nil {
		value = u.String()
	}
	if err := p.store.Set(settingKey, value); err != nil {
		return err
	}
	p.mu.Lock()
	p.url = u
	p.mu.Unlock()

	p.listenersMu.RLock()
	listeners := append([]func(){}, p.listeners...)
	p.listenersMu.RUnlock()
	for _, fn := range listeners {
		fn()
	}
	return nil
}

// OnChange registers a callback run after the proxy changes.
func (p *Proxy) OnChange(fn func()) {
	p.listenersMu.Lock()
	p.listeners = append(p.listeners, fn)
	p.listenersMu.Unlock()
}

// Func is an http.Transport Proxy function that follows the current
// setting (nil URL: direct). It is read per request, so changes apply
// without rebuilding clients.
func (p *Proxy) Func() func(*http.Request) (*url.URL, error) {
	return func(*http.Request) (*url.URL, error) { return p.URL(), nil }
}
