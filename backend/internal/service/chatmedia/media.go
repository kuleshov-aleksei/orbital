// Package chatmedia stores text channel attachments: files in S3 (Garage),
// bookkeeping in SQLite (chat_attachments). It enforces the per-user quota,
// auto-removes the oldest unprotected files and purges removed objects in
// the background (docs/specs/CHAT_SYSTEM.md §7.12).
package chatmedia

import (
	"context"
	"errors"
	"io"
	"sort"
	"sync"
	"time"
)

// MediaStore is the object storage. The production implementation is S3;
// MemoryStore backs tests.
type MediaStore interface {
	Put(ctx context.Context, key string, body io.ReadSeeker, size int64, contentType string) error
	// Get reads a whole object (content extraction reads stored images).
	Get(ctx context.Context, key string) ([]byte, error)
	// Delete removes objects; missing keys are not an error.
	Delete(ctx context.Context, keys []string) error
	// PresignGet returns a time-limited GET URL. disposition, when set, is
	// returned as the Content-Disposition response header.
	PresignGet(ctx context.Context, key string, ttl time.Duration, disposition string) (string, error)
}

// MemoryStore is an in-memory MediaStore for tests. FailPut / FailDelete
// make the next calls fail.
type MemoryStore struct {
	mu         sync.Mutex
	objects    map[string][]byte
	types      map[string]string
	FailPut    error
	FailDelete error
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{objects: map[string][]byte{}, types: map[string]string{}}
}

func (m *MemoryStore) Put(_ context.Context, key string, body io.ReadSeeker, _ int64, contentType string) error {
	m.mu.Lock()
	fail := m.FailPut
	m.mu.Unlock()
	if fail != nil {
		return fail
	}
	data, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[key] = data
	m.types[key] = contentType
	return nil
}

func (m *MemoryStore) Get(_ context.Context, key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.objects[key]
	if !ok {
		return nil, errors.New("memory store: no such key " + key)
	}
	return append([]byte(nil), data...), nil
}

func (m *MemoryStore) Delete(_ context.Context, keys []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailDelete != nil {
		return m.FailDelete
	}
	for _, k := range keys {
		delete(m.objects, k)
		delete(m.types, k)
	}
	return nil
}

func (m *MemoryStore) PresignGet(_ context.Context, key string, _ time.Duration, disposition string) (string, error) {
	u := "memory://" + key
	if disposition != "" {
		u += "?download=1"
	}
	return u, nil
}

// Keys lists the stored object keys, sorted.
func (m *MemoryStore) Keys() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.objects))
	for k := range m.objects {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// SetFailDelete toggles delete failures.
func (m *MemoryStore) SetFailDelete(err error) {
	m.mu.Lock()
	m.FailDelete = err
	m.mu.Unlock()
}
