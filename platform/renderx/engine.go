package renderx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	qjs "github.com/haozing/ploykit/platform/renderx/internal/qjs"
)

var (
	ErrRenderTimeout = errors.New("renderx: render timeout")

	ErrPoolClosed = errors.New("renderx: engine pool closed")
)

const (
	DefaultMemoryLimit = 512 << 20

	// WasmShadowStackSize is the physical C shadow stack baked into the
	// bundled quickjs.wasm at build time (wasm-ld -z stack-size=8MiB; see
	// internal/qjs/csrc/README.md). Exhausting it traps the wasm module with
	// an uncatchable "out of bounds memory access" and leaves the instance
	// unusable — QuickJS's own catchable guard must trip first, which is why
	// MaxStackSize is validated against this ceiling minus headroom.
	WasmShadowStackSize = 8 << 20

	// MaxLogicalStackSize is the largest accepted PoolOptions.MaxStackSize:
	// the shadow stack minus a 1MiB headroom, so a guard trip on the deepest
	// legal budget still leaves real stack below it and the physical wall
	// stays unreachable by recursion.
	MaxLogicalStackSize = WasmShadowStackSize - 1<<20

	// DefaultMaxStackSize is the QuickJS execution-stack cap applied when
	// PoolOptions.MaxStackSize is unset. QuickJS checks it on every nested
	// call and raises a CATCHABLE "Maximum call stack size exceeded" that
	// leaves the instance healthy (measured capacities: ~3.1k frames of
	// simple recursion at this budget, ~8k at MaxLogicalStackSize). History:
	// the pre-v0.17.0 engine silently disabled this guard under wasi, so the
	// only visible wall was the binary's 64KiB default shadow stack — the
	// original #15/#16 "phantom depth ceiling". Rebuilt wasm (csrc/, pinned
	// quickjs-ng v0.17.0) restores the guard; see ADR 0015.
	DefaultMaxStackSize = 1 << 20

	DefaultRenderTimeout = 3 * time.Second
)

func DefaultPoolSize() int {
	n := runtime.NumCPU()
	if n > 4 {
		return 4
	}
	return n
}

type RenderResult struct {
	HTML string
	Sink *DirectiveSink
}

type Renderer interface {
	Routes(ctx context.Context) ([]RouteSpec, error)

	Render(ctx context.Context, pageID, location string, props json.RawMessage) (RenderResult, error)
}

var _ Renderer = (*EnginePool)(nil)

type PoolOptions struct {
	Size int

	MemoryLimit int

	// MaxStackSize caps the QuickJS execution stack in bytes. QuickJS's
	// guard trips BEFORE the wasm module's physical shadow stack and raises
	// a catchable "Maximum call stack size exceeded" — the instance stays
	// healthy — so this knob trades depth capacity against per-render stack
	// budget. Values above MaxLogicalStackSize are rejected at construction:
	// beyond it recursion could reach the physical wall (uncatchable trap,
	// instance retired). 0 keeps DefaultMaxStackSize (1MiB).
	MaxStackSize int

	RenderTimeout time.Duration

	Prelude string
}

func (o PoolOptions) withDefaults() PoolOptions {
	c := o
	if c.Size <= 0 {
		c.Size = DefaultPoolSize()
	}
	if c.MemoryLimit <= 0 {
		c.MemoryLimit = DefaultMemoryLimit
	}
	if c.MaxStackSize <= 0 {
		c.MaxStackSize = DefaultMaxStackSize
	}
	if c.RenderTimeout <= 0 {
		c.RenderTimeout = DefaultRenderTimeout
	}
	if c.Prelude == "" {
		c.Prelude = DefaultPrelude
	}
	return c
}

type EnginePool struct {
	bundle []byte
	opts   PoolOptions

	idle chan *engineInstance

	mu        sync.Mutex
	instances []*engineInstance

	closed    chan struct{}
	closeOnce sync.Once
}

func NewEnginePool(bundle []byte, opts PoolOptions) (*EnginePool, error) {
	if len(bundle) == 0 {
		return nil, errors.New("renderx: NewEnginePool 收到空 bundle")
	}

	if opts.MemoryLimit > math.MaxUint32 {
		return nil, fmt.Errorf("renderx: MemoryLimit %d 超过 QuickJS 引擎的 uint32 上限（%d），将被静默截断；请配置 ≤4GiB 的值", opts.MemoryLimit, uint32(math.MaxUint32))
	}
	o := opts.withDefaults()
	if o.MaxStackSize > MaxLogicalStackSize {
		return nil, fmt.Errorf("renderx: MaxStackSize %d 超过逻辑栈上限 %d（wasm 物理栈 %d − 1MiB 余量）；继续上调不会生效——超出后爆栈会退化为不可恢复的 wasm trap 并报废实例，请下调", o.MaxStackSize, MaxLogicalStackSize, WasmShadowStackSize)
	}
	p := &EnginePool{
		bundle: bundle,
		opts:   o,
		idle:   make(chan *engineInstance, o.Size),
		closed: make(chan struct{}),
	}

	insts := make([]*engineInstance, o.Size)
	var mu sync.Mutex
	var firstErr error
	var wg sync.WaitGroup
	for i := range insts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			inst, err := newInstanceImpl(bundle, o)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			insts[i] = inst
		}(i)
	}
	wg.Wait()
	if firstErr != nil {
		for _, inst := range insts {
			if inst != nil {
				inst.close()
			}
		}
		return nil, firstErr
	}
	for _, inst := range insts {
		p.instances = append(p.instances, inst)
		inst.start(p)
		p.release(inst)
	}
	return p, nil
}

func (p *EnginePool) Render(ctx context.Context, pageID, location string, props json.RawMessage) (RenderResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if pageID == "" || location == "" {
		return RenderResult{}, errors.New("renderx: Render 需要 pageID 与 location")
	}
	propsJSON, err := normalizeProps(props)
	if err != nil {
		return RenderResult{}, err
	}

	inst, err := p.acquire(ctx)
	if err != nil {
		return RenderResult{}, err
	}
	defer p.release(inst)

	sink := NewSink()
	code := renderCallJS(pageID, location, propsJSON)
	val, err := p.ask(ctx, inst, instanceReq{code: code, label: "render:" + pageID, sink: sink})
	if err != nil {
		return RenderResult{}, err
	}
	var out jsRenderResult
	if err := json.Unmarshal([]byte(val), &out); err != nil {
		return RenderResult{}, fmt.Errorf("renderx: __ploykit_render__(%s, %s) 返回的 JSON 解析失败: %w", pageID, location, err)
	}
	return RenderResult{HTML: out.HTML, Sink: sink}, nil
}

type jsRenderResult struct {
	HTML       string      `json:"html"`
	Directives []Directive `json:"directives"`
}

func (p *EnginePool) Close() {
	p.closeOnce.Do(func() { close(p.closed) })

	p.mu.Lock()
	instances := append([]*engineInstance(nil), p.instances...)
	p.mu.Unlock()

	deadline := time.After(p.opts.RenderTimeout + time.Second)
	timedOut := false
	for _, inst := range instances {
		if atomic.LoadInt32(&inst.dead) != 0 {
			continue
		}
		if timedOut {
			p.killInstance(inst)
			continue
		}
		select {
		case <-inst.exited:
		case <-deadline:
			timedOut = true
			p.killInstance(inst)
		}
	}
}

type engineInstance struct {
	rt  *qjs.Runtime
	ctx *qjs.Context

	maxStackSize int

	reqs     chan instanceReq
	curSink  *DirectiveSink
	exited   chan struct{}
	deadCh   chan struct{}
	dead     int32
	closedSt int32
}

type instanceReq struct {
	code  string
	label string
	sink  *DirectiveSink
	done  chan askResult
}

type askResult struct {
	val string
	err error
}

func newInstance(bundle []byte, opts PoolOptions) (*engineInstance, error) {
	rt, err := qjs.NewRuntime()
	if err != nil {
		return nil, fmt.Errorf("renderx: QuickJS runtime 创建失败: %w", err)
	}
	if err := rt.SetMemoryLimit(uint32(opts.MemoryLimit)); err != nil {
		_ = rt.Close()
		return nil, fmt.Errorf("renderx: SetMemoryLimit 失败: %w", err)
	}
	if err := rt.SetMaxStackSize(uint32(opts.MaxStackSize)); err != nil {
		_ = rt.Close()
		return nil, fmt.Errorf("renderx: SetMaxStackSize 失败: %w", err)
	}

	rt.SetLogFunc(func(string) {})

	ctx, err := rt.NewContext()
	if err != nil {
		_ = rt.Close()
		return nil, fmt.Errorf("renderx: QuickJS context 创建失败: %w", err)
	}

	inst := &engineInstance{
		rt: rt, ctx: ctx,
		maxStackSize: opts.MaxStackSize,
		reqs:         make(chan instanceReq),
		exited:       make(chan struct{}),
		deadCh:       make(chan struct{}),
	}

	fn := ctx.Function("__ploykit_go_directive__", func(c *qjs.Context, this qjs.Value, args []qjs.Value) qjs.Value {
		if len(args) < 2 {
			return c.ThrowTypeError("__ploykit_host__.directive: want (kind, payload)")
		}
		if sink := inst.curSink; sink != nil {
			sink.Append(args[0].String(), json.RawMessage(args[1].String()))

			if sink.Truncated() {
				return c.ThrowError("__ploykit_host__.directive: 指令数/累计体积超过单次渲染上限（" + fmt.Sprint(maxDirectives) + " 条 / " + fmt.Sprint(maxDirectiveBytes) + " 字节）")
			}
		}
		return c.Undefined()
	})
	if err := ctx.SetGlobal("__ploykit_go_directive__", fn); err != nil {
		_ = rt.Close()
		return nil, fmt.Errorf("renderx: 宿主函数注册失败: %w", err)
	}

	if _, err := ctx.EvalFile(opts.Prelude, "ploykit-prelude.js"); err != nil {
		_ = rt.Close()
		return nil, fmt.Errorf("renderx: prelude 注入失败: %w", err)
	}
	if _, err := ctx.EvalFile(string(bundle), "ssr-bundle.js"); err != nil {
		_ = rt.Close()
		return nil, fmt.Errorf("renderx: SSR bundle 求值失败: %w", err)
	}
	return inst, nil
}

func (inst *engineInstance) start(p *EnginePool) {
	go inst.run(p)
}

func (inst *engineInstance) run(p *EnginePool) {
	defer close(inst.exited)
	for {
		select {
		case <-p.closed:
			inst.close()
			return
		case <-inst.deadCh:

			return
		case req := <-inst.reqs:
			if !inst.handle(req) {

				p.replaceInstance(inst)
				return
			}
		}
	}
}

func (inst *engineInstance) handle(req instanceReq) bool {
	inst.curSink = req.sink
	val, err, panicked := func() (val string, err error, panicked bool) {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
				err = fmt.Errorf("renderx: 引擎执行 panic（实例将废弃重建）: %v", r)
				// A wasm trap reaching the Go panic path is unexpected now
				// (recursion overflow is caught by the JS guard; ADR 0015);
				// name the historical driver for the rare other causes.
				if strings.Contains(fmt.Sprint(r), "out of bounds memory access") {
					err = fmt.Errorf("%w（提示：触发了 wasm 物理栈/内存边界——组件树过深是历史成因；逻辑护栏（当前 %d 字节）应先拦截，出现此错即异常情况）", err, inst.maxStackSize)
				}
			}
		}()
		val, err = inst.ctx.EvalToString(req.code, req.label+".js")
		return
	}()
	inst.curSink = nil
	retire := panicked
	if err != nil && !panicked {
		switch {
		case strings.Contains(err.Error(), "out of bounds memory access"):
			// A wasm trap, not a JS exception: some linear-memory bound was
			// violated (the shadow stack being the historical case). The
			// instance's stack pointer is left corrupted — every later
			// render on it fails too (measured: a shallow render right after
			// an overflow still traps) — so retire it instead of reusing a
			// zombie. With the guard restored this should be unreachable by
			// recursion (MaxStackSize is capped below the physical stack),
			// hence the "report it" wording.
			err = fmt.Errorf("%w（提示：触发了 wasm 物理栈上限（%d 字节）——默认与上限预算下爆栈应先被逻辑护栏拦截，出现即异常情况；实例将废弃重建）", err, WasmShadowStackSize)
			retire = true
		case strings.Contains(err.Error(), "Maximum call stack size exceeded"),
			strings.Contains(err.Error(), "stack overflow"):
			// The catchable guard: QuickJS refused to recurse past
			// MaxStackSize. The instance is healthy; the tree is just too
			// deep for the current budget.
			err = fmt.Errorf("%w（提示：组件树递归深度超过逻辑栈预算（MaxStackSize=%d 字节）——精简组件树，或上调 PoolOptions.MaxStackSize（上限 %d）；实例未受损）", err, inst.maxStackSize, MaxLogicalStackSize)
		}
	}
	req.done <- askResult{val: val, err: err}
	if retire {
		atomic.StoreInt32(&inst.dead, 1)
		inst.close()
		return false
	}
	return true
}

func (inst *engineInstance) close() {
	if !atomic.CompareAndSwapInt32(&inst.closedSt, 0, 1) {
		return
	}
	defer func() { _ = recover() }()
	_ = inst.ctx.Close()
	_ = inst.rt.Close()
}

func (p *EnginePool) acquire(ctx context.Context) (*engineInstance, error) {
	select {
	case <-p.closed:
		return nil, ErrPoolClosed
	default:
	}
	select {
	case inst := <-p.idle:
		return inst, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.closed:
		return nil, ErrPoolClosed
	}
}

func (p *EnginePool) release(inst *engineInstance) {
	if atomic.LoadInt32(&inst.dead) != 0 {
		return
	}
	select {
	case <-p.closed:
		return
	default:
	}
	select {
	case p.idle <- inst:
	case <-p.closed:
	}
}

func (p *EnginePool) ask(ctx context.Context, inst *engineInstance, req instanceReq) (string, error) {
	req.done = make(chan askResult, 1)

	select {
	case <-p.closed:
		return "", ErrPoolClosed
	default:
	}
	select {
	case inst.reqs <- req:
	case <-ctx.Done():
		return "", ctx.Err()
	case <-p.closed:
		return "", ErrPoolClosed
	}

	timer := time.NewTimer(p.opts.RenderTimeout)
	defer timer.Stop()
	select {
	case r := <-req.done:
		return r.val, r.err
	case <-timer.C:
		p.killInstance(inst)
		return "", fmt.Errorf("%w: %s 超过 %s", ErrRenderTimeout, req.label, p.opts.RenderTimeout)
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (p *EnginePool) killInstance(inst *engineInstance) {
	if !atomic.CompareAndSwapInt32(&inst.dead, 0, 1) {
		return
	}
	_ = inst.rt.ForceClose()
	close(inst.deadCh)
	go p.replaceInstance(inst)
}

var newInstanceImpl = newInstance

func (p *EnginePool) replaceInstance(dead *engineInstance) {
	select {
	case <-p.closed:
		return
	default:
	}
	repl, err := newInstanceImpl(p.bundle, p.opts)

	p.mu.Lock()
	for i, cur := range p.instances {
		if cur == dead {
			if err != nil {
				p.instances = append(p.instances[:i], p.instances[i+1:]...)
			} else {
				p.instances[i] = repl
			}
			p.mu.Unlock()
			if err != nil {
				return
			}
			repl.start(p)
			p.release(repl)
			return
		}
	}
	p.mu.Unlock()
}

func normalizeProps(props json.RawMessage) (string, error) {
	if len(props) == 0 {
		return "{}", nil
	}
	if len(props) > MaxPropsBytes {
		return "", fmt.Errorf("%w: %d 字节 > 上限 %d", ErrPropsTooLarge, len(props), MaxPropsBytes)
	}
	if !json.Valid(props) {
		return "", errors.New("renderx: props 不是合法 JSON")
	}
	return string(props), nil
}

func renderCallJS(pageID, location, propsJSON string) string {
	page, _ := json.Marshal(pageID)
	loc, _ := json.Marshal(location)
	props, _ := json.Marshal(propsJSON)
	return fmt.Sprintf(
		"(function(){var r=__ploykit_render__(%s, %s, %s);return typeof r==='string'?r:JSON.stringify(r);})()",
		page, loc, props)
}

const DefaultPrelude = `// ---- ploykit renderx shim prelude（§5.4 v2.3 定稿）----
// 1. process：空对象（NODE_ENV 已被 esbuild define 消除；防御性保留）
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {};
}
// 2. MessageChannel：react-dom 求值期探测；同步渲染不触发——最小空实现
if (typeof globalThis.MessageChannel === 'undefined') {
  globalThis.MessageChannel = function MessageChannel() {
    this.port1 = { onmessage: null, postMessage: function () {}, start: function () {}, close: function () {} };
    this.port2 = { onmessage: null, postMessage: function () {}, start: function () {}, close: function () {} };
  };
}
// 3. TextEncoder/TextDecoder：react-dom server.browser 求值期访问（QuickJS 无 Web Encoding API）
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = function TextEncoder() { this.encoding = 'utf-8'; };
  globalThis.TextEncoder.prototype.encode = function (s) {
    s = s == null ? '' : String(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var code = s.codePointAt(i);
      if (code > 0xffff) i++;
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return new Uint8Array(out);
  };
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = function TextDecoder() { this.encoding = 'utf-8'; };
  globalThis.TextDecoder.prototype.decode = function (bytes) {
    if (bytes == null) return '';
    var s = '';
    for (var i = 0; i < bytes.length; ) {
      var b = bytes[i], code = 0, n = 1;
      if (b < 0x80) code = b;
      else if (b >= 0xc0 && b < 0xe0) { code = b & 31; n = 2; }
      else if (b >= 0xe0 && b < 0xf0) { code = b & 15; n = 3; }
      else { code = b & 7; n = 4; }
      for (var j = 1; j < n && i + j < bytes.length; j++) code = (code << 6) | (bytes[i + j] & 63);
      i += n;
      s += String.fromCodePoint(code);
    }
    return s;
  };
}
// 4. URL：react-router 模块作用域 new URL("http://localhost")（DEFAULT_NAVIGATION_URL）
// （StaticRouter 同步渲染不触及其余方法；最小解析实现，仅覆盖构造与 href/origin 读取）
if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = function URL(input, base) {
    input = String(input);
    if (base !== undefined) {
      var b = /^([a-z]+:)\/\/([^/?#]*)([^?#]*)/.exec(String(base));
      if (b && !/^[a-z]+:/i.test(input)) {
        input = input.charAt(0) === '/' ? b[1] + '//' + b[2] + input : b[1] + '//' + b[2] + b[3].replace(/[^/]*$/, '') + input;
      }
    }
    var m = /^([a-z][a-z0-9+.-]*:)?(\/\/([^/?#]*))?([^?#]*)(\?[^\u0000#]*)?(#[^\u0000]*)?/i.exec(input) || [];
    this.protocol = m[1] || '';
    this.host = m[3] || '';
    this.hostname = this.host.replace(/:\d+$/, '');
    this.port = /:(\d+)$/.exec(this.host) ? /:(\d+)$/.exec(this.host)[1] : '';
    this.pathname = m[4] || '/';
    this.search = m[5] || '';
    this.hash = m[6] || '';
    var self = this;
    this.searchParams = {
      get: function () { return null; },
      getAll: function () { return []; },
      has: function () { return false; },
      toString: function () { return self.search.charAt(0) === '?' ? self.search.slice(1) : self.search; },
    };
    this.href = this.protocol + (this.host ? '//' + this.host : '') + this.pathname + this.search + this.hash;
    this.origin = this.protocol + (this.host ? '//' + this.host : '');
    this.toString = function () { return self.href; };
  };
}
// 5. 异步调度：注册即抛错（N2 显式化——static 页是同步渲染，数据走 Go Loader；
// 依赖 setTimeout/setImmediate 的页面在渲染期爆炸，G5）。clear* 是纯清理函数，
// 空实现无副作用（页面的 effect 里的 clearTimeout 不应让 SSR 失败）。
function __ploykit_no_async__(name) {
  return function () {
    throw new Error('页面依赖异步调度：' + name + ' 在 SSR 沙箱不可用（静态页禁止异步渲染，数据请走 Go Loader）');
  };
}
globalThis.setTimeout = __ploykit_no_async__('setTimeout');
globalThis.setInterval = __ploykit_no_async__('setInterval');
globalThis.setImmediate = __ploykit_no_async__('setImmediate');
globalThis.clearTimeout = function () {};
globalThis.clearInterval = function () {};
globalThis.clearImmediate = function () {};
// 6. 指令通道：JS 侧 per-render sink + Go host fn 转发（§5.5，唯一宿主函数）。
// __ploykit_render__（@ploykit/runtime/server 或 m0 fixture 同构实现）每次渲染
// 重置 __ploykit_directives__ 并临时安装自己的收集器，结束时恢复本宿主。
globalThis.__ploykit_directives__ = [];
globalThis.__ploykit_host__ = {
  directive: function (kind, payload) {
    globalThis.__ploykit_directives__.push({ kind: kind, payload: payload });
    if (typeof globalThis.__ploykit_go_directive__ === 'function') {
      globalThis.__ploykit_go_directive__(kind, typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
  },
};
// ---- end prelude ----
`
