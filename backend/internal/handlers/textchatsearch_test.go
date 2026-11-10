package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
)

type searchResponse struct {
	Hits  []SearchHit `json:"hits"`
	Total int         `json:"total"`
	Hints []string    `json:"hints"`
}

func (f *textHandlerFixture) search(t *testing.T, as, q string) searchResponse {
	t.Helper()
	rec := f.query(t, as, f.text.Search, http.MethodGet, nil, url.Values{"q": {q}, "tz": {"Europe/Moscow"}}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("search %q as %s: %d %s", q, as, rec.Code, rec.Body.String())
	}
	var res searchResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	return res
}

func TestSearchNeverReturnsHiddenChannels(t *testing.T) {
	f := newTextHandlerFixture(t)
	f.post(t, f.openText, "launch plan")
	f.post(t, f.hiddenText, "launch secret")

	if res := f.search(t, "user", "launch"); len(res.Hits) != 1 || res.Hits[0].Message.Content != "launch plan" {
		t.Fatalf("user search = %+v", res)
	}
	// Naming the hidden channel does not reveal it.
	res := f.search(t, "user", "launch in:staff")
	if len(res.Hits) != 0 || len(res.Hints) != 1 {
		t.Fatalf("in:hidden = %+v", res)
	}
	if res := f.search(t, "owner", "launch"); len(res.Hits) != 2 {
		t.Fatalf("owner search = %d hits", len(res.Hits))
	}
	if res := f.search(t, "owner", "launch in:#staff"); len(res.Hits) != 1 || res.Hits[0].Message.Content != "launch secret" {
		t.Fatalf("owner in:staff = %+v", res)
	}
}

func TestSearchFilters(t *testing.T) {
	f := newTextHandlerFixture(t)
	f.postAs(t, f.openText, "user", "hello from user")
	f.postAs(t, f.openText, "mod", "hello from mod <@user>")
	deleted := f.postAs(t, f.openText, "mod", "hello deleted")
	if _, err := f.store.Delete(context.Background(), deleted.ID, "mod", nil); err != nil {
		t.Fatal(err)
	}

	if res := f.search(t, "user", "hello from:MOD"); len(res.Hits) != 1 || res.Hits[0].Message.SenderID != "mod" {
		t.Fatalf("from:mod = %+v", res)
	}
	if res := f.search(t, "user", "from:us"); len(res.Hits) != 1 || res.Hits[0].Message.SenderID != "user" || res.Hits[0].Snippet != "" {
		t.Fatalf("from prefix (filters only) = %+v", res)
	}
	if res := f.search(t, "user", "mentions:@user"); len(res.Hits) != 1 || res.Hits[0].Message.SenderID != "mod" {
		t.Fatalf("mentions:user = %+v", res)
	}
	if res := f.search(t, "user", "hello from:nobody"); len(res.Hits) != 0 || len(res.Hints) != 1 {
		t.Fatalf("unknown author = %+v", res)
	}
	if res := f.search(t, "user", "hello during:today"); len(res.Hits) != 2 {
		t.Fatalf("during:today = %d hits", len(res.Hits))
	}
	if res := f.search(t, "user", "hello before:2020-01-01"); len(res.Hits) != 0 {
		t.Fatalf("before:2020 = %d hits", len(res.Hits))
	}
	if res := f.search(t, "user", "hello has:image"); len(res.Hits) != 0 || len(res.Hints) != 1 {
		t.Fatalf("has:image = %+v", res)
	}
	if res := f.search(t, "user", "   "); len(res.Hits) != 0 {
		t.Fatalf("empty query = %+v", res)
	}
	if rec := f.query(t, "user", f.text.Search, http.MethodGet, nil, url.Values{"q": {"x"}, "sort": {"weird"}}, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad sort: %d", rec.Code)
	}
}
