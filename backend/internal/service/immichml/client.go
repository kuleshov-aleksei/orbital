// Package immichml talks to an Immich machine-learning service
// (ghcr.io/immich-app/immich-machine-learning) for OCR and CLIP embeddings
// of text channel images (docs/specs/CHAT_SYSTEM.md §7.13).
//
// The API is Immich's internal one and has no versioned docs; the shapes
// below come from immich_ml/main.py, schemas.py and the Immich server's
// machine-learning.repository.ts. client_test.go pins them. Pin the image
// tag and re-run the integration test before upgrading Immich.
package immichml

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// ErrUnavailable marks failures that say nothing about the input: the
// service is down, timed out or failed internally (5xx, e.g. a model that
// is still downloading).
var ErrUnavailable = errors.New("immich ml unavailable")

// Options configure the client. Empty model names disable that task.
type Options struct {
	URL       string
	CLIPModel string
	OCRModel  string
	// OCR thresholds (Immich defaults: detection 0.5, recognition 0.8,
	// detection input 736 px).
	OCRMinDetectionScore   float64
	OCRMinRecognitionScore float64
	OCRMaxResolution       int
	Timeout                time.Duration
}

// Client calls POST /predict.
type Client struct {
	opts Options
	hc   *http.Client
}

// New creates a client.
func New(opts Options) *Client {
	if opts.OCRMinDetectionScore <= 0 {
		opts.OCRMinDetectionScore = 0.5
	}
	if opts.OCRMinRecognitionScore <= 0 {
		opts.OCRMinRecognitionScore = 0.8
	}
	if opts.OCRMaxResolution <= 0 {
		opts.OCRMaxResolution = 736
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 2 * time.Minute
	}
	opts.URL = strings.TrimSuffix(opts.URL, "/")
	return &Client{opts: opts, hc: &http.Client{Timeout: opts.Timeout}}
}

// OCREnabled and CLIPEnabled report the configured tasks.
func (c *Client) OCREnabled() bool  { return c.opts.OCRModel != "" }
func (c *Client) CLIPEnabled() bool { return c.opts.CLIPModel != "" }

// ImageResult is what one image yields.
type ImageResult struct {
	// Lines are the recognized text lines (nil without OCR).
	Lines []string
	// Vector is the CLIP image embedding (nil without CLIP).
	Vector []float32
}

// Image runs the enabled tasks on one image in a single request.
func (c *Client) Image(ctx context.Context, image []byte) (ImageResult, error) {
	entries := map[string]any{}
	if c.OCREnabled() {
		entries["ocr"] = map[string]any{
			"detection": map[string]any{"modelName": c.opts.OCRModel, "options": map[string]any{
				"minScore": c.opts.OCRMinDetectionScore, "maxResolution": c.opts.OCRMaxResolution,
			}},
			"recognition": map[string]any{"modelName": c.opts.OCRModel, "options": map[string]any{
				"minScore": c.opts.OCRMinRecognitionScore,
			}},
		}
	}
	if c.CLIPEnabled() {
		entries["clip"] = map[string]any{"visual": map[string]any{"modelName": c.opts.CLIPModel}}
	}
	if len(entries) == 0 {
		return ImageResult{}, nil
	}
	var resp struct {
		OCR *struct {
			Text []string `json:"text"`
		} `json:"ocr"`
		CLIP json.RawMessage `json:"clip"`
	}
	if err := c.predict(ctx, entries, image, "", &resp); err != nil {
		return ImageResult{}, err
	}
	var out ImageResult
	if resp.OCR != nil {
		out.Lines = resp.OCR.Text
	}
	if c.CLIPEnabled() {
		v, err := parseEmbedding(resp.CLIP)
		if err != nil {
			return ImageResult{}, err
		}
		out.Vector = v
	}
	return out, nil
}

// EmbedText embeds search text with the CLIP text encoder.
func (c *Client) EmbedText(ctx context.Context, text string) ([]float32, error) {
	if !c.CLIPEnabled() {
		return nil, errors.New("immich ml: CLIP is disabled")
	}
	entries := map[string]any{"clip": map[string]any{"textual": map[string]any{"modelName": c.opts.CLIPModel}}}
	var resp struct {
		CLIP json.RawMessage `json:"clip"`
	}
	if err := c.predict(ctx, entries, nil, text, &resp); err != nil {
		return nil, err
	}
	return parseEmbedding(resp.CLIP)
}

// Ping checks that the service answers.
func (c *Client) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.opts.URL+"/ping", nil)
	if err != nil {
		return err
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return errors.Join(ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: ping returned %d", ErrUnavailable, resp.StatusCode)
	}
	return nil
}

// predict posts multipart entries + image (or text) to /predict.
func (c *Client) predict(ctx context.Context, entries map[string]any, image []byte, text string, out any) error {
	ej, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := w.WriteField("entries", string(ej)); err != nil {
		return err
	}
	if image != nil {
		fw, err := w.CreateFormFile("image", "image.jpg")
		if err != nil {
			return err
		}
		if _, err := fw.Write(image); err != nil {
			return err
		}
	} else if err := w.WriteField("text", text); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.opts.URL+"/predict", &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := c.hc.Do(req)
	if err != nil {
		return errors.Join(ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return errors.Join(ErrUnavailable, err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("%w: predict returned %d: %s", ErrUnavailable, resp.StatusCode, snippet(data))
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("immich ml: predict returned %d: %s", resp.StatusCode, snippet(data))
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("immich ml: bad predict response: %w", err)
	}
	return nil
}

// parseEmbedding reads a CLIP embedding. Immich sends it as a string that
// holds a JSON array ("[0.1,...]"); a plain array is accepted too.
func parseEmbedding(raw json.RawMessage) ([]float32, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errors.New("immich ml: response has no clip embedding")
	}
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, fmt.Errorf("immich ml: bad clip embedding: %w", err)
		}
		raw = json.RawMessage(s)
	}
	var v []float32
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("immich ml: bad clip embedding: %w", err)
	}
	if len(v) == 0 {
		return nil, errors.New("immich ml: empty clip embedding")
	}
	return v, nil
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}
