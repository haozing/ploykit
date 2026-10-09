package arch

import (
	"reflect"
	"sort"
	"testing"
)

const canaryMod = "example.com/canary"

func pkg(rel string, imports ...string) *pkgInfo {
	full := make([]string, len(imports))
	for i, imp := range imports {
		full[i] = canaryMod + "/" + imp
	}
	return &pkgInfo{ImportPath: canaryMod + "/" + rel, Imports: full}
}

func canaryGraph(pkgs []*pkgInfo) *graph { return buildGraph(canaryMod, pkgs) }

func ruleByID(id string) ruleSpec {
	for _, r := range rules {
		if r.id == id {
			return r
		}
	}
	return ruleSpec{}
}

func TestRulesCatchSyntheticViolations(t *testing.T) {
	g := canaryGraph([]*pkgInfo{
		pkg("identity/app"),
		pkg("workspace/app"),
		pkg("billing/app", "workspace/app"),
		pkg("quota/app", "identity/app"),
		pkg("audit"),
		pkg("platform/pg", "workspace/app"),
		pkg("platform/logx", "platform/pg"),
		pkg("internal/contract/apierr", "billing/app"),
		pkg("authz", "workspace/app"),
		pkg("authorization", "authz"),
		pkg("contractx", "billing/app"),
	})
	want := map[string][]string{
		"A1": {"platform/pg -> workspace", "platform/logx -> workspace"},
		"A2": {"quota -> identity"},
		"A3": {"billing -> workspace", "quota -> identity"},
		"A4": {"internal/contract/apierr -> billing", "internal/contract/apierr -> workspace"},
		"A5": {"authz -> workspace"},
		"A6": {"authorization -> authz", "authorization -> workspace"},
		"A7": {"contractx -> billing", "contractx -> workspace"},
	}

	known := map[string]bool{}
	for _, r := range rules {
		known[r.id] = true
	}
	for id := range want {
		if !known[id] {
			t.Errorf("规则表缺少金样要求的规则 %s——新规则必须与金样同步落地", id)
		}
	}

	got := map[string][]string{}
	for _, r := range rules {
		if _, ok := want[r.id]; !ok {
			t.Errorf("规则 %s 未登记金样期望——新规则必须同步补金样，防止守护者静默失效", r.id)
			continue
		}
		for _, v := range violationsOf(r, g, g.adj) {
			got[r.id] = append(got[r.id], v.arrow)
		}
	}
	for id, wantArrows := range want {
		sort.Strings(wantArrows)
		gotArrows := append([]string(nil), got[id]...)
		sort.Strings(gotArrows)
		if !reflect.DeepEqual(gotArrows, wantArrows) {
			t.Errorf("[%s] 合成图违规检出与金样不符：\n  got  %v\n  want %v", id, gotArrows, wantArrows)
		}
	}
}

func TestRulesCleanOnHealthyGraph(t *testing.T) {
	g := canaryGraph([]*pkgInfo{
		pkg("identity/app", "platform/pg", "authz"),
		pkg("platform/pg"),
		pkg("authz", "platform/webx"),
		pkg("platform/webx", "internal/contract/apierr"),
		pkg("internal/contract/apierr"),
		pkg("authorization"),
		pkg("contractx"),
	})
	for _, r := range rules {
		for _, v := range violationsOf(r, g, g.adj) {
			t.Errorf("[%s] 健康图上误报：%s  %s  |  %s", v.id, v.loc, v.arrow, r.desc)
		}
	}
}

func TestExemptGraphAppliesOnlyToA2A3(t *testing.T) {
	g := canaryGraph([]*pkgInfo{
		pkg("quota/app", "identity/app"),
		pkg("identity/app"),
		pkg("contractx", "billing/app"),
		pkg("billing/app"),
	})
	allow := []allowEntry{
		{from: "quota/app", to: "identity/app"},
		{from: "contractx", to: "billing/app"},
	}
	a2 := ruleByID("A2")
	if vs := violationsOf(a2, g, edgesForRule(a2, g, allow)); len(vs) != 0 {
		for _, v := range vs {
			t.Errorf("[A2] 已豁免的边（quota -> identity）不应再报违规：%s  %s", v.loc, v.arrow)
		}
	}
	a7 := ruleByID("A7")
	if vs := violationsOf(a7, g, edgesForRule(a7, g, allow)); len(vs) == 0 {
		t.Error("[A7] 豁免不得对 A2/A3 之外的规则生效：contractx -> billing 应照常报违规")
	}
}

func TestExemptEdgeMachinery(t *testing.T) {
	g := canaryGraph([]*pkgInfo{
		pkg("admin/app", "audit"),
		pkg("admin/app2", "audit"),
		pkg("audit"),
		pkg("notify"),
	})
	valid := allowEntry{from: "admin", to: "audit"}
	if !g.hasCoveredEdge(valid) {
		t.Error("hasCoveredEdge：现存边未被识别为已覆盖")
	}
	if g.hasCoveredEdge(allowEntry{from: "admin", to: "notify"}) {
		t.Error("hasCoveredEdge：图中不存在的边不应判为已覆盖（陈旧检测依赖此语义）")
	}

	exempt := exemptEdgeSet(g, []allowEntry{valid})
	if !exempt[edgeKey("admin/app", "audit")] || !exempt[edgeKey("admin/app2", "audit")] {
		t.Error("exemptEdgeSet：from 子树匹配的边应全部进入豁免集")
	}
	if exempt[edgeKey("admin/app", "notify")] {
		t.Error("exemptEdgeSet：未豁免的边不得进入豁免集")
	}
	if reduced := g.reducedAdj(exempt); len(reduced["admin/app"]) != 0 || len(reduced["admin/app2"]) != 0 {
		t.Error("reducedAdj：豁免边应从图中移除")
	}
}

func TestDomainOfInTreeSegmentMatching(t *testing.T) {
	for _, c := range []struct{ rel, want string }{
		{"identity", "identity"},
		{"identity/app", "identity"},
		{"workspaces", ""},
		{"workspace2/app", ""},
		{"platform/pg", ""},
		{"authorization", ""},
		{"authz", ""},
		{"", ""},
	} {
		if got := domainOf(c.rel); got != c.want {
			t.Errorf("domainOf(%q) = %q, want %q", c.rel, got, c.want)
		}
	}
	for _, c := range []struct {
		rel, prefix string
		want        bool
	}{
		{"admin", "admin", true},
		{"admin/app", "admin", true},
		{"administrator", "admin", false},
		{"adminx/app", "admin", false},
		{"authorization", "authz", false},
	} {
		if got := inTree(c.rel, c.prefix); got != c.want {
			t.Errorf("inTree(%q, %q) = %v, want %v", c.rel, c.prefix, got, c.want)
		}
	}
}

func TestAllowlistEntryLegitimacy(t *testing.T) {
	entries := []allowEntry{
		{from: "admin", to: "audit"},
		{from: "admin/app", to: "audit/app"},
		{from: "identity", to: "platform/pg"},
		{from: "platform/pg", to: "audit"},
		{from: "authorization", to: "authz"},
	}
	want := []allowEntry{entries[2], entries[3], entries[4]}
	got := nonBusinessAllowEntries(entries)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("nonBusinessAllowEntries 检出与金样不符：\n  got  %+v\n  want %+v", got, want)
	}
}
