package pg

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/haozing/ploykit/internal/contract/apierr"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type txKey struct{}

type Options struct {
	StartupTimeout time.Duration

	ConnectTimeout time.Duration

	ReplicaDSN string

	MaxConns int32
	MinConns int32

	MaxConnLifetime  time.Duration
	MaxConnIdleTime  time.Duration
	HealthCheckEvery time.Duration

	SelfHeal *bool

	ExitOnWedge bool
}

const (
	defaultMaxConnLifetime  = 30 * time.Minute
	defaultMaxConnIdleTime  = 5 * time.Minute
	defaultHealthCheckEvery = 30 * time.Second
)

type DB struct {
	primary *pgxpool.Pool

	replica atomic.Pointer[pgxpool.Pool]

	breaker breaker

	replicaDial func(ctx context.Context, dsn string, opt Options) (*pgxpool.Pool, error)

	replicaRetryStop     chan struct{}
	replicaRetryStopOnce sync.Once
}

type breaker struct {
	openFor time.Duration
	now     func() time.Time

	mu        sync.Mutex
	openUntil time.Time

	probing atomic.Bool
}

func (b *breaker) Allow() bool {
	b.mu.Lock()
	open, now := b.openUntil, b.now()
	b.mu.Unlock()
	if now.Before(open) {
		return false
	}
	if open.IsZero() {
		return true
	}
	return b.probing.CompareAndSwap(false, true)
}

func (b *breaker) OnSuccess() {
	b.mu.Lock()
	b.openUntil = time.Time{}
	b.mu.Unlock()
	b.probing.Store(false)
}

func (b *breaker) Trip() {
	b.mu.Lock()
	b.openUntil = b.now().Add(b.openFor)
	b.mu.Unlock()
	b.probing.Store(false)
}

func (b *breaker) release() { b.probing.Store(false) }

func Connect(ctx context.Context, dsn string, opt Options) (*DB, error) {
	if opt.StartupTimeout <= 0 {
		opt.StartupTimeout = 3 * time.Minute
	}
	if opt.ConnectTimeout <= 0 {
		opt.ConnectTimeout = 5 * time.Second
	}

	primary, err := dialWithRetry(ctx, dsn, opt)
	if err != nil {
		return nil, fmt.Errorf("pg: connect primary: %w", err)
	}
	db := &DB{primary: primary, breaker: newBreaker()}
	startPoolWatchdog(primary, opt)
	if opt.ReplicaDSN != "" {
		if rp, err := dialWithRetry(ctx, opt.ReplicaDSN, opt); err == nil {
			db.replica.Store(rp)

			startPoolWatchdog(rp, opt)
		} else {

			slog.Error("pg: replica connect failed, running primary-only", "err", err)
			startReplicaRetry(db, opt)
		}
	}
	return db, nil
}

var replicaRetryEvery = 30 * time.Second

func startReplicaRetry(d *DB, opt Options) {
	d.replicaRetryStop = make(chan struct{})
	dial := d.replicaDial
	if dial == nil {
		dial = func(_ context.Context, dsn string, opt Options) (*pgxpool.Pool, error) {

			ctx, cancel := context.WithTimeout(context.Background(), opt.ConnectTimeout)
			defer cancel()
			return dialOnce(ctx, dsn, opt)
		}
	}
	go func() {
		t := time.NewTicker(replicaRetryEvery)
		defer t.Stop()
		for {
			select {
			case <-d.replicaRetryStop:
				return
			case <-t.C:
			}
			rp, err := dial(context.Background(), opt.ReplicaDSN, opt)
			if err != nil {
				slog.Warn("pg: replica retry connect failed, still primary-only", "err", err)
				continue
			}

			select {
			case <-d.replicaRetryStop:
				rp.Close()
				return
			default:
			}
			d.replica.Store(rp)

			startPoolWatchdog(rp, opt)

			d.breaker.OnSuccess()
			slog.Info("pg: replica connected after retry, taking over read traffic")
			return
		}
	}()
}

func poolConfig(dsn string, opt Options) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("pg: parse dsn: %w", err)
	}
	cfg.ConnConfig.ConnectTimeout = opt.ConnectTimeout

	if opt.MaxConns > 0 {
		cfg.MaxConns = opt.MaxConns
	}
	if opt.MinConns > 0 {
		cfg.MinConns = opt.MinConns
	}
	if opt.MaxConnLifetime > 0 {
		cfg.MaxConnLifetime = opt.MaxConnLifetime
	} else {
		cfg.MaxConnLifetime = defaultMaxConnLifetime
	}
	if opt.MaxConnIdleTime > 0 {
		cfg.MaxConnIdleTime = opt.MaxConnIdleTime
	} else {
		cfg.MaxConnIdleTime = defaultMaxConnIdleTime
	}
	if opt.HealthCheckEvery > 0 {
		cfg.HealthCheckPeriod = opt.HealthCheckEvery
	} else {
		cfg.HealthCheckPeriod = defaultHealthCheckEvery
	}
	return cfg, nil
}

func dialOnce(ctx context.Context, dsn string, opt Options) (*pgxpool.Pool, error) {
	cfg, err := poolConfig(dsn, opt)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func dialWithRetry(ctx context.Context, dsn string, opt Options) (*pgxpool.Pool, error) {
	deadline := time.Now().Add(opt.StartupTimeout)
	delay := time.Second
	var pool *pgxpool.Pool
	var err error
	for attempt := 1; ; attempt++ {
		pool, err = dialOnce(ctx, dsn, opt)
		if err == nil {
			return pool, nil
		}
		if !isConnectTransient(err) {
			return nil, fmt.Errorf("pg: attempt %d: %w", attempt, err)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("pg: startup budget exhausted after %d attempts: %w", attempt, err)
		}
		sleep := jitter(delay)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(sleep):
		}
		if delay *= 2; delay > 30*time.Second {
			delay = 30 * time.Second
		}
	}
}

func isCallerCtxErr(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func isConnectTransient(err error) bool {
	if err == nil {
		return false
	}
	var connectErr *pgconn.ConnectError
	if errors.As(err, &connectErr) {
		return true
	}
	if isCallerCtxErr(err) {
		return false
	}
	var netErr net.Error
	return errors.As(err, &netErr)
}

func jitter(d time.Duration) time.Duration {
	return d + time.Duration(rand.Int63n(int64(d/2)+1))
}

func (d *DB) Ping(ctx context.Context) error { return d.primary.Ping(ctx) }

func (d *DB) Pool() *pgxpool.Pool { return d.primary }

func (d *DB) Reset() { d.primary.Reset() }

func startWatchdog(pool *pgxpool.Pool, exitOnWedge bool) {
	interval := pool.Config().HealthCheckPeriod
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}
	h := &wdHarness{
		probe: func() error { return probeDB(pool) },
		ping: func() error {
			pingCtx, pingCancel := probeCtx()
			defer pingCancel()
			return pool.Ping(pingCtx)
		},
		stat: func() wdStat {
			st := pool.Stat()
			return wdStat{acquired: st.AcquiredConns(), idle: st.IdleConns(), max: st.MaxConns(), emptyAcquires: st.EmptyAcquireCount()}
		},
		reset: pool.Reset,
		exit:  func() { os.Exit(1) },
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			h.tick(exitOnWedge)
		}
	}()
}

type wdStat struct {
	acquired, idle, max int32
	emptyAcquires       int64
}

func (s wdStat) saturated() bool { return s.max > 0 && s.idle == 0 && s.acquired >= s.max }

const wedgeThreshold = 3

type wdHarness struct {
	probe func() error
	ping  func() error
	stat  func() wdStat
	reset func()
	exit  func()

	wedges       int
	lastEmptyAcq int64
	exited       bool
}

func (h *wdHarness) tick(exitOnWedge bool) {
	if err := h.probe(); err != nil {
		slog.Error("pg: watchdog probe failed (db unreachable), resetting pool", "err", err)
		h.reset()
		h.wedges = 0
		h.rebase()
		return
	}
	if err := h.ping(); err != nil {
		cur := h.stat()
		if cur.saturated() && cur.emptyAcquires > h.lastEmptyAcq {

			slog.Warn("pg: pool saturated under load (acquired==max, conns still turning over); not treating as wedge",
				"acquired", cur.acquired, "idle", cur.idle, "max", cur.max, "emptyAcquires", cur.emptyAcquires)
			h.rebaseAt(cur)
			return
		}
		h.wedges++
		slog.Error("pg: pool wedged (acquired conns never returned); Reset cannot reclaim them",
			"wedges", h.wedges, "acquired", cur.acquired, "idle", cur.idle, "total", cur.acquired+cur.idle,
			"hint", "likely unclosed pgx Rows / unscanned Row in business code")
		h.reset()
		if exitOnWedge && h.wedges >= wedgeThreshold {
			slog.Error("pg: pool wedged persistently, exiting for supervisor restart")
			if !h.exited {
				h.exited = true
				h.exit()
			}
		}
		h.rebaseAt(cur)
		return
	}
	h.wedges = 0
	h.rebase()
}

func (h *wdHarness) rebase() { h.rebaseAt(h.stat()) }

func (h *wdHarness) rebaseAt(s wdStat) { h.lastEmptyAcq = s.emptyAcquires }

func probeCtx() (ctx context.Context, cancel context.CancelFunc) {
	return context.WithTimeout(context.Background(), 3*time.Second)
}

func probeDB(pool *pgxpool.Pool) error {
	ctx, cancel := probeCtx()
	defer cancel()
	conn, err := pgx.ConnectConfig(ctx, pool.Config().ConnConfig.Copy())
	if err != nil {
		return err
	}
	if err := conn.Ping(ctx); err != nil {
		_ = conn.Close(context.Background())
		return err
	}
	return conn.Close(context.Background())
}

var watchdogStart = startWatchdog

func startPoolWatchdog(pool *pgxpool.Pool, opt Options) {
	if opt.SelfHeal == nil || *opt.SelfHeal {
		watchdogStart(pool, opt.ExitOnWedge)
	}
}

func WrapPool(pool *pgxpool.Pool) *DB {
	return &DB{primary: pool, breaker: newBreaker()}
}

func newBreaker() breaker { return breaker{openFor: 2 * time.Second, now: time.Now} }

func (d *DB) Acquire(ctx context.Context) (*pgxpool.Conn, error) {
	return d.primary.Acquire(ctx)
}

func (d *DB) Close() {
	d.stopReplicaRetry()
	if rp := d.replica.Swap(nil); rp != nil {
		rp.Close()
	}
	d.primary.Close()
}

func (d *DB) stopReplicaRetry() {
	if d.replicaRetryStop != nil {
		d.replicaRetryStopOnce.Do(func() { close(d.replicaRetryStop) })
	}
}

func (d *DB) Within(ctx context.Context, fn func(ctx context.Context) error) error {
	if _, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return fn(ctx)
	}
	tx, err := d.primary.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pg: begin: %w", err)
	}
	committed := false
	defer func() {
		if !committed {

			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	if err := fn(context.WithValue(ctx, txKey{}, tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pg: commit: %w", err)
	}
	committed = true
	return nil
}

func (d *DB) Tx(ctx context.Context) DBTX {
	if tx, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return tx
	}
	return d.primary
}

func (d *DB) Read(ctx context.Context, fn func(ctx context.Context, q DBTX) error) error {

	if tx, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return fn(ctx, tx)
	}
	rp := d.replica.Load()
	if rp == nil || !d.breaker.Allow() {
		return fn(ctx, d.primary)
	}

	defer d.breaker.release()

	err := fn(ctx, rp)
	if err == nil {
		d.breaker.OnSuccess()
		return nil
	}
	if isConnectTransient(err) {

		d.breaker.Trip()
		return fn(ctx, d.primary)
	}
	if !isCallerCtxErr(err) {

		d.breaker.OnSuccess()
	}

	return err
}

func AsNotFound(err error, msg string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return apierr.New(apierr.NotFound, msg)
	}
	return err
}

func IsUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return false
	}
	return constraint == "" || pgErr.ConstraintName == constraint
}

func AsDuplicate(err error, dup error) error {
	if IsUniqueViolation(err, "") {
		return dup
	}
	return err
}
