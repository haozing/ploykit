// Package capx is the headless media capture capability of the framework:
// deterministic frame-by-frame rendering of an in-memory HTML document with a
// local headless Chrome-family browser (GSAP timeline seek + screenshot into
// PNG frames), plus ffmpeg-based encoding and compositing helpers. It is the
// engine behind the agent video studio
// (docs/plan-agent-video-studio-architecture-2026-11-14.md §3) and any other
// capability that needs "HTML timeline -> frames -> MP4".
//
// Gating contract (ADR 0014 shape, same as platform/mcpx): the capability is
// env-gated and silent by default. With Config.Enabled nil or false, New
// returns an inert runtime; every capability method on it returns
// ErrNotConfigured. Not configured is diagnosable, never silent — products log
// why the capability is off at boot. Availability of the external tools is
// probed once at New time; Runtime.Available reports the combined result.
// Health checks must NOT probe Chrome or ffmpeg: an optional capability must
// not degrade readiness for products that never use video (§3.1).
//
// External dependencies: a Chrome-family browser (driven through chromedp)
// and the ffmpeg binary (os/exec only — no cgo). Set the Config paths to
// bypass auto-probing; see ProbeChrome and ProbeFFMpeg for the probe order.
//
// Determinism contract (Renderer.RenderFrames): a rendered frame depends only
// on (doc.HTML, doc.TimelineID, frame index, FrameSpec) — same machine, same
// inputs, byte-identical PNGs. The projected document must cooperate: motion
// driven exclusively by GSAP timelines registered under window.__timelines
// (no CSS animations or transitions), fonts inlined (woff2 data URIs), images
// inlined (data URIs on the render path), readiness signaled via
// window.__player.ready, and the player using gsap.ticker.lagSmoothing(0) with
// paused timelines so that only pause(t) positions the playhead.
//
// Boundary (AGENTS.md boundary clause): only the LocalChrome renderer and the
// ffmpeg helpers in encode.go are consumed paths today. remote.go declares the
// not-yet-consumed RemoteHTTP extension point (design §3.5). The vendored GSAP
// copy at assets/gsap.min.js (version 3.13.0) is the version authority that
// the video domain's projector reads and inlines — capx does not embed it into
// Go.
package capx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// ErrNotConfigured is returned by every capability method on an inert runtime
// (Config.Enabled nil or false). Treat it as "capability off", not as a
// failure: log it once at boot and route users to the setup docs.
var ErrNotConfigured = errors.New("capx: capability not configured (Config.Enabled is nil or false)")

// Defaults for the optional Config and EncodeOptions fields.
const (
	DefaultPoolSize      = 1
	DefaultLaunchTimeout = 20 * time.Second
	// DefaultEncodeCRF is the x264 constant rate factor used when
	// EncodeOptions.CRF is unset (design §3.4: crf 18).
	DefaultEncodeCRF = 18
	// DefaultEncodePreset is the x264 speed preset used when unset.
	DefaultEncodePreset = "medium"
)

// Config gates and shapes the capability.
type Config struct {
	// Enabled gates the whole capability. nil counts as false (silent
	// degradation, metrics/mcpx contract): New returns an inert runtime and
	// every method returns ErrNotConfigured.
	Enabled *bool
	// ChromePath is an explicit path to a Chrome-family browser executable.
	// Empty = auto-probe: LookPath over "chrome", "google-chrome",
	// "chromium", "msedge", then the platform default install locations.
	ChromePath string
	// FFMpegPath is an explicit path to the ffmpeg executable. Empty =
	// auto-probe via LookPath("ffmpeg").
	FFMpegPath string
	// PoolSize is the number of warm headless browser instances kept for
	// reuse (a render job occupies one instance for its whole run; frames
	// reuse a tab inside it, never a new process). Default 1.
	PoolSize int
	// LaunchTimeout bounds a single browser instance launch. Default 20s.
	LaunchTimeout time.Duration
}

// Runtime is the assembled capability. Create it with New; the zero value is
// not usable. Safe for concurrent use.
type Runtime struct {
	cfg Config

	// probed tool paths; empty until probing succeeded.
	chromePath string
	ffmpegPath string

	// pool holds warm browser instances; capacity == PoolSize. Created
	// lazily under poolInit.
	pool     chan *browserInstance
	poolInit sync.Once

	// sem is the hard concurrency cap (PoolSize tokens): taken before any
	// launch or checkout, released when the instance returns. The idle pool
	// channel recycles warm instances; this gate bounds processes.
	sem chan struct{}

	closeMu sync.Mutex
	closed  bool

	// launch is the seam that starts one browser instance (overridden in
	// tests; production value is defaultLauncher).
	launch browserLauncher
}

// browserLauncher starts one warm browser instance for the runtime.
type browserLauncher func(rt *Runtime) (*browserInstance, error)

// New assembles the runtime.
//
// Gating: with Enabled nil or false it returns an inert runtime and a nil
// error — no probing happens and tool absence is not reported. Every method
// of that runtime returns ErrNotConfigured (diagnosable, not silent).
//
// With Enabled true it probes for both external tools immediately, so that
// misconfiguration surfaces at boot with a reason. On probe failure it still
// returns the runtime (with Available() == false) together with the error;
// callers that treat the capability as optional log the error and keep the
// runtime so that Available() stays the single liveness signal.
func New(cfg Config) (*Runtime, error) {
	enabled := cfg.Enabled != nil && *cfg.Enabled
	if cfg.PoolSize <= 0 {
		cfg.PoolSize = DefaultPoolSize
	}
	if cfg.LaunchTimeout <= 0 {
		cfg.LaunchTimeout = DefaultLaunchTimeout
	}
	r := &Runtime{cfg: cfg, launch: defaultLauncher}
	if !enabled {
		return r, nil
	}

	chrome, err := ProbeChrome(cfg.ChromePath)
	if err != nil {
		return r, fmt.Errorf("capx: %w", err)
	}
	r.chromePath = chrome

	ffmpeg, err := ProbeFFMpeg(cfg.FFMpegPath)
	if err != nil {
		return r, fmt.Errorf("capx: %w", err)
	}
	r.ffmpegPath = ffmpeg
	return r, nil
}

// Available reports whether the runtime can render and encode. False means
// either "gated off" (inert runtime) or "a required external tool was missing
// when New probed" — the reason is diagnosable through New's error return or
// boot logs.
func (r *Runtime) Available() bool {
	if r == nil {
		return false
	}
	enabled := r.cfg.Enabled != nil && *r.cfg.Enabled
	return enabled && r.chromePath != "" && r.ffmpegPath != ""
}

// acquire takes a browser instance from the warm pool, launching a new one
// when the pool is empty and below capacity. The returned release function
// must be called exactly once. Gating is enforced here: inert runtimes return
// ErrNotConfigured.
//
// PoolSize is a HARD concurrency cap (audit §4 P9): a weighted semaphore is
// taken before any launch/checkout, so concurrent renders can never exceed
// PoolSize browser processes. The idle channel only recycles warm instances;
// it does not gate anything. When all PoolSize slots are busy, acquire waits
// on the semaphore (ctx-cancellable) instead of launching an extra process.
func (r *Runtime) acquire(ctx context.Context) (*browserInstance, func(), error) {
	if !r.Available() {
		return nil, nil, ErrNotConfigured
	}
	r.poolInit.Do(func() {
		r.pool = make(chan *browserInstance, r.cfg.PoolSize)
		r.sem = make(chan struct{}, r.cfg.PoolSize)
	})
	// Hard cap first: block until a slot frees up (or ctx dies).
	select {
	case r.sem <- struct{}{}:
	case <-ctx.Done():
		return nil, nil, fmt.Errorf("capx: pool exhausted (PoolSize=%d): %w", r.cfg.PoolSize, ctx.Err())
	}

	inst, err := r.tryReuseOrLaunch(ctx)
	if err != nil {
		<-r.sem // release the slot; launch failed or ctx died
		return nil, nil, err
	}
	return inst, func() {
		r.put(inst)
		<-r.sem
	}, nil
}

// tryReuseOrLaunch checks out a warm instance or launches one. A raced
// launch (two callers pass the semaphore while the pool is empty) is
// possible and fine: put() caps the pool, extra instances close on return.
func (r *Runtime) tryReuseOrLaunch(ctx context.Context) (*browserInstance, error) {
	// Reuse a warm instance when one is free.
	select {
	case inst := <-r.pool:
		return inst, nil
	default:
	}
	// Launch under the caller's ctx so shutdown interrupts a pending launch.
	launchDone := make(chan *browserInstance, 1)
	launchErr := make(chan error, 1)
	go func() {
		inst, err := r.launch(r)
		if err != nil {
			launchErr <- err
			return
		}
		launchDone <- inst
	}()
	select {
	case inst := <-launchDone:
		return inst, nil
	case err := <-launchErr:
		return nil, err
	case <-ctx.Done():
		// The goroutine may still complete; sink the result so the launcher
		// goroutine never blocks, then close the instance.
		go func() {
			select {
			case inst := <-launchDone:
				inst.close()
			case <-launchErr:
			}
		}()
		return nil, ctx.Err()
	}
}

// put returns an instance to the pool; if the runtime is closing or the pool
// is at capacity the instance is closed instead.
func (r *Runtime) put(inst *browserInstance) {
	if inst == nil {
		return
	}
	r.closeMu.Lock()
	if !r.closed && r.pool != nil && len(r.pool) < r.cfg.PoolSize {
		r.pool <- inst
		r.closeMu.Unlock()
		return
	}
	r.closeMu.Unlock()
	inst.close()
}

// encoderPath returns the probed ffmpeg path for the encode helpers. On a
// live runtime the probe at New time already succeeded, so the path is always
// present; inert runtures are rejected by the ErrNotConfigured gate before
// callers reach here.
func (r *Runtime) encoderPath() string {
	return r.ffmpegPath
}

// Close shuts the browser pool down and closes every warm instance. It is
// idempotent and safe on inert runtimes. Instances currently checked out by
// in-flight renders are closed when those renders release them.
func (r *Runtime) Close() error {
	if r == nil {
		return nil
	}
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	if r.closed {
		return nil
	}
	r.closed = true
	if r.pool != nil {
		for {
			select {
			case inst := <-r.pool:
				inst.close()
			default:
				return nil
			}
		}
	}
	return nil
}

// checkExecutable verifies a candidate path exists and is a regular file.
func checkExecutable(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("capx: %s: %w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("capx: %s is a directory", path)
	}
	return nil
}

// ProbeChrome resolves the browser executable: explicit path first, then
// LookPath over the common Chrome-family names, then the platform default
// install locations (Linux relies on LookPath alone). Exported so products
// can diagnose availability before assembling a runtime.
func ProbeChrome(explicit string) (string, error) {
	if explicit != "" {
		if err := checkExecutable(explicit); err != nil {
			return "", err
		}
		return explicit, nil
	}
	for _, name := range []string{"chrome", "google-chrome", "chromium", "msedge"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	for _, p := range defaultChromeLocations() {
		if err := checkExecutable(p); err == nil {
			return p, nil
		}
	}
	return "", errors.New("chrome executable not found (looked up PATH and default install locations; set Config.ChromePath to override)")
}

// ProbeFFMpeg resolves the ffmpeg executable: explicit path first, then
// LookPath("ffmpeg"). Exported so products can diagnose availability before
// assembling a runtime.
func ProbeFFMpeg(explicit string) (string, error) {
	if explicit != "" {
		if err := checkExecutable(explicit); err != nil {
			return "", err
		}
		return explicit, nil
	}
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p, nil
	}
	return "", errors.New("ffmpeg executable not found on PATH (set Config.FFMpegPath to override)")
}

// defaultChromeLocations returns the platform default browser install paths,
// probed after PATH.
func defaultChromeLocations() []string {
	switch runtime.GOOS {
	case "windows":
		locations := make([]string, 0, 3)
		rel := filepath.Join("Google", "Chrome", "Application", "chrome.exe")
		for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "LocalAppData"} {
			if root := os.Getenv(env); root != "" {
				locations = append(locations, filepath.Join(root, rel))
			}
		}
		return locations
	case "darwin":
		return []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
	default:
		return nil
	}
}

// SetLauncherForTest replaces the browser-launch seam. TEST-ONLY: it exists
// so the pool/concurrency contract is exercisable without a real Chrome;
// production wiring must never call it.
func (r *Runtime) SetLauncherForTest(l browserLauncher) { r.launch = l }

// NewStubInstance builds a no-op browserInstance for launcher stubs in
// tests (nothing to probe, nothing to close).
func NewStubInstance() *browserInstance {
	return &browserInstance{ctx: context.Background(), cancel: func() {}}
}
