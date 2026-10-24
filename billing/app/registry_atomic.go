package app

import (
	"context"
	"log/slog"
	"reflect"
	"sort"
	"sync"
	"time"
)

// AtomicRegistry is the BC-5 hot-reload ChannelSet: channels are rebuilt from
// a settings source (billing_channel.<name>.* rows) on a poll and the active
// set is swapped behind a single pointer — readers (BillingService, /config,
// admin cards) never see a half-built registry and no restart is needed after
// an admin saves credentials.
//
// Build rules:
//   - source error → keep the previous set + log.Warn (a flaky DB read must
//     not take checkout down; the next tick retries); at BOOT the previous
//     set does not exist yet, so the factories run once over an EMPTY fields
//     map — env-only channels still register, only DB-configured ones wait
//     for the poll to heal them (fix #5),
//   - factory returning (nil, nil) → the channel is simply not registered
//     this round (credentials incomplete = unconfigured),
//   - factory error → that channel is skipped this round + log.Warn (a bad
//     pasted key disables the channel, not the whole registry).
//
// Get/OrderedNames semantics match ChannelRegistry (capability-declared
// DisplayOrder, DefaultChannelDisplayOrder fallback).
type AtomicRegistry struct {
	log       *slog.Logger
	source    func(ctx context.Context) (map[string]map[string]string, error)
	factories map[string]func(fields map[string]string) (PaymentChannel, error)

	mu       sync.RWMutex
	channels map[string]PaymentChannel
	names    []string // precomputed OrderedNames of the current set
}

var _ ChannelSet = (*AtomicRegistry)(nil)

// NewAtomicRegistry builds the first channel set synchronously and keeps
// rebuilding every pollEvery until ctx is done. pollEvery <= 0 defaults to
// 30s. A failing initial source no longer starts the process with ZERO
// channels (billing fix #5): the factories are run once with an empty fields
// map — env-only channels (manual, env-configured stripe) register as usual,
// only DB-configured channels wait for the poll to heal them.
func NewAtomicRegistry(ctx context.Context, log *slog.Logger,
	source func(ctx context.Context) (map[string]map[string]string, error),
	factories map[string]func(fields map[string]string) (PaymentChannel, error),
	pollEvery time.Duration) *AtomicRegistry {
	if log == nil {
		log = slog.Default()
	}
	if pollEvery <= 0 {
		pollEvery = 30 * time.Second
	}
	r := &AtomicRegistry{log: log, source: source, factories: factories, channels: map[string]PaymentChannel{}}
	if err := r.RefreshNow(ctx); err != nil {
		r.log.Error("channel registry initial build failed, booting with env-only channels (DB-configured channels heal on the next poll)", "err", err)
		r.rebuild(map[string]map[string]string{})
	}
	go func() {
		t := time.NewTicker(pollEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := r.RefreshNow(ctx); err != nil {
					r.log.Warn("channel registry rebuild failed, keeping previous set", "err", err)
				}
			}
		}
	}()
	return r
}

// RefreshNow rebuilds the channel set from the source and swaps the pointer
// synchronously; the admin PUT path calls it right after saving credentials
// so the response card reflects the new effective state (config flips from
// env to db within the same request). Returns the source error, if any — the
// previous set is kept on failure.
func (r *AtomicRegistry) RefreshNow(ctx context.Context) error {
	fields, err := r.source(ctx)
	if err != nil {
		return err
	}
	r.rebuild(fields)
	return nil
}

// rebuild runs every factory over the given fields snapshot and swaps the
// active set atomically.
func (r *AtomicRegistry) rebuild(fields map[string]map[string]string) {
	channels := make(map[string]PaymentChannel, len(r.factories))
	for name, factory := range r.factories {
		ch, err := factory(fields[name])
		if err != nil {
			r.log.Warn("channel factory failed, channel not registered this round",
				"channel", name, "err", err)
			continue
		}
		// typed-nil 防御:工厂签名是 (PaymentChannel, error),但适配器的
		// NewFromFields 旧签名返回 (*Channel, error)——`return nil, err` 直返
		// 会把「具体类型 nil 指针」包成非 nil 接口,幽灵渠道就此混进注册表
		// (Name() 能调、第一次真用才 panic)。接口 nil 与反射判定的 typed-nil
		// 在这里一并拦下,点名修复方向。
		if ch == nil || isTypedNilChannel(ch) {
			r.log.Warn("channel factory returned typed-nil interface, skipped (return app.PaymentChannel nil explicitly, or an app.DisabledChannel stub)",
				"channel", name)
			continue // unconfigured
		}
		if ch.Name() != name {
			r.log.Warn("channel factory name mismatch, skipping",
				"factory", name, "channel_name", ch.Name())
			continue
		}
		channels[name] = ch
	}
	names := orderedNamesOf(channels)
	r.mu.Lock()
	r.channels, r.names = channels, names
	r.mu.Unlock()
}

func (r *AtomicRegistry) Get(name string) (PaymentChannel, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ch, ok := r.channels[name]
	return ch, ok
}

func (r *AtomicRegistry) OrderedNames() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]string(nil), r.names...)
}

// OrderedChannels returns every registered channel (disabled stubs included)
// in (DisplayOrder asc, name asc) order — the admin channel-cards page
// enumerates this so unconfigured channels stay visible and editable.
func (r *AtomicRegistry) OrderedChannels() []PaymentChannel {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return orderedChannelsOf(r.channels)
}

// isTypedNilChannel reports whether ch is a non-nil interface wrapping a nil
// pointer (the typed-nil trap).
func isTypedNilChannel(ch PaymentChannel) bool {
	rv := reflect.ValueOf(ch)
	return rv.Kind() == reflect.Pointer && rv.IsNil()
}

// channelEntry is one sortable registry slot.
type channelEntry struct {
	name  string
	ch    PaymentChannel
	order int
}

// sortedChannelEntries returns every entry of the map ordered by
// (DisplayOrder asc, name asc). DisplayOrder == 0 (an unset caps field —
// Go's zero value) is treated as DefaultChannelDisplayOrder (billing fix
// #13): a channel that forgot to set the field used to jump the queue above
// stripe (200).
func sortedChannelEntries(channels map[string]PaymentChannel) []channelEntry {
	entries := make([]channelEntry, 0, len(channels))
	for name, ch := range channels {
		order := DefaultChannelDisplayOrder
		if viewer, ok := ch.(ChannelCapabilityViewer); ok {
			order = viewer.Capabilities().DisplayOrder
			if order == 0 {
				order = DefaultChannelDisplayOrder
			}
		}
		entries = append(entries, channelEntry{name: name, ch: ch, order: order})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].order != entries[j].order {
			return entries[i].order < entries[j].order
		}
		return entries[i].name < entries[j].name
	})
	return entries
}

// orderedNamesOf is the ChannelRegistry.OrderedNames ordering (DisplayOrder
// asc, name asc) computed over an arbitrary channel map, EXCLUDING disabled
// channels (ChannelConfigViewer reporting !Configured — the
// *DisabledChannel stub factories return when credentials are absent): the
// active set feeds /config, checkout and BillingConfig, where an
// unconfigured channel must not appear (a stub's CreateCheckout can never
// succeed). Channels without ChannelConfigViewer are kept — a channel that
// does not report its config state is assumed live (existing behavior).
func orderedNamesOf(channels map[string]PaymentChannel) []string {
	entries := sortedChannelEntries(channels)
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if viewer, ok := e.ch.(ChannelConfigViewer); ok && !viewer.ChannelConfig().Configured {
			continue
		}
		names = append(names, e.name)
	}
	return names
}

// orderedChannelsOf is orderedNamesOf's full enumeration: every registered
// channel including disabled stubs, same (DisplayOrder asc, name asc) order —
// the admin billing-channels page lists stubs so an operator can paste
// credentials without env bootstrapping.
func orderedChannelsOf(channels map[string]PaymentChannel) []PaymentChannel {
	entries := sortedChannelEntries(channels)
	out := make([]PaymentChannel, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.ch)
	}
	return out
}
