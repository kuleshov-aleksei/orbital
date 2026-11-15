package outbound

import (
	"net/http"
	"testing"
)

type memStore map[string]string

func (m memStore) Get(k string) (string, error) { return m[k], nil }
func (m memStore) Set(k, v string) error {
	if v == "" {
		delete(m, k)
	} else {
		m[k] = v
	}
	return nil
}

func TestParse(t *testing.T) {
	for _, ok := range []string{"http://127.0.0.1:1081", "socks5://user:pa%40ss@proxy.example:1080", "socks5h://[::1]:1080", "https://p.example:443/"} {
		if _, err := Parse(ok); err != nil {
			t.Errorf("Parse(%q): %v", ok, err)
		}
	}
	for _, bad := range []string{"127.0.0.1:1081", "ftp://p.example:21", "http://p.example", "socks5://:1080", "http://p.example:80/path", "http://p.example:80?x=1"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("Parse(%q) accepted", bad)
		}
	}
}

func TestSetPersistsAndMasksPassword(t *testing.T) {
	store := memStore{}
	p, err := New(store)
	if err != nil {
		t.Fatal(err)
	}
	if p.URL() != nil {
		t.Fatal("no proxy by default")
	}
	changed := 0
	p.OnChange(func() { changed++ })
	if err := p.Set("socks5://alice:s3cret@127.0.0.1:1080"); err != nil {
		t.Fatal(err)
	}
	if got := p.Redacted(); got != "socks5://alice:xxxxx@127.0.0.1:1080" {
		t.Fatalf("Redacted = %q", got)
	}
	// Saving the masked form keeps the stored password.
	if err := p.Set(p.Redacted()); err != nil {
		t.Fatal(err)
	}
	if pw, _ := p.URL().User.Password(); pw != "s3cret" {
		t.Fatalf("password = %q", pw)
	}
	// A masked password for another host can't borrow it.
	if err := p.Set("socks5://alice:xxxxx@10.0.0.1:1080"); err == nil {
		t.Fatal("masked password accepted for another host")
	}
	// Reloaded from the store.
	p2, _ := New(store)
	if p2.URL().String() != "socks5://alice:s3cret@127.0.0.1:1080" {
		t.Fatalf("reloaded = %v", p2.URL())
	}
	req, _ := http.NewRequest(http.MethodGet, "https://example.com", nil)
	if u, _ := p2.Func()(req); u == nil || u.Host != "127.0.0.1:1080" {
		t.Fatalf("Func = %v", u)
	}
	if err := p.Set(""); err != nil || p.URL() != nil || store[settingKey] != "" {
		t.Fatal("clearing failed")
	}
	if changed != 3 {
		t.Fatalf("listeners ran %d times, want 3", changed)
	}
	var nilProxy *Proxy
	if nilProxy.URL() != nil {
		t.Fatal("nil proxy must mean direct")
	}
}
