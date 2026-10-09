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
	return nil
}

func ReconcileEngine(ctx context.Context, r Renderer) error {
	routes, err := r.Routes(ctx)
	if err != nil {
		return fmt.Errorf("renderx: 路由表询问失败: %w", err)
	}
	return Reconcile(routes)
}
