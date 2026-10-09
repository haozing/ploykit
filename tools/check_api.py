#!/usr/bin/env python3
"""API spec 漂移守卫：比对 docs/openapi.yaml 与 Go 路由注册源码的 (method, path) 集合。

用途：中央 OpenAPI 契约（docs/openapi.yaml）是前后端唯一事实源；本脚本保证
spec 覆盖面与代码实际挂载的路由注册逐条一致——任一侧多出/缺失即 exit 1，
CI/合并期门禁直接跑 `python tools/check_api.py`。

扫描范围（与 example 应用实际挂载面一致）：
  - 框架各域 */adapters/http/*.go（排除 _test.go；含升格后的 schedule/settings）
  - example/cmd/app/main.go（/config /healthz /readyz /debug/pool /ws）
  - example/internal/task/*.go（产品 task 域）

解析规则：
  - Go 1.22 ServeMux pattern 注册：`<recv>.Handle/HandleFunc("METHOD /path", ...)`，
    正则 ROUTE_RE；无 METHOD 前缀的挂载（如 `mux.Handle("/", h)`、
    `mux.Handle("/api/workspaces/{workspaceId}/", strip(sub))`）不视为端点，天然跳过。
  - 子 mux（recv != "mux"，如 workspace 域 workspaceSubroutes 的 `sub.HandleFunc`）
    注册的是相对路径：取同文件 StripPrefix("...") 的前缀拼回绝对路径。
  - spec 侧：paths 下每个 get/post/put/patch/delete/head/options/trace 键。
    优先用 PyYAML 解析；未安装则退回内置缩进正则解析器（零依赖可用）。

比对为字面精确匹配（含 {param} 名，如 {workspaceId} vs {id} 视为不同路径段）——
参数命名漂移同样算漂移。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs" / "openapi.yaml"

ROUTE_RE = re.compile(r"\b([A-Za-z_]\w*)\.Handle(?:Func)?\(\s*\"([A-Z]+)\s+(/[^\"]*)\"")
STRIP_RE = re.compile(r"StripPrefix\(\s*\"([^\"]+)\"")

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options", "trace")

SCAN_FILES = [
    *sorted(ROOT.glob("*/adapters/http/*.go")),
    ROOT / "example" / "cmd" / "app" / "main.go",
    *sorted((ROOT / "example" / "internal").glob("task/*.go")),
]

def go_routes() -> set[tuple[str, str]]:
    """扫描 Go 源码取 (METHOD, path) 集合（已归一化：子 mux 相对路径拼回前缀）。"""
    out: set[tuple[str, str]] = set()
    for f in SCAN_FILES:
        if f.name.endswith("_test.go") or not f.exists():
            continue
        src = f.read_text(encoding="utf-8")
        prefixes = STRIP_RE.findall(src)
        for recv, method, path in ROUTE_RE.findall(src):
            if path.startswith("/api"):
                out.add((method, path))
                continue
            if recv == "mux" or not path.startswith("/"):

                if recv == "mux":
                    out.add((method, path))
                else:
                    raise SystemExit(f"check_api: 无法归一化相对路由（无 StripPrefix）: {f}: {method} {path}")
                continue
            if len(prefixes) != 1:
                raise SystemExit(
                    f"check_api: 子 mux 路由归一化歧义（文件内 StripPrefix {prefixes}）: {f}: {method} {path}"
                )
            out.add((method, prefixes[0] + path))
    return out

def spec_routes() -> set[tuple[str, str]]:
    """解析 docs/openapi.yaml 取 (METHOD, path) 集合。"""
    if not SPEC.exists():
        raise SystemExit(f"check_api: spec 不存在: {SPEC}")
    text = SPEC.read_text(encoding="utf-8")
    try:
        import yaml
    except ImportError:
        return _spec_routes_regex(text)
    doc = yaml.safe_load(text)
    out: set[tuple[str, str]] = set()
    for path, item in (doc.get("paths") or {}).items():
        for m in HTTP_METHODS:
            if isinstance(item, dict) and m in item:
                out.add((m.upper(), path))
    return out

def _spec_routes_regex(text: str) -> set[tuple[str, str]]:
    """PyYAML 缺席时的退路：按本 spec 的固定缩进（path=2 空格，method=4 空格）解析。"""
    out: set[tuple[str, str]] = set()
    cur: str | None = None
    for line in text.splitlines():
        pm = re.match(r"^  (/[^\s:][^:]*):\s*$", line)
        if pm:
            cur = pm.group(1)
            continue
        mm = re.match(r"^    (%s):\s*$" % "|".join(HTTP_METHODS), line)
        if mm and cur:
            out.add((mm.group(1).upper(), cur))
    return out

def main() -> int:
    spec = spec_routes()
    code = go_routes()
    spec_only = sorted(spec - code)
    code_only = sorted(code - spec)
    print(f"spec routes: {len(spec)}  code routes: {len(code)}")
    if spec_only:
        print("\n[spec-only] 在 spec 但代码未注册（spec 超前或路径写错）:")
        for m, p in spec_only:
            print(f"  {m:7s} {p}")
    if code_only:
        print("\n[code-only] 代码已注册但 spec 缺失（新路由未进契约）:")
        for m, p in code_only:
            print(f"  {m:7s} {p}")
    if spec_only or code_only:
        print("\nFAIL: API spec 与路由注册存在漂移")
        return 1
    print("OK: docs/openapi.yaml 与 Go 路由注册零漂移")
    return 0

if __name__ == "__main__":
    sys.exit(main())
