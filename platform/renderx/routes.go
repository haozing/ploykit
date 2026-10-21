package renderx

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (p *EnginePool) Routes(ctx context.Context) ([]RouteSpec, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	inst, err := p.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer p.release(inst)

	val, err := p.ask(ctx, inst, instanceReq{code: "__ploykit_routes__()", label: "routes"})
	if err != nil {
		return nil, err
	}
	var specs []RouteSpec
	if err := json.Unmarshal([]byte(val), &specs); err != nil {
		return nil, fmt.Errorf("renderx: __ploykit_routes__() 返回的不是路由表 JSON: %w", err)
	}
	for _, s := range specs {
		if err := validateRouteSpec(s); err != nil {
			return nil, err
		}
	}
	if len(specs) == 0 {
		return nil, fmt.Errorf("renderx: __ploykit_routes__() 返回空路由表（bundle 入口未挂 __ploykit_routes__？）")
	}
	return specs, nil
}

func validateRouteSpec(s RouteSpec) error {
	if s.Path == "" || !strings.HasPrefix(s.Path, "/") {
		return fmt.Errorf("renderx: 路由投影非法 path %q（须以 / 开头，与 routes.tsx 声明原文一致）", s.Path)
	}
	if s.PageID == "" {
		return fmt.Errorf("renderx: 路由 %q 缺 pageId", s.Path)
	}
	if s.Render != ModeStatic && s.Render != ModeCSR {
		return fmt.Errorf("renderx: 路由 %q 的 render=%q 非法（只接受 static / csr）", s.Path, s.Render)
	}
	switch s.Hydrate {
	case "", HydrateLoad, HydrateNone:
	default:
		return fmt.Errorf("renderx: 路由 %q 的 hydrate=%q 非法（只接受 none / load）", s.Path, s.Hydrate)
	}
	if s.Hydrate == HydrateNone && s.Render != ModeStatic {
		return fmt.Errorf("renderx: 路由 %q 声明 hydrate=none 但 render=%s（CSR 页必须挂载才有内容）", s.Path, s.Render)
	}
	return nil
}

// 投影里的空串（旧路由表未声明 hydrate）在与 HydrateNone 比较时天然归一为
// "要水合"：RenderOnce 的判据是 `hydrate == HydrateNone`，任何其它取值（含 ""）
// 都走注入路径。刻意不提供 wantsHydration 之类的归一 helper ——那只会多出一处
// 需要与 RenderOnce 保持同步的判断。

func ReconcileEngine(ctx context.Context, r Renderer) error {
	routes, err := r.Routes(ctx)
	if err != nil {
		return fmt.Errorf("renderx: 路由表询问失败: %w", err)
	}
	return Reconcile(routes)
}
