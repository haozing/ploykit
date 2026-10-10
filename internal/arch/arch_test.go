package arch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestArchitectureBoundaries(t *testing.T) {
	root := findModuleRoot(t)
	modPath := modulePath(t, root)
	g := buildGraph(modPath, goListPackages(t, root))
	allow := loadAllowlist(t)

	t.Run("AllowlistFreshness", func(t *testing.T) {
		for _, e := range allow {
			if !g.hasCoveredEdge(e) {
				t.Errorf("[allowlist] %s  %s -> %s  |  陈旧豁免：当前 import 图中不存在此直接依赖（from 按子树匹配，to 须为精确包路径）  |  修复指引：该直接 import 已被移除，请删除本条豁免，防止清单静默累积（docs/adr/0002）",
					e.loc, e.from, e.to)
			}
		}
	})

	t.Run("AllowlistLegitimacy", func(t *testing.T) {
		for _, e := range nonBusinessAllowEntries(allow) {
			t.Errorf("[allowlist] %s  %s -> %s  |  无效豁免：A2/A3 是豁免清单的消费方，只接受业务域 -> 业务域的边  |  修复指引：非跨域依赖不需要豁免；违反 A1/A4-A7 的依赖请直接修复依赖本身，不得登记豁免",
				e.loc, e.from, e.to)
		}
	})

	for _, r := range rules {
		checkRule(t, r, g, edgesForRule(r, g, allow))
	}
}

var domainNames = []string{
	"identity", "workspace", "billing", "quota",
	"admin", "notify", "audit", "analytics", "webhooks",

	"schedule", "settings",
}

func domainOf(rel string) string {
	first := rel
	if i := strings.IndexByte(rel, '/'); i >= 0 {
		first = rel[:i]
	}
	for _, d := range domainNames {
		if first == d {
			return d
		}
	}
	return ""
}

func isBusiness(rel string) bool { return domainOf(rel) != "" }

func inTree(rel, prefix string) bool {
	return rel == prefix || strings.HasPrefix(rel, prefix+"/")
}

type ruleSpec struct {
	id        string
	desc      string
	fix       string
	inScope   func(rel string) bool
	forbidden func(src, tgt string) bool
}

var rules = []ruleSpec{
	{
		id:        "A1",
		desc:      "platform/* 不得到达业务域",
		fix:       "platform 零业务依赖（docs/architecture.md §2.1）",
		inScope:   func(rel string) bool { return inTree(rel, "platform") },
		forbidden: func(src, tgt string) bool { return isBusiness(tgt) },
	},
	{
		id:        "A2",
		desc:      "业务域不得 import identity",
		fix:       "identity 解耦三手段：webx.Principal / MemberCheck / RoleOf 闭包注入（docs/architecture.md §4.2）",
		inScope:   func(rel string) bool { return isBusiness(rel) && domainOf(rel) != "identity" },
		forbidden: func(src, tgt string) bool { return domainOf(tgt) == "identity" },
	},
	{
		id:      "A3",
		desc:    "业务域之间不得横向 import",
		fix:     "组合只发生在产品组合根（example/cmd/app/main.go）；admin→audit 只读豁免见 docs/adr/0002",
		inScope: func(rel string) bool { return isBusiness(rel) },
		forbidden: func(src, tgt string) bool {
			return isBusiness(tgt) && domainOf(tgt) != domainOf(src)
		},
	},
	{
		id:      "A4",
		desc:    "internal/contract 不得到达业务域或 platform/*",
		fix:     "contract 是最底层契约，不得反向依赖",
		inScope: func(rel string) bool { return inTree(rel, "internal/contract") },
		forbidden: func(src, tgt string) bool {
			return isBusiness(tgt) || inTree(tgt, "platform")
		},
	},
	{
		id:      "A5",
		desc:    "authz 不得到达业务域或 identity",
		fix:     "authz 是横切共享层，只可依赖 platform（docs/agent-native.md §4.2）",
		inScope: func(rel string) bool { return inTree(rel, "authz") },
		forbidden: func(src, tgt string) bool {
			return isBusiness(tgt)
		},
	},
	{
		id:      "A6",
		desc:    "authorization 不得 import 本 module 任何其他包",
		fix:     "authorization 承诺自包含（authorization/README.md：不 import 框架其他包，含 authz）；需要的事实与规则由调用方注入",
		inScope: func(rel string) bool { return inTree(rel, "authorization") },
		forbidden: func(src, tgt string) bool {
			return !inTree(tgt, "authorization")
		},
	},
}

func checkRule(t *testing.T, r ruleSpec, g *graph, adj map[string][]string) {
	t.Helper()
	t.Run(r.id, func(t *testing.T) {
		for _, v := range violationsOf(r, g, adj) {
			if v.via == "" {
				t.Errorf("[%s] %s  %s  |  %s  |  修复指引：%s",
					v.id, v.loc, v.arrow, r.desc, r.fix)
				continue
			}
			t.Errorf("[%s] %s  %s  (传递: %s)  |  %s  |  修复指引：%s",
				v.id, v.loc, v.arrow, v.via, r.desc, r.fix)
		}
	})
}

func violationsOf(r ruleSpec, g *graph, adj map[string][]string) []violation {
	var srcs []string
	for rel := range g.nodes {
		if r.inScope(rel) {
			srcs = append(srcs, rel)
		}
	}
	sort.Strings(srcs)
	var out []violation
	for _, src := range srcs {
		dist := map[string]int{src: 0}
		parent := map[string]string{}
		queue := []string{src}
		for head := 0; head < len(queue); head++ {
			cur := queue[head]
			for _, nxt := range adj[cur] {
				if _, seen := dist[nxt]; seen {
					continue
				}
				dist[nxt] = dist[cur] + 1
				parent[nxt] = cur
				queue = append(queue, nxt)
			}
		}
		var targets []string
		for tgt, d := range dist {
			if d > 0 && r.forbidden(src, tgt) {
				targets = append(targets, tgt)
			}
		}
		sort.Strings(targets)
		for _, tgt := range targets {
			v := violation{id: r.id, arrow: zoneOf(src) + " -> " + zoneOf(tgt)}
			if dist[tgt] == 1 {
				v.loc = g.importLoc(src, tgt)
			} else {
				v.loc = src + "/ (目录级定位：无直接 import 行)"
				v.via = pathString(parent, src, tgt)
			}
			out = append(out, v)
		}
	}
	return out
}

func zoneOf(rel string) string {
	if d := domainOf(rel); d != "" {
		return d
	}
	return rel
}

func pathString(parent map[string]string, src, tgt string) string {
	hops := []string{tgt}
	for cur := tgt; cur != src; {
		cur = parent[cur]
		hops = append([]string{cur}, hops...)
	}
	return strings.Join(hops, " -> ")
}

type violation struct {
	id, loc, arrow, via string
}

type pkgInfo struct {
	ImportPath string
	Dir        string
	GoFiles    []string
	Imports    []string
}

type graph struct {
	modPath string
	nodes   map[string]*pkgInfo
	adj     map[string][]string
}

func buildGraph(modPath string, pkgs []*pkgInfo) *graph {
	g := &graph{
		modPath: modPath,
		nodes:   make(map[string]*pkgInfo, len(pkgs)),
		adj:     make(map[string][]string, len(pkgs)),
	}
	for _, p := range pkgs {
		g.nodes[strings.TrimPrefix(p.ImportPath, modPath+"/")] = p
	}
	for rel, p := range g.nodes {
		seen := map[string]bool{}
		for _, imp := range p.Imports {
			if !strings.HasPrefix(imp, modPath+"/") {
				continue
			}
			irel := strings.TrimPrefix(imp, modPath+"/")
			if _, ok := g.nodes[irel]; !ok || seen[irel] {
				continue
			}
			seen[irel] = true
			g.adj[rel] = append(g.adj[rel], irel)
		}
		sort.Strings(g.adj[rel])
	}
	return g
}

func (g *graph) importLoc(srcRel, tgtRel string) string {
	p := g.nodes[srcRel]
	needle := "\"" + g.modPath + "/" + tgtRel + "\""
	for _, f := range p.GoFiles {
		data, err := os.ReadFile(filepath.Join(p.Dir, f))
		if err != nil {
			continue
		}
		for i, line := range strings.Split(string(data), "\n") {
			if strings.Contains(line, needle) {
				return fmt.Sprintf("%s:%d", filepath.ToSlash(filepath.Join(srcRel, f)), i+1)
			}
		}
	}
	return srcRel + "/ (目录级定位：未找到直接 import 行)"
}

func edgeKey(from, to string) string { return from + " -> " + to }

func (e allowEntry) coveredBy(from, to string) bool {
	return inTree(from, e.from) && to == e.to
}

func (g *graph) hasCoveredEdge(e allowEntry) bool { return len(g.matchingEdges(e)) > 0 }

func (g *graph) matchingEdges(e allowEntry) [][2]string {
	var out [][2]string
	for from, targets := range g.adj {
		for _, to := range targets {
			if e.coveredBy(from, to) {
				out = append(out, [2]string{from, to})
			}
		}
	}
	return out
}

func exemptEdgeSet(g *graph, allow []allowEntry) map[string]bool {
	exempt := map[string]bool{}
	for _, e := range allow {
		for _, edge := range g.matchingEdges(e) {
			exempt[edgeKey(edge[0], edge[1])] = true
		}
	}
	return exempt
}

func (g *graph) reducedAdj(exempt map[string]bool) map[string][]string {
	adj := make(map[string][]string, len(g.adj))
	for from, targets := range g.adj {
		for _, to := range targets {
			if exempt[edgeKey(from, to)] {
				continue
			}
			adj[from] = append(adj[from], to)
		}
	}
	return adj
}

func edgesForRule(r ruleSpec, g *graph, allow []allowEntry) map[string][]string {
	if r.id != "A2" && r.id != "A3" {
		return g.adj
	}
	if exempt := exemptEdgeSet(g, allow); len(exempt) > 0 {
		return g.reducedAdj(exempt)
	}
	return g.adj
}

type allowEntry struct {
	from, to string
	loc      string
}

var allowLineRe = regexp.MustCompile(`^(\S+)\s*->\s*(\S+)\s*#\s*(.+)$`)

func loadAllowlist(t *testing.T) []allowEntry {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位当前测试文件路径")
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "allowlist.txt"))
	if err != nil {
		t.Fatalf("读取豁免清单失败（跨域豁免必须显式登记，不得静默豁免）: %v", err)
	}
	var entries []allowEntry
	for i, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		m := allowLineRe.FindStringSubmatch(line)
		if m == nil {
			t.Errorf("[allowlist] internal/arch/allowlist.txt:%d  %q  |  格式非法  |  修复指引：每行须为 `from -> to # 理由（须引用 ADR）`，from/to 为相对包路径",
				i+1, line)
			continue
		}
		entries = append(entries, allowEntry{
			from: m[1],
			to:   m[2],
			loc:  fmt.Sprintf("internal/arch/allowlist.txt:%d", i+1),
		})
	}
	return entries
}

func nonBusinessAllowEntries(entries []allowEntry) []allowEntry {
	var bad []allowEntry
	for _, e := range entries {
		if domainOf(e.from) == "" || domainOf(e.to) == "" {
			bad = append(bad, e)
		}
	}
	return bad
}

func findModuleRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位当前测试文件路径")
	}
	dir := filepath.Dir(thisFile)
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("未找到 go.mod（从 %s 向上查找）", thisFile)
		}
		dir = parent
	}
}

func modulePath(t *testing.T, root string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatalf("读取 go.mod 失败: %v", err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if mod, ok := strings.CutPrefix(line, "module "); ok {
			return strings.TrimSpace(mod)
		}
	}
	t.Fatal("go.mod 中未找到 module 声明")
	return ""
}

func goListPackages(t *testing.T, root string) []*pkgInfo {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "list", "-json", "./...")
	cmd.Dir = root
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("go list -json ./... 失败: %v\nstderr:\n%s", err, stderr.String())
	}
	dec := json.NewDecoder(&stdout)
	var pkgs []*pkgInfo
	for {
		var p pkgInfo
		if err := dec.Decode(&p); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			t.Fatalf("解析 go list JSON 输出失败: %v", err)
		}
		pkgs = append(pkgs, &p)
	}
	if len(pkgs) == 0 {
		t.Fatal("go list 未返回任何包")
	}
	return pkgs
}
