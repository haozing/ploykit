package relayx

import (
	"context"
	"sync"
)

const memQueue = 128

type MemoryTransport struct {
	mu   sync.Mutex
	subs []chan []byte
}

func NewMemoryTransport() *MemoryTransport { return &MemoryTransport{} }

func (m *MemoryTransport) Publish(_ context.Context, payload []byte) error {

	m.mu.Lock()
	subs := make([]chan []byte, len(m.subs))
	copy(subs, m.subs)
	m.mu.Unlock()

	for _, ch := range subs {

		buf := make([]byte, len(payload))
		copy(buf, payload)
		select {
		case ch <- buf:
		default:
		}
	}
	return nil
}

func (m *MemoryTransport) Subscribe(ctx context.Context, fn func(payload []byte)) error {
	ch := make(chan []byte, memQueue)
	m.attach(ch)
	defer m.detach(ch)

	for {
		select {
		case <-ctx.Done():
			return nil
		case payload := <-ch:
			fn(payload)
		}
	}
}

func (m *MemoryTransport) attach(ch chan []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.subs = append(m.subs, ch)
}

func (m *MemoryTransport) detach(ch chan []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, s := range m.subs {
		if s == ch {
			m.subs = append(m.subs[:i], m.subs[i+1:]...)
			return
		}
	}
}
