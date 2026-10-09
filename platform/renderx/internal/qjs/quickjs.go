package quickjs

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"

	"github.com/haozing/ploykit/platform/renderx/internal/qjs/internal/bridge"
)

type EvalFlag int32

const (
	EvalGlobal EvalFlag = 0

	EvalModule EvalFlag = 1 << 0
)

type Runtime struct {
	bridge  *bridge.Bridge
	rtPtr   uint32
	goCtx   context.Context
	mu      sync.Mutex
	logFunc func(msg string)

	lockHolder uintptr
	lockDepth  int32
	lockMu     sync.Mutex
}

func (r *Runtime) lock() {
	gid := getGoroutineID()

	r.lockMu.Lock()
	if r.lockHolder == gid {

		r.lockDepth++
		r.lockMu.Unlock()
		return
	}
	r.lockMu.Unlock()

	r.mu.Lock()

	r.lockMu.Lock()
	r.lockHolder = gid
	r.lockDepth = 1
	r.lockMu.Unlock()
}

func (r *Runtime) unlock() {
	r.lockMu.Lock()
	r.lockDepth--
	if r.lockDepth == 0 {
		r.lockHolder = 0
		r.lockMu.Unlock()
		r.mu.Unlock()
	} else {
		r.lockMu.Unlock()
	}
}

func getGoroutineID() uintptr {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)

	var id uintptr
	for i := 10; i < n && buf[i] != ' '; i++ {
		id = id*10 + uintptr(buf[i]-'0')
	}
	return id
}

func NewRuntime() (*Runtime, error) {
	return NewRuntimeWithContext(context.Background())
}

func NewRuntimeWithContext(ctx context.Context) (*Runtime, error) {
	b, err := bridge.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize QuickJS bridge: %w", err)
	}

	rtPtr, err := b.NewRuntime(ctx)
	if err != nil {
		b.Close(ctx)
		return nil, fmt.Errorf("failed to create QuickJS runtime: %w", err)
	}

	return &Runtime{
		bridge:  b,
		rtPtr:   rtPtr,
		goCtx:   ctx,
		logFunc: func(msg string) { fmt.Print(msg) },
	}, nil
}

func (r *Runtime) Close() error {
	r.lock()
	defer r.unlock()
	if err := r.bridge.FreeRuntime(r.goCtx, r.rtPtr); err != nil {
		return err
	}
	return r.bridge.Close(r.goCtx)
}

func (r *Runtime) ForceClose() error {
	return r.bridge.Close(r.goCtx)
}

func (r *Runtime) SetLogFunc(fn func(msg string)) {
	r.lock()
	defer r.unlock()
	r.logFunc = fn
	r.bridge.SetLogFunc(fn)
}

func (r *Runtime) NewContext() (*Context, error) {
	r.lock()
	defer r.unlock()

	ctxPtr, err := r.bridge.NewContext(r.goCtx, r.rtPtr)
	if err != nil {
		return nil, fmt.Errorf("failed to create JavaScript context: %w", err)
	}

	if err := r.bridge.AddConsole(r.goCtx, ctxPtr); err != nil {
		_ = r.bridge.FreeContext(r.goCtx, ctxPtr)
		return nil, fmt.Errorf("failed to add console support: %w", err)
	}

	return &Context{
		runtime: r,
		ctxPtr:  ctxPtr,
	}, nil
}

func (r *Runtime) RunGC() error {
	r.lock()
	defer r.unlock()
	return r.bridge.RunGC(r.goCtx, r.rtPtr)
}

func (r *Runtime) ExecutePendingJobs() (int, error) {
	r.lock()
	defer r.unlock()
	n, err := r.bridge.ExecutePendingJobs(r.goCtx, r.rtPtr)
	return int(n), err
}

func (r *Runtime) SetMemoryLimit(limit uint32) error {
	r.lock()
	defer r.unlock()
	return r.bridge.SetMemoryLimit(r.goCtx, r.rtPtr, limit)
}

func (r *Runtime) SetMaxStackSize(size uint32) error {
	r.lock()
	defer r.unlock()
	return r.bridge.SetMaxStackSize(r.goCtx, r.rtPtr, size)
}

type Context struct {
	runtime *Runtime
	ctxPtr  uint32
}

func (c *Context) Close() error {
	c.runtime.lock()
	defer c.runtime.unlock()
	return c.runtime.bridge.FreeContext(c.runtime.goCtx, c.ctxPtr)
}

func (c *Context) Eval(code string) (Value, error) {
	return c.EvalFile(code, "<eval>")
}

func (c *Context) EvalFile(code, filename string) (Value, error) {
	c.runtime.lock()
	defer c.runtime.unlock()

	valPtr, err := c.runtime.bridge.Eval(c.runtime.goCtx, c.ctxPtr, code, filename, int32(EvalGlobal))
	if err != nil {
		return Value{}, err
	}

	return c.checkException(valPtr)
}

func (c *Context) EvalModule(code, filename string) (Value, error) {
	c.runtime.lock()
	defer c.runtime.unlock()

	valPtr, err := c.runtime.bridge.EvalModule(c.runtime.goCtx, c.ctxPtr, code, filename)
	if err != nil {
		return Value{}, err
	}

	return c.checkException(valPtr)
}

func (c *Context) checkException(valPtr uint32) (Value, error) {
	isExc, _ := c.runtime.bridge.IsException(c.runtime.goCtx, valPtr)
	if isExc {

		excPtr, _ := c.runtime.bridge.GetException(c.runtime.goCtx, c.ctxPtr)
		errMsg, _ := c.runtime.bridge.GetErrorMessage(c.runtime.goCtx, c.ctxPtr, excPtr)
		if errMsg == "" {
			errMsg = "JavaScript exception"
		}
		_ = c.runtime.bridge.FreeValue(c.runtime.goCtx, c.ctxPtr, excPtr)
		return Value{}, errors.New(errMsg)
	}
	return Value{ctx: c, ptr: valPtr}, nil
}

func (c *Context) Global() (Value, error) {
	c.runtime.lock()
	defer c.runtime.unlock()

	valPtr, err := c.runtime.bridge.GetGlobalObject(c.runtime.goCtx, c.ctxPtr)
	if err != nil {
		return Value{}, err
	}
	return Value{ctx: c, ptr: valPtr}, nil
}

func (c *Context) Undefined() Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	return c.undefinedUnlocked()
}

func (c *Context) undefinedUnlocked() Value {
	ptr, _ := c.runtime.bridge.NewUndefined(c.runtime.goCtx)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Null() Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewNull(c.runtime.goCtx)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Bool(v bool) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewBool(c.runtime.goCtx, v)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Int32(v int32) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewInt32(c.runtime.goCtx, v)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Int64(v int64) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewInt64(c.runtime.goCtx, c.ctxPtr, v)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Float64(v float64) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewFloat64(c.runtime.goCtx, v)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) String(s string) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewString(c.runtime.goCtx, c.ctxPtr, s)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Object() Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewObject(c.runtime.goCtx, c.ctxPtr)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Array() Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewArray(c.runtime.goCtx, c.ctxPtr)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) BigInt(v int64) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewBigInt64(c.runtime.goCtx, c.ctxPtr, v)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) Date(epochMs float64) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewDate(c.runtime.goCtx, c.ctxPtr, epochMs)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) ArrayBuffer(data []byte) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.NewArrayBuffer(c.runtime.goCtx, c.ctxPtr, data)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) ParseJSON(json string) (Value, error) {
	c.runtime.lock()
	defer c.runtime.unlock()

	valPtr, err := c.runtime.bridge.JSONParse(c.runtime.goCtx, c.ctxPtr, json)
	if err != nil {
		return Value{}, err
	}
	return c.checkException(valPtr)
}

type GoFunc func(ctx *Context, this Value, args []Value) Value

func (c *Context) Function(name string, fn GoFunc) Value {

	bridgeFn := func(ctxPtr uint32, argPtrs []uint32) uint32 {
		args := make([]Value, len(argPtrs))
		for i, ptr := range argPtrs {
			args[i] = Value{ctx: c, ptr: ptr}
		}

		rt := c.runtime
		this := c.undefinedUnlocked()
		result := fn(c, this, args)

		_ = rt.bridge.FreeValue(rt.goCtx, ctxPtr, this.ptr)
		for _, ptr := range argPtrs {
			_ = rt.bridge.FreeValue(rt.goCtx, ctxPtr, ptr)
		}
		if result.ctx != nil && result.ptr != 0 {
			if u, _ := rt.bridge.IsUndefined(rt.goCtx, result.ptr); u {
				_ = rt.bridge.FreeValue(rt.goCtx, ctxPtr, result.ptr)
			}
		}
		return result.ptr
	}

	funcID := c.runtime.bridge.RegisterGoFunc(bridgeFn)

	c.runtime.lock()
	defer c.runtime.unlock()

	ptr, err := c.runtime.bridge.NewCFunction(c.runtime.goCtx, c.ctxPtr, funcID, name, -1)
	if err != nil {
		c.runtime.bridge.UnregisterGoFunc(funcID)
		return c.undefinedUnlocked()
	}

	return Value{ctx: c, ptr: ptr}
}

func (c *Context) EvalToString(code, filename string) (string, error) {
	c.runtime.lock()
	defer c.runtime.unlock()

	valPtr, err := c.runtime.bridge.Eval(c.runtime.goCtx, c.ctxPtr, code, filename, int32(EvalGlobal))
	if err != nil {
		return "", err
	}

	defer func() {
		_ = c.runtime.bridge.FreeValue(c.runtime.goCtx, c.ctxPtr, valPtr)
	}()

	isExc, _ := c.runtime.bridge.IsException(c.runtime.goCtx, valPtr)
	if isExc {
		excPtr, _ := c.runtime.bridge.GetException(c.runtime.goCtx, c.ctxPtr)
		errMsg, _ := c.runtime.bridge.GetErrorMessage(c.runtime.goCtx, c.ctxPtr, excPtr)
		if errMsg == "" {
			errMsg = "JavaScript exception"
		}
		_ = c.runtime.bridge.FreeValue(c.runtime.goCtx, c.ctxPtr, excPtr)
		return "", errors.New(errMsg)
	}
	return c.runtime.bridge.ToStringFull(c.runtime.goCtx, c.ctxPtr, valPtr)
}

func (c *Context) SetGlobal(name string, val Value) error {
	c.runtime.lock()
	defer c.runtime.unlock()

	globalPtr, err := c.runtime.bridge.GetGlobalObject(c.runtime.goCtx, c.ctxPtr)
	if err != nil {
		return err
	}
	return c.runtime.bridge.SetProperty(c.runtime.goCtx, c.ctxPtr, globalPtr, name, val.ptr)
}

func (c *Context) GetGlobal(name string) (Value, error) {
	c.runtime.lock()
	defer c.runtime.unlock()

	globalPtr, err := c.runtime.bridge.GetGlobalObject(c.runtime.goCtx, c.ctxPtr)
	if err != nil {
		return Value{}, err
	}
	valPtr, err := c.runtime.bridge.GetProperty(c.runtime.goCtx, c.ctxPtr, globalPtr, name)
	if err != nil {
		return Value{}, err
	}
	return Value{ctx: c, ptr: valPtr}, nil
}

func (c *Context) ThrowError(msg string) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.ThrowError(c.runtime.goCtx, c.ctxPtr, msg)
	return Value{ctx: c, ptr: ptr}
}

func (c *Context) ThrowTypeError(msg string) Value {
	c.runtime.lock()
	defer c.runtime.unlock()
	ptr, _ := c.runtime.bridge.ThrowTypeError(c.runtime.goCtx, c.ctxPtr, msg)
	return Value{ctx: c, ptr: ptr}
}

type Value struct {
	ctx *Context
	ptr uint32
}

func (v Value) IsUndefined() bool {
	if v.ctx == nil {
		return true
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsUndefined(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsNull() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsNull(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsBool() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsBool(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsNumber() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsNumber(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsString() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsString(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsSymbol() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsSymbol(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsObject() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsObject(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsArray() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsArray(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsFunction() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsFunction(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
	return result
}

func (v Value) IsError() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsError(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsBigInt() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsBigInt(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsDate() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsDate(v.ctx.runtime.goCtx, v.ptr)
	return result
}

func (v Value) IsPromise() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.IsPromise(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
	return result
}

func (v Value) String() string {
	if v.ctx == nil {
		return "undefined"
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	s, _ := v.ctx.runtime.bridge.ToString(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
	return s
}

func (v Value) Bool() bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	b, _ := v.ctx.runtime.bridge.ToBool(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
	return b
}

func (v Value) Int32() (int32, error) {
	if v.ctx == nil {
		return 0, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.ToInt32(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
}

func (v Value) Int64() (int64, error) {
	if v.ctx == nil {
		return 0, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.ToInt64(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
}

func (v Value) Float64() (float64, error) {
	if v.ctx == nil {
		return 0, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.ToFloat64(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
}

func (v Value) BigInt() (int64, error) {
	if v.ctx == nil {
		return 0, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.ToBigInt64(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
}

func (v Value) JSONStringify() (string, error) {
	if v.ctx == nil {
		return "", errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.JSONStringify(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
}

func (v Value) Bytes() ([]byte, error) {
	if v.ctx == nil {
		return nil, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.GetArrayBuffer(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
}

func (v Value) Typeof() string {
	if v.ctx == nil {
		return "undefined"
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	s, _ := v.ctx.runtime.bridge.Typeof(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr)
	return s
}

func (v Value) Get(prop string) (Value, error) {
	if v.ctx == nil {
		return Value{}, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	valPtr, err := v.ctx.runtime.bridge.GetProperty(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, prop)
	if err != nil {
		return Value{}, err
	}
	return Value{ctx: v.ctx, ptr: valPtr}, nil
}

func (v Value) Set(prop string, val Value) error {
	if v.ctx == nil {
		return errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.SetProperty(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, prop, val.ptr)
}

func (v Value) Has(prop string) bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.HasProperty(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, prop)
	return result
}

func (v Value) Delete(prop string) error {
	if v.ctx == nil {
		return errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.DeleteProperty(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, prop)
}

func (v Value) GetIdx(idx int) (Value, error) {
	if v.ctx == nil {
		return Value{}, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	valPtr, err := v.ctx.runtime.bridge.GetPropertyUint32(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, uint32(idx))
	if err != nil {
		return Value{}, err
	}
	return Value{ctx: v.ctx, ptr: valPtr}, nil
}

func (v Value) SetIdx(idx int, val Value) error {
	if v.ctx == nil {
		return errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	return v.ctx.runtime.bridge.SetPropertyUint32(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, uint32(idx), val.ptr)
}

func (v Value) Len() int {
	if v.ctx == nil {
		return 0
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	lenPtr, err := v.ctx.runtime.bridge.GetProperty(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, "length")
	if err != nil {
		return 0
	}
	n, _ := v.ctx.runtime.bridge.ToInt32(v.ctx.runtime.goCtx, v.ctx.ctxPtr, lenPtr)
	return int(n)
}

func (v Value) Call(this Value, args ...Value) (Value, error) {
	if v.ctx == nil {
		return Value{}, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()

	argPtrs := make([]uint32, len(args))
	for i, arg := range args {
		argPtrs[i] = arg.ptr
	}

	resultPtr, err := v.ctx.runtime.bridge.Call(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, this.ptr, argPtrs)
	if err != nil {
		return Value{}, err
	}

	return v.ctx.checkException(resultPtr)
}

func (v Value) CallMethod(method string, args ...Value) (Value, error) {
	if v.ctx == nil {
		return Value{}, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()

	argPtrs := make([]uint32, len(args))
	for i, arg := range args {
		argPtrs[i] = arg.ptr
	}

	resultPtr, err := v.ctx.runtime.bridge.Invoke(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, method, argPtrs)
	if err != nil {
		return Value{}, err
	}

	return v.ctx.checkException(resultPtr)
}

func (v Value) New(args ...Value) (Value, error) {
	if v.ctx == nil {
		return Value{}, errors.New("nil value")
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()

	argPtrs := make([]uint32, len(args))
	for i, arg := range args {
		argPtrs[i] = arg.ptr
	}

	resultPtr, err := v.ctx.runtime.bridge.CallConstructor(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, argPtrs)
	if err != nil {
		return Value{}, err
	}

	return v.ctx.checkException(resultPtr)
}

func (v Value) Instanceof(ctor Value) bool {
	if v.ctx == nil {
		return false
	}
	v.ctx.runtime.lock()
	defer v.ctx.runtime.unlock()
	result, _ := v.ctx.runtime.bridge.Instanceof(v.ctx.runtime.goCtx, v.ctx.ctxPtr, v.ptr, ctor.ptr)
	return result
}
