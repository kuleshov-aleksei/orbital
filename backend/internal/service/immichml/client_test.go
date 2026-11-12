package immichml

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
)

// fakeML mimics POST /predict of immich-machine-learning.
type fakeML struct {
	t       *testing.T
	status  int
	entries map[string]any
	image   []byte
	text    string
}

func (f *fakeML) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/ping" {
		_, _ = io.WriteString(w, "pong")
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/predict" {
		http.NotFound(w, r)
		return
	}
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		f.t.Errorf("multipart: %v", err)
	}
	f.entries = nil
	if err := json.Unmarshal([]byte(r.FormValue("entries")), &f.entries); err != nil {
		f.t.Errorf("entries is not JSON: %v", err)
	}
	f.text = r.FormValue("text")
	f.image = nil
	if file, _, err := r.FormFile("image"); err == nil {
		f.image, _ = io.ReadAll(file)
	}
	if f.status != 0 {
		w.WriteHeader(f.status)
		_, _ = io.WriteString(w, `{"detail":"boom"}`)
		return
	}
	out := map[string]any{}
	if f.image != nil {
		out["imageHeight"], out["imageWidth"] = 10, 20
	}
	if _, ok := f.entries["ocr"]; ok {
		out["ocr"] = map[string]any{
			"text": []string{"Привет, мир", "hello"}, "box": []float64{0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1},
			"boxScore": []float64{0.9, 0.8}, "textScore": []float64{0.95, 0.9},
		}
	}
	if _, ok := f.entries["clip"]; ok {
		out["clip"] = "[0.25,-0.5,1]" // Immich sends the embedding as a string
	}
	_ = json.NewEncoder(w).Encode(out)
}

func newFake(t *testing.T) (*fakeML, *Client) {
	f := &fakeML{t: t}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, New(Options{URL: srv.URL + "/", OCRModel: "ESLAV__PP-OCRv5_mobile", CLIPModel: "XLM-Roberta-Large-Vit-B-16Plus"})
}

func path(m map[string]any, keys ...string) any {
	var cur any = m
	for _, k := range keys {
		mm, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = mm[k]
	}
	return cur
}

func TestImageSendsOCRAndCLIPInOneRequest(t *testing.T) {
	f, c := newFake(t)
	res, err := c.Image(context.Background(), []byte("jpeg-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if string(f.image) != "jpeg-bytes" {
		t.Fatalf("image = %q", f.image)
	}
	if got := path(f.entries, "clip", "visual", "modelName"); got != "XLM-Roberta-Large-Vit-B-16Plus" {
		t.Fatalf("clip visual model = %v (entries %v)", got, f.entries)
	}
	if path(f.entries, "ocr", "detection", "modelName") != "ESLAV__PP-OCRv5_mobile" ||
		path(f.entries, "ocr", "recognition", "modelName") != "ESLAV__PP-OCRv5_mobile" {
		t.Fatalf("ocr entries = %v", f.entries["ocr"])
	}
	if path(f.entries, "ocr", "detection", "options", "maxResolution") != float64(736) ||
		path(f.entries, "ocr", "detection", "options", "minScore") != 0.5 ||
		path(f.entries, "ocr", "recognition", "options", "minScore") != 0.8 {
		t.Fatalf("ocr options = %v", f.entries["ocr"])
	}
	if len(res.Lines) != 2 || res.Lines[0] != "Привет, мир" {
		t.Fatalf("lines = %v", res.Lines)
	}
	if len(res.Vector) != 3 || res.Vector[0] != 0.25 || res.Vector[1] != -0.5 {
		t.Fatalf("vector = %v", res.Vector)
	}
}

func TestImageWithOnlyOCR(t *testing.T) {
	f, c := newFake(t)
	c.opts.CLIPModel = ""
	res, err := c.Image(context.Background(), []byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := f.entries["clip"]; ok || res.Vector != nil || len(res.Lines) != 2 {
		t.Fatalf("entries = %v, result = %+v", f.entries, res)
	}
}

func TestEmbedTextSendsTextField(t *testing.T) {
	f, c := newFake(t)
	v, err := c.EmbedText(context.Background(), "кот на диване")
	if err != nil {
		t.Fatal(err)
	}
	if f.text != "кот на диване" || f.image != nil {
		t.Fatalf("text = %q, image = %q", f.text, f.image)
	}
	if path(f.entries, "clip", "textual", "modelName") != "XLM-Roberta-Large-Vit-B-16Plus" {
		t.Fatalf("entries = %v", f.entries)
	}
	if len(v) != 3 {
		t.Fatalf("vector = %v", v)
	}
}

func TestParseEmbeddingAcceptsStringAndArray(t *testing.T) {
	for _, raw := range []string{`"[1,2]"`, `[1,2]`} {
		v, err := parseEmbedding(json.RawMessage(raw))
		if err != nil || len(v) != 2 || v[1] != 2 {
			t.Fatalf("%s: %v %v", raw, v, err)
		}
	}
	for _, raw := range []string{``, `null`, `"[]"`, `"nope"`} {
		if _, err := parseEmbedding(json.RawMessage(raw)); err == nil {
			t.Fatalf("%q: want an error", raw)
		}
	}
}

func TestErrorsSeparateOutagesFromBadInput(t *testing.T) {
	f, c := newFake(t)
	ex := NewExtractor(c)

	f.status = http.StatusInternalServerError // e.g. a model still loading
	if _, err := ex.Extract(context.Background(), []byte("x")); !errors.Is(err, chatmedia.ErrExtractorUnavailable) {
		t.Fatalf("5xx: err = %v, want ErrExtractorUnavailable", err)
	}

	f.status = http.StatusBadRequest // the image itself is bad
	_, err := ex.Extract(context.Background(), []byte("x"))
	if err == nil || errors.Is(err, chatmedia.ErrExtractorUnavailable) {
		t.Fatalf("4xx: err = %v, want a plain error", err)
	}

	down := New(Options{URL: "http://127.0.0.1:1", OCRModel: "m"})
	if _, err := NewExtractor(down).Extract(context.Background(), []byte("x")); !errors.Is(err, chatmedia.ErrExtractorUnavailable) {
		t.Fatalf("connection refused: err = %v", err)
	}
	if err := down.Ping(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("ping: %v", err)
	}
	if err := c.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

func TestSignatureNamesModels(t *testing.T) {
	_, c := newFake(t)
	a := NewExtractor(c).Signature()
	c.opts.CLIPModel = "ViT-B-32__openai"
	if b := NewExtractor(c).Signature(); a == b {
		t.Fatalf("signature %q did not change with the CLIP model", a)
	}
}
