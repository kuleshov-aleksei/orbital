package chatstore

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"sync"
	"time"
)

// ImageEmbedder is the userProvided Meilisearch embedder that holds image
// embeddings (docs/specs/CHAT_SYSTEM.md §7.13).
const ImageEmbedder = "image"

const (
	// queryEmbedTimeout bounds embedding the search text; on timeout the
	// search runs keyword-only.
	queryEmbedTimeout = 2 * time.Second
	// DefaultSemanticThreshold is the minimum ranking score of an image found
	// only by its embedding.
	DefaultSemanticThreshold = 0.6
	// embedderRecheck is how long an unknown embedder state is cached.
	embedderRecheck = time.Minute
)

// QueryEmbedder embeds search text in the image embedding space.
type QueryEmbedder func(ctx context.Context, text string) ([]float32, error)

// semantic holds the image search state; zero value = disabled.
type semantic struct {
	mu        sync.Mutex
	embed     QueryEmbedder
	threshold float64
	// dims is the configured embedder's size (0 = unknown or none);
	// checkedAt is when an unknown state was last read from the engine.
	dims      int
	checkedAt time.Time
}

// SetQueryEmbedder enables image search by meaning: search text is embedded
// and matched against image embeddings with a minimum ranking score.
func (s *Service) SetQueryEmbedder(fn QueryEmbedder, threshold float64) {
	if threshold <= 0 || threshold >= 1 {
		threshold = DefaultSemanticThreshold
	}
	s.sem.mu.Lock()
	s.sem.embed, s.sem.threshold = fn, threshold
	s.sem.mu.Unlock()
}

// embedderDims returns the image embedder size, reading it from the engine
// at most once a minute while unknown.
func (s *Service) embedderDims(ctx context.Context) int {
	s.sem.mu.Lock()
	defer s.sem.mu.Unlock()
	if s.sem.dims > 0 || time.Since(s.sem.checkedAt) < embedderRecheck {
		return s.sem.dims
	}
	s.sem.checkedAt = time.Now()
	dims, err := s.eng.ImageEmbedderDims(ctx)
	if err != nil {
		log.Printf("[TextChat] Failed to read the image embedder: %v", err)
		return 0
	}
	s.sem.dims = dims
	return dims
}

// ensureEmbedder makes the image embedder match dims (creating it, or
// replacing it after a model change, which drops the old vectors).
func (s *Service) ensureEmbedder(ctx context.Context, dims int) error {
	s.sem.mu.Lock()
	defer s.sem.mu.Unlock()
	if s.sem.dims == dims {
		return nil
	}
	cur, err := s.eng.ImageEmbedderDims(ctx)
	if err != nil {
		return err
	}
	if cur != dims {
		log.Printf("[TextChat] Setting the image embedder to %d dimensions (was %d)", dims, cur)
		if err := s.eng.SetImageEmbedder(ctx, dims); err != nil {
			return err
		}
	}
	s.sem.dims = dims
	return nil
}

// ErrSemanticDisabled: image search by meaning is not configured.
var ErrSemanticDisabled = errors.New("image search by meaning is disabled")

// ImageMatch is how well a search text matches one image embedding.
type ImageMatch struct {
	// Cosine is the similarity of the text and image embeddings.
	Cosine float64
	// Score approximates the Meilisearch ranking score ((1+cosine)/2);
	// search shows the image when it reaches Threshold.
	Score     float64
	Threshold float64
}

// MatchImage embeds text like a search query and compares it to an image
// embedding, to show why an image is (not) found for that text.
func (s *Service) MatchImage(ctx context.Context, text string, image []float32) (ImageMatch, error) {
	s.sem.mu.Lock()
	embed, threshold := s.sem.embed, s.sem.threshold
	s.sem.mu.Unlock()
	if embed == nil {
		return ImageMatch{}, ErrSemanticDisabled
	}
	// Longer than a search: this is a diagnostic and may load the model.
	ectx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	vec, err := embed(ectx, text)
	if err != nil {
		return ImageMatch{}, err
	}
	if len(vec) != len(image) || len(vec) == 0 {
		return ImageMatch{}, fmt.Errorf("query vector has %d dimensions, image %d", len(vec), len(image))
	}
	var dot, na, nb float64
	for i := range vec {
		a, b := float64(vec[i]), float64(image[i])
		dot, na, nb = dot+a*b, na+a*a, nb+b*b
	}
	if na == 0 || nb == 0 {
		return ImageMatch{Threshold: threshold, Score: 0.5}, nil
	}
	c := dot / (math.Sqrt(na) * math.Sqrt(nb))
	return ImageMatch{Cosine: c, Score: (1 + c) / 2, Threshold: threshold}, nil
}

// queryVector embeds the search text for image search, or returns nil
// (disabled, no text, newest-first order, embedder missing or failing).
func (s *Service) queryVector(ctx context.Context, req SearchRequest) ([]float32, float64) {
	s.sem.mu.Lock()
	embed, threshold := s.sem.embed, s.sem.threshold
	s.sem.mu.Unlock()
	if embed == nil || req.Text == "" || req.SortNewest {
		return nil, 0
	}
	dims := s.embedderDims(ctx)
	if dims == 0 {
		return nil, 0
	}
	ectx, cancel := context.WithTimeout(ctx, queryEmbedTimeout)
	defer cancel()
	vec, err := embed(ectx, req.Text)
	if err != nil {
		log.Printf("[TextChat] Image search skipped, embedding the query failed: %v", err)
		return nil, 0
	}
	if len(vec) != dims {
		log.Printf("[TextChat] Image search skipped: query vector has %d dimensions, embedder %d", len(vec), dims)
		return nil, 0
	}
	return vec, threshold
}

// SetAttachmentContent stores the extracted content of a message's files:
// OCR text (searchable as attachment_text) and image embeddings. With
// withVectors false the embeddings are left alone. Deleted or missing
// messages return ErrNotFound.
func (s *Service) SetAttachmentContent(ctx context.Context, messageID, text string, vectors [][]float32, withVectors bool) error {
	if withVectors && len(vectors) == 0 && s.embedderDims(ctx) == 0 {
		withVectors = false // nothing to clear without an embedder
	}
	if withVectors && len(vectors) > 0 {
		if err := s.ensureEmbedder(ctx, len(vectors[0])); err != nil {
			return err
		}
		dims := len(vectors[0])
		kept := vectors[:0:0]
		for _, v := range vectors {
			if len(v) == dims { // a model change mid-message: drop the odd ones
				kept = append(kept, v)
			}
		}
		vectors = kept
	}
	_, err := s.mutate(ctx, messageID, func(m *Message) (map[string]any, error) {
		fields := map[string]any{}
		if m.AttachmentText != text {
			m.AttachmentText = text
			fields["attachment_text"] = text
		}
		if withVectors {
			// Plain null clears (opts out); {embeddings: null} would keep them.
			var v any
			if len(vectors) > 0 {
				v = map[string]any{"embeddings": vectors, "regenerate": false}
			}
			fields["_vectors"] = map[string]any{ImageEmbedder: v}
		}
		return fields, nil
	})
	return err
}
