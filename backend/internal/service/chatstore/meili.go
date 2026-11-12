package chatstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Meili is the Meilisearch Engine, spoken to over plain HTTP (no SDK).
// Ported from experiments/chat-search/internal/store/meili.go.
type Meili struct {
	url, key, index string
	hc              *http.Client
}

// NewMeili creates a client; call Bootstrap before use.
func NewMeili(baseURL, apiKey, index string) *Meili {
	return &Meili{
		url:   strings.TrimSuffix(baseURL, "/"),
		key:   apiKey,
		index: index,
		// Keep-alive is disabled: on loopback, reused connections stalled for a
		// flat ~40 ms in the prototype (Nagle/delayed ACK), dwarfing the 1-5 ms
		// engine time. A fresh local connection costs ~0.1 ms.
		hc: &http.Client{
			Timeout:   30 * time.Second,
			Transport: &http.Transport{DisableKeepAlives: true},
		},
	}
}

// meiliSettings is the index configuration (docs/specs/CHAT_SYSTEM.md §5.1).
var meiliSettings = map[string]any{
	"searchableAttributes": []string{"content_search", "attachment_names", "attachment_text"},
	"filterableAttributes": []string{
		"room_id", "sender_id", "created_at_ts", "seq", "is_deleted", "pinned",
		"reply_to_id", "mention_user_ids", "mention_role_ids", "attachment_kinds",
	},
	"sortableAttributes": []string{"seq", "created_at_ts", "pinned_at_ts"},
	"typoTolerance": map[string]any{
		"enabled":             true,
		"minWordSizeForTypos": map[string]int{"oneTypo": 4, "twoTypos": 8},
	},
	"pagination": map[string]int{"maxTotalHits": 1000},
}

// MeiliError is an error response from Meilisearch.
type MeiliError struct {
	Status  int
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *MeiliError) Error() string {
	return fmt.Sprintf("meilisearch %d %s: %s", e.Status, e.Code, e.Message)
}

func (m *Meili) do(ctx context.Context, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, m.url+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if m.key != "" {
		req.Header.Set("Authorization", "Bearer "+m.key)
	}
	resp, err := m.hc.Do(req)
	if err != nil {
		return unavailable(err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return unavailable(err)
	}
	if resp.StatusCode >= 300 {
		e := &MeiliError{Status: resp.StatusCode}
		_ = json.Unmarshal(data, e)
		if e.Message == "" {
			e.Message = string(data)
		}
		if resp.StatusCode >= 500 {
			return errors.Join(ErrUnavailable, e)
		}
		return e
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// unavailable marks transport errors (connection refused, timeouts) so
// callers can answer 503 instead of 500.
func unavailable(err error) error {
	return errors.Join(ErrUnavailable, err)
}

type taskRef struct {
	TaskUID int64 `json:"taskUid"`
}

// waitTask polls a task until it finishes. Some failures (e.g. a bad setting)
// only surface as a failed task, never as an HTTP error.
func (m *Meili) waitTask(ctx context.Context, uid int64) error {
	delay := 20 * time.Millisecond
	for {
		var t struct {
			Status TaskStatus `json:"status"`
			Error  *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := m.do(ctx, http.MethodGet, "/tasks/"+strconv.FormatInt(uid, 10), nil, &t); err != nil {
			return err
		}
		switch t.Status {
		case TaskSucceeded:
			return nil
		case TaskFailed, TaskCanceled:
			if t.Error != nil {
				return &MeiliError{Code: t.Error.Code, Message: fmt.Sprintf("task %d %s: %s", uid, t.Status, t.Error.Message)}
			}
			return fmt.Errorf("meilisearch task %d %s", uid, t.Status)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		delay = min(delay*2, time.Second)
	}
}

func (m *Meili) Health(ctx context.Context) error {
	return m.do(ctx, http.MethodGet, "/health", nil, nil)
}

func (m *Meili) Bootstrap(ctx context.Context) error {
	if err := m.Health(ctx); err != nil {
		return err
	}
	var task taskRef
	if err := m.do(ctx, http.MethodPost, "/indexes", map[string]any{"uid": m.index, "primaryKey": "id"}, &task); err != nil {
		return err
	}
	if err := m.waitTask(ctx, task.TaskUID); err != nil {
		var me *MeiliError
		if !errors.As(err, &me) || me.Code != "index_already_exists" {
			return err
		}
	}
	// Settings changes make Meilisearch reindex its own documents; waiting
	// here keeps startup honest about whether the index is usable.
	if err := m.do(ctx, http.MethodPatch, m.indexPath("/settings"), meiliSettings, &task); err != nil {
		return err
	}
	return m.waitTask(ctx, task.TaskUID)
}

func (m *Meili) indexPath(suffix string) string {
	return "/indexes/" + url.PathEscape(m.index) + suffix
}

// noImageVectors opts a document out of the ImageEmbedder. A userProvided
// embedder rejects documents without _vectors.<name> (even ones without
// images), so every new document carries it; with no embedder configured
// it is an ordinary field.
var noImageVectors = map[string]any{ImageEmbedder: nil}

func (m *Meili) Add(ctx context.Context, msg *Message) (int64, error) {
	doc := struct {
		*Message
		Vectors map[string]any `json:"_vectors"`
	}{msg, noImageVectors}
	var task taskRef
	err := m.do(ctx, http.MethodPost, m.indexPath("/documents"), []any{doc}, &task)
	return task.TaskUID, err
}

func (m *Meili) Patch(ctx context.Context, id string, fields map[string]any) (int64, error) {
	doc := make(map[string]any, len(fields)+1)
	for k, v := range fields {
		doc[k] = v
	}
	doc["id"] = id
	var task taskRef
	// PUT /documents merges the given top-level fields into the stored document.
	err := m.do(ctx, http.MethodPut, m.indexPath("/documents"), []map[string]any{doc}, &task)
	return task.TaskUID, err
}

func (m *Meili) DeleteDocument(ctx context.Context, id string) (int64, error) {
	var task taskRef
	err := m.do(ctx, http.MethodDelete, m.indexPath("/documents/"+url.PathEscape(id)), nil, &task)
	return task.TaskUID, err
}

func (m *Meili) DeleteRoom(ctx context.Context, roomID string) (int64, error) {
	var task taskRef
	err := m.do(ctx, http.MethodPost, m.indexPath("/documents/delete"),
		map[string]any{"filter": "room_id = " + quote(roomID)}, &task)
	return task.TaskUID, err
}

func (m *Meili) Get(ctx context.Context, id string) (*Message, error) {
	var msg Message
	err := m.do(ctx, http.MethodGet, m.indexPath("/documents/"+url.PathEscape(id)), nil, &msg)
	if err != nil {
		var me *MeiliError
		if errors.As(err, &me) && me.Status == http.StatusNotFound {
			return nil, nil
		}
		return nil, err
	}
	msg.normalize()
	return &msg, nil
}

func (m *Meili) Fetch(ctx context.Context, ids []string) ([]*Message, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var resp struct {
		Results []*Message `json:"results"`
	}
	// Results come back unordered; missing ids are silently skipped.
	err := m.do(ctx, http.MethodPost, m.indexPath("/documents/fetch"),
		map[string]any{"ids": ids, "limit": len(ids)}, &resp)
	for _, msg := range resp.Results {
		msg.normalize()
	}
	return resp.Results, err
}

type searchResp struct {
	Hits []*Message `json:"hits"`
}

func listFilter(q ListQuery) []string {
	f := []string{"room_id = " + quote(q.RoomID), "is_deleted = false"}
	if q.BeforeSeq > 0 {
		f = append(f, fmt.Sprintf("seq < %d", q.BeforeSeq))
	}
	if q.AfterSeq > 0 {
		f = append(f, fmt.Sprintf("seq > %d", q.AfterSeq))
	}
	if q.BeforeTS > 0 {
		f = append(f, fmt.Sprintf("created_at_ts < %d", q.BeforeTS))
	}
	return f
}

func (m *Meili) List(ctx context.Context, q ListQuery) ([]*Message, error) {
	sort := "seq:desc"
	if q.Asc {
		sort = "seq:asc"
	}
	var resp searchResp
	err := m.do(ctx, http.MethodPost, m.indexPath("/search"), map[string]any{
		"q": "", "filter": listFilter(q), "sort": []string{sort}, "limit": q.Limit,
	}, &resp)
	for _, msg := range resp.Hits {
		msg.normalize()
	}
	return resp.Hits, err
}

func (m *Meili) NewestSeqs(ctx context.Context, roomIDs []string) (map[string]int64, error) {
	out := make(map[string]int64, len(roomIDs))
	if len(roomIDs) == 0 {
		return out, nil
	}
	queries := make([]map[string]any, len(roomIDs))
	for i, id := range roomIDs {
		queries[i] = map[string]any{
			"indexUid": m.index, "q": "", "limit": 1, "sort": []string{"seq:desc"},
			"filter":               listFilter(ListQuery{RoomID: id}),
			"attributesToRetrieve": []string{"seq", "room_id"},
		}
	}
	var resp struct {
		Results []searchResp `json:"results"`
	}
	if err := m.do(ctx, http.MethodPost, "/multi-search", map[string]any{"queries": queries}, &resp); err != nil {
		return nil, err
	}
	for i, r := range resp.Results {
		if i < len(roomIDs) && len(r.Hits) > 0 {
			out[roomIDs[i]] = r.Hits[0].Seq
		}
	}
	return out, nil
}

func (m *Meili) MaxSeq(ctx context.Context) (int64, error) {
	var resp searchResp
	err := m.do(ctx, http.MethodPost, m.indexPath("/search"), map[string]any{
		"q": "", "sort": []string{"seq:desc"}, "limit": 1, "attributesToRetrieve": []string{"seq"},
	}, &resp)
	if err != nil || len(resp.Hits) == 0 {
		return 0, err
	}
	return resp.Hits[0].Seq, nil
}

func (m *Meili) Tasks(ctx context.Context, uids []int64) (map[int64]TaskStatus, error) {
	out := make(map[int64]TaskStatus, len(uids))
	if len(uids) == 0 {
		return out, nil
	}
	parts := make([]string, len(uids))
	for i, u := range uids {
		parts[i] = strconv.FormatInt(u, 10)
	}
	var resp struct {
		Results []struct {
			UID    int64      `json:"uid"`
			Status TaskStatus `json:"status"`
		} `json:"results"`
	}
	path := "/tasks?limit=" + strconv.Itoa(len(uids)) + "&uids=" + strings.Join(parts, ",")
	if err := m.do(ctx, http.MethodGet, path, nil, &resp); err != nil {
		return nil, err
	}
	for _, t := range resp.Results {
		out[t.UID] = t.Status
	}
	return out, nil
}

// quote renders a filter string literal.
func quote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func (m *Meili) Pins(ctx context.Context, roomID string, limit int) ([]*Message, error) {
	var resp searchResp
	err := m.do(ctx, http.MethodPost, m.indexPath("/search"), map[string]any{
		"q": "", "limit": limit, "sort": []string{"pinned_at_ts:desc"},
		"filter": []string{"room_id = " + quote(roomID), "is_deleted = false", "pinned = true"},
	}, &resp)
	for _, msg := range resp.Hits {
		msg.normalize()
	}
	return resp.Hits, err
}

func quoteList(ids []string) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = quote(id)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// searchFilter builds the filter of a search; room and deletion filters are
// always present.
func searchFilter(req SearchRequest) []any {
	f := []any{"room_id IN " + quoteList(req.RoomIDs), "is_deleted = false"}
	if len(req.SenderIDs) > 0 {
		f = append(f, "sender_id IN "+quoteList(req.SenderIDs))
	}
	if len(req.MentionUserIDs) > 0 {
		f = append(f, "mention_user_ids IN "+quoteList(req.MentionUserIDs))
	}
	if req.FromTS > 0 {
		f = append(f, fmt.Sprintf("created_at_ts >= %d", req.FromTS))
	}
	if req.ToTS > 0 {
		f = append(f, fmt.Sprintf("created_at_ts < %d", req.ToTS))
	}
	if req.Pinned != nil {
		f = append(f, fmt.Sprintf("pinned = %t", *req.Pinned))
	}
	for _, k := range req.HasKinds {
		f = append(f, "attachment_kinds = "+quote(k))
	}
	if req.HasAttachment {
		// IN, not IS NOT EMPTY: older documents may lack the field.
		f = append(f, `attachment_kinds IN ["image", "video", "audio"]`)
	}
	return f
}

// snippetParams crop and highlight content_search around the query words.
func snippetParams(body map[string]any) {
	body["attributesToCrop"] = []string{"content_search"}
	body["cropLength"] = 40
	body["attributesToHighlight"] = []string{"content_search"}
	body["highlightPreTag"] = HighlightPre
	body["highlightPostTag"] = HighlightPost
}

func (m *Meili) Search(ctx context.Context, req SearchRequest) (*SearchResult, error) {
	body := map[string]any{
		"q": req.Text, "filter": searchFilter(req), "matchingStrategy": "all",
	}
	if req.Text != "" {
		snippetParams(body)
	}
	if req.SortNewest || req.Text == "" {
		body["sort"] = []string{"seq:desc"}
	}
	path := m.indexPath("/search")
	if len(req.Vector) > 0 && req.Text != "" && !req.SortNewest {
		// Federated search: the keyword query as is, plus images close to the
		// query by meaning. Hits are merged by ranking score and a message
		// found by both queries appears once. The threshold keeps unrelated
		// images out (every image has some similarity to any text).
		body["indexUid"] = m.index
		semantic := map[string]any{
			"indexUid": m.index, "q": req.Text, "vector": req.Vector,
			"hybrid":                map[string]any{"embedder": ImageEmbedder, "semanticRatio": 1.0},
			"filter":                append(searchFilter(req), "attachment_kinds = "+quote("image")),
			"rankingScoreThreshold": req.MinSemanticScore,
		}
		snippetParams(semantic)
		path = "/multi-search"
		body = map[string]any{
			"federation": map[string]any{"limit": req.Limit, "offset": req.Offset},
			"queries":    []map[string]any{body, semantic},
		}
	} else {
		body["limit"], body["offset"] = req.Limit, req.Offset
	}
	var resp struct {
		Hits []struct {
			Message
			Formatted *struct {
				ContentSearch string `json:"content_search"`
			} `json:"_formatted"`
		} `json:"hits"`
		EstimatedTotalHits int `json:"estimatedTotalHits"`
	}
	if err := m.do(ctx, http.MethodPost, path, body, &resp); err != nil {
		return nil, err
	}
	out := &SearchResult{Total: resp.EstimatedTotalHits, Hits: make([]SearchHit, 0, len(resp.Hits))}
	for i := range resp.Hits {
		h := &resp.Hits[i]
		msg := h.Message
		msg.normalize()
		hit := SearchHit{Message: &msg}
		if h.Formatted != nil && req.Text != "" {
			hit.Snippet = h.Formatted.ContentSearch
		}
		out.Hits = append(out.Hits, hit)
	}
	return out, nil
}

func (m *Meili) ImageEmbedderDims(ctx context.Context) (int, error) {
	var embedders map[string]struct {
		Source     string `json:"source"`
		Dimensions int    `json:"dimensions"`
	}
	if err := m.do(ctx, http.MethodGet, m.indexPath("/settings/embedders"), nil, &embedders); err != nil {
		return 0, err
	}
	e, ok := embedders[ImageEmbedder]
	if !ok || e.Source != "userProvided" {
		return 0, nil
	}
	return e.Dimensions, nil
}

// SetImageEmbedder replaces the ImageEmbedder (removing it first: the size
// of an embedder cannot change in place, and old vectors are meaningless in
// a new model's space).
func (m *Meili) SetImageEmbedder(ctx context.Context, dims int) error {
	cur, err := m.ImageEmbedderDims(ctx)
	if err != nil {
		return err
	}
	if cur == dims {
		return nil
	}
	if cur > 0 {
		if err := m.setEmbedder(ctx, nil); err != nil {
			return err
		}
	}
	if err := m.optOutAll(ctx); err != nil {
		return err
	}
	return m.setEmbedder(ctx, map[string]any{"source": "userProvided", "dimensions": dims})
}

func (m *Meili) setEmbedder(ctx context.Context, e any) error {
	var task taskRef
	body := map[string]any{"embedders": map[string]any{ImageEmbedder: e}}
	if err := m.do(ctx, http.MethodPatch, m.indexPath("/settings"), body, &task); err != nil {
		return err
	}
	return m.waitTask(ctx, task.TaskUID)
}

// optOutAll sets _vectors.image to null on every document, so creating the
// embedder does not fail on documents from before it (or that still hold
// another model's vectors). The extraction worker writes real vectors
// afterwards.
func (m *Meili) optOutAll(ctx context.Context) error {
	const batch = 1000
	var last int64 = -1
	for offset := 0; ; offset += batch {
		var page struct {
			Results []struct {
				ID string `json:"id"`
			} `json:"results"`
		}
		path := fmt.Sprintf("%s?fields=id&limit=%d&offset=%d", m.indexPath("/documents"), batch, offset)
		if err := m.do(ctx, http.MethodGet, path, nil, &page); err != nil {
			return err
		}
		if len(page.Results) == 0 {
			break
		}
		docs := make([]map[string]any, len(page.Results))
		for i, r := range page.Results {
			docs[i] = map[string]any{"id": r.ID, "_vectors": noImageVectors}
		}
		var task taskRef
		if err := m.do(ctx, http.MethodPut, m.indexPath("/documents"), docs, &task); err != nil {
			return err
		}
		last = task.TaskUID
		if len(page.Results) < batch {
			break
		}
	}
	if last < 0 {
		return nil
	}
	return m.waitTask(ctx, last) // tasks of one index run in order
}

func (m *Meili) CountMentions(ctx context.Context, qs []MentionCountQuery) ([]int, error) {
	out := make([]int, len(qs))
	if len(qs) == 0 {
		return out, nil
	}
	queries := make([]map[string]any, len(qs))
	for i, q := range qs {
		target := "mention_user_ids = " + quote(q.UserID)
		if len(q.RoleIDs) > 0 {
			target = "(" + target + " OR mention_role_ids IN " + quoteList(q.RoleIDs) + ")"
		}
		queries[i] = map[string]any{
			"indexUid": m.index, "q": "", "limit": 0,
			"filter": []string{
				"room_id = " + quote(q.RoomID), "is_deleted = false",
				fmt.Sprintf("seq > %d", q.AfterSeq), "sender_id != " + quote(q.UserID), target,
			},
		}
	}
	var resp struct {
		Results []struct {
			EstimatedTotalHits int `json:"estimatedTotalHits"`
		} `json:"results"`
	}
	if err := m.do(ctx, http.MethodPost, "/multi-search", map[string]any{"queries": queries}, &resp); err != nil {
		return nil, err
	}
	for i, r := range resp.Results {
		if i < len(out) {
			out[i] = r.EstimatedTotalHits
		}
	}
	return out, nil
}
