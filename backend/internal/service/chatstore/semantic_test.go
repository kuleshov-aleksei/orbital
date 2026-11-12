package chatstore

import (
	"context"
	"errors"
	"math"
	"sync/atomic"
	"testing"
)

const (
	semRoom   = "20261110145113MiTbtB"
	semSender = "qkUrdzLDoqslx8EEy2cM7Q=="
)

func imageMessage(t *testing.T, s *Service, content string) *Message {
	t.Helper()
	m, err := s.Create(context.Background(), CreateInput{
		RoomID: semRoom, SenderID: semSender, Content: content,
		Attachments: []Attachment{{ID: "0f6c2b8e9d1a4c3b8e7f6a5d4c3b2a19", Kind: "image", Mime: "image/png", Size: 10, Filename: "shot.png"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestSetAttachmentContentStoresTextAndCreatesEmbedder(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	m := imageMessage(t, s, "")

	if err := s.SetAttachmentContent(ctx, m.ID, "Счёт №42", [][]float32{{1, 0, 0}, {0, 1, 0}}, true); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, m.ID)
	if err != nil || got.AttachmentText != "Счёт №42" {
		t.Fatalf("attachment_text = %q (%v)", got.AttachmentText, err)
	}
	if dims, _ := eng.ImageEmbedderDims(ctx); dims != 3 {
		t.Fatalf("embedder dims = %d, want 3", dims)
	}

	// Deleted messages are left alone.
	if _, err := s.Delete(ctx, m.ID, semSender, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.SetAttachmentContent(ctx, m.ID, "x", nil, true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted message: err = %v, want ErrNotFound", err)
	}
}

func TestSearchEmbedsQueryOnlyWhenUseful(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	mustCreate(t, s, semRoom, semSender, "отчёт за ноябрь")
	var calls atomic.Int32
	s.SetQueryEmbedder(func(context.Context, string) ([]float32, error) {
		calls.Add(1)
		return []float32{1, 0, 0}, nil
	}, 0)

	search := func(req SearchRequest) {
		t.Helper()
		req.RoomIDs = []string{semRoom}
		res, err := s.Search(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		if req.Text == "отчёт" && len(res.Hits) != 1 {
			t.Fatalf("hits = %d, want 1", len(res.Hits))
		}
	}

	// No embedder in the index yet: no query embedding.
	search(SearchRequest{Text: "отчёт"})
	if calls.Load() != 0 {
		t.Fatalf("embedded %d times without an embedder", calls.Load())
	}

	_ = eng.SetImageEmbedder(ctx, 3)
	s.sem.mu.Lock()
	s.sem.checkedAt = s.sem.checkedAt.AddDate(0, 0, -1) // expire the cached "no embedder"
	s.sem.mu.Unlock()
	search(SearchRequest{Text: "отчёт"})
	if calls.Load() != 1 {
		t.Fatalf("embed calls = %d, want 1", calls.Load())
	}
	// Filters only, or newest-first order: keyword search as before.
	search(SearchRequest{})
	search(SearchRequest{Text: "отчёт", SortNewest: true})
	if calls.Load() != 1 {
		t.Fatalf("embed calls = %d, want still 1", calls.Load())
	}
}

func TestSearchSurvivesEmbeddingFailure(t *testing.T) {
	s, eng, _ := newTestService(t)
	ctx := context.Background()
	_ = eng.SetImageEmbedder(ctx, 3)
	mustCreate(t, s, semRoom, semSender, "отчёт за ноябрь")
	for _, fn := range []QueryEmbedder{
		func(context.Context, string) ([]float32, error) { return nil, errors.New("immich ml unavailable") },
		func(context.Context, string) ([]float32, error) { return []float32{1, 2}, nil }, // wrong size
	} {
		s.SetQueryEmbedder(fn, 0)
		res, err := s.Search(ctx, SearchRequest{Text: "отчёт", RoomIDs: []string{semRoom}})
		if err != nil || len(res.Hits) != 1 {
			t.Fatalf("search = %v, %v; want the keyword hit", res, err)
		}
	}
}

func TestMatchImageScoresLikeSearch(t *testing.T) {
	s, _, _ := newTestService(t)
	ctx := context.Background()
	if _, err := s.MatchImage(ctx, "кот", []float32{1, 0}); !errors.Is(err, ErrSemanticDisabled) {
		t.Fatalf("without embedder: err = %v, want ErrSemanticDisabled", err)
	}
	s.SetQueryEmbedder(func(context.Context, string) ([]float32, error) {
		return []float32{0.6, 0.8}, nil
	}, 0.7)
	m, err := s.MatchImage(ctx, "кот", []float32{2, 0}) // not normalized
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(m.Cosine-0.6) > 1e-6 || math.Abs(m.Score-0.8) > 1e-6 || m.Threshold != 0.7 {
		t.Fatalf("match = %+v, want cosine 0.6, score 0.8, threshold 0.7", m)
	}
	if _, err := s.MatchImage(ctx, "кот", []float32{1, 0, 0}); err == nil {
		t.Fatal("size mismatch: want an error")
	}
}
