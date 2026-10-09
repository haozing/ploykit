package contractx

import (
	"os"
	"strings"
	"testing"
)

func catalogFixture() []Entry {
	return []Entry{
		{
			ID: "listTasks",
			Attributes: map[string][]string{
				"transport":         {"http"},
				"http_method":       {"GET"},
				"path":              {"/api/workspaces/{workspaceId}/tasks"},
				"response_contract": {"TaskListDTO"},
			},
		},
		{
			ID: "createTask",
			Attributes: map[string][]string{
				"transport":         {"http"},
				"http_method":       {"POST"},
				"path":              {"/api/workspaces/{workspaceId}/tasks"},
				"response_contract": {"TaskDTO"},
			},
		},
		{
			ID: "getTask",
			Attributes: map[string][]string{
				"transport":         {"http"},
				"http_method":       {"GET"},
				"path":              {"/api/workspaces/{workspaceId}/tasks/{taskId}"},
				"response_contract": {"TaskDTO"},
			},
		},
		{
			ID: "deleteTask",
			Attributes: map[string][]string{
				"transport":         {"http"},
				"http_method":       {"DELETE"},
				"path":              {"/api/workspaces/{workspaceId}/tasks/{taskId}"},
				"response_contract": {"NoContent"},
			},
		},
		{

			ID: "runNightlyRollup",
			Attributes: map[string][]string{
				"transport":         {"internal"},
				"response_contract": {"NoContent"},
			},
		},
	}
}

func routeTableFixture() []RouteSpec {
	return []RouteSpec{
		NewRouteSpec("get", "/api/workspaces/{workspaceId}/tasks", "listTasks"),
		NewRouteSpec("post", "/api/workspaces/{workspaceId}/tasks", "createTask"),
		NewRouteSpec("GET", "/api/workspaces/{workspaceId}/tasks/{taskId}", "getTask"),
		NewRouteSpec("DELETE", "/api/workspaces/{workspaceId}/tasks/{taskId}", "deleteTask"),
	}
}

func mustOpenAPIRoutes(t *testing.T, path string) []RouteSpec {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	routes, err := ParseOpenAPIRoutes(data)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return routes
}

func TestThreeWayClean(t *testing.T) {
	catalogRoutes, err := EntryRoutes(catalogFixture())
	if err != nil {
		t.Fatalf("EntryRoutes: %v", err)
	}
	if len(catalogRoutes) != 4 {
		t.Fatalf("catalog routes = %d, want 4 (internal entry skipped): %+v", len(catalogRoutes), catalogRoutes)
	}
	report, err := Compare(
		Side{Name: "catalog", Routes: catalogRoutes},
		Side{Name: "routes", Routes: routeTableFixture()},
		Side{Name: "openapi", Routes: mustOpenAPIRoutes(t, "testdata/openapi.yaml")},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if !report.Empty() {
		t.Fatalf("expected clean three-way compare, got:\n%s", report)
	}
	if !strings.HasPrefix(report.String(), "OK: 3 side(s) agree") {
		t.Fatalf("unexpected OK summary: %s", report.String())
	}
}

func TestThreeWayDriftFixture(t *testing.T) {
	catalogRoutes, err := EntryRoutes(catalogFixture())
	if err != nil {
		t.Fatalf("EntryRoutes: %v", err)
	}
	report, err := Compare(
		Side{Name: "catalog", Routes: catalogRoutes},
		Side{Name: "routes", Routes: routeTableFixture()},
		Side{Name: "openapi", Routes: mustOpenAPIRoutes(t, "testdata/openapi_drift.yaml")},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(report.Diffs) != 2 {
		t.Fatalf("expected exactly 2 diffs, got %d:\n%s", len(report.Diffs), report)
	}
	var methodDiff, missingDiff *Diff
	for i := range report.Diffs {
		switch report.Diffs[i].Kind {
		case DiffMethodMismatch:
			methodDiff = &report.Diffs[i]
		case DiffMissing:
			missingDiff = &report.Diffs[i]
		}
	}
	if methodDiff == nil || missingDiff == nil {
		t.Fatalf("expected one method-mismatch and one missing diff:\n%s", report)
	}
	if methodDiff.Path != "/api/workspaces/{workspaceId}/tasks/{taskId}" {
		t.Errorf("method diff path = %q", methodDiff.Path)
	}

	if methodDiff.Methods["catalog"] != "DELETE,GET" ||
		methodDiff.Methods["routes"] != "DELETE,GET" ||
		methodDiff.Methods["openapi"] != "GET,POST" {
		t.Errorf("method diff methods = %v", methodDiff.Methods)
	}
	if missingDiff.Method != "GET" || missingDiff.Path != "/api/workspaces/{workspaceId}/tasks/{taskId}/comments" {
		t.Errorf("missing diff route = %s %s", missingDiff.Method, missingDiff.Path)
	}
	if strings.Join(missingDiff.PresentIn, ",") != "openapi" {
		t.Errorf("missing diff present in = %v", missingDiff.PresentIn)
	}
	if strings.Join(missingDiff.MissingIn, ",") != "catalog,routes" {
		t.Errorf("missing diff missing in = %v", missingDiff.MissingIn)
	}
}

func TestCompareMissingRoute(t *testing.T) {
	routes := routeTableFixture()

	routes = routes[:2]
	report, err := Compare(
		Side{Name: "catalog", Routes: routeTableFixture()},
		Side{Name: "routes", Routes: routes},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(report.Diffs) != 2 || report.Diffs[0].Kind != DiffMissing || report.Diffs[1].Kind != DiffMissing {
		t.Fatalf("expected two missing diffs, got:\n%s", report)
	}
	for _, diff := range report.Diffs {
		if diff.Path != "/api/workspaces/{workspaceId}/tasks/{taskId}" {
			t.Errorf("diff path = %q", diff.Path)
		}
		if strings.Join(diff.MissingIn, ",") != "routes" {
			t.Errorf("missing in = %v", diff.MissingIn)
		}
	}
}

func TestCompareExtraRoute(t *testing.T) {
	extra := append(routeTableFixture(), NewRouteSpec("PUT", "/api/extra", ""))
	report, err := Compare(
		Side{Name: "catalog", Routes: routeTableFixture()},
		Side{Name: "routes", Routes: extra},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(report.Diffs) != 1 || report.Diffs[0].Kind != DiffMissing {
		t.Fatalf("expected one missing diff, got:\n%s", report)
	}
	diff := report.Diffs[0]
	if strings.Join(diff.PresentIn, ",") != "routes" || strings.Join(diff.MissingIn, ",") != "catalog" {
		t.Errorf("present=%v missing=%v", diff.PresentIn, diff.MissingIn)
	}
}

func TestCompareMethodMismatch(t *testing.T) {
	catalog := []RouteSpec{NewRouteSpec("DELETE", "/api/things/{id}", "deleteThing")}
	openapi := []RouteSpec{NewRouteSpec("POST", "/api/things/{id}", "deleteThing")}
	report, err := Compare(
		Side{Name: "catalog", Routes: catalog},
		Side{Name: "openapi", Routes: openapi},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}

	if len(report.Diffs) != 1 || report.Diffs[0].Kind != DiffMethodMismatch {
		t.Fatalf("expected single method-mismatch, got:\n%s", report)
	}
	diff := report.Diffs[0]
	if diff.Methods["catalog"] != "DELETE" || diff.Methods["openapi"] != "POST" {
		t.Errorf("methods = %v", diff.Methods)
	}
}

func TestCompareParamNameMismatch(t *testing.T) {
	catalog := []RouteSpec{NewRouteSpec("GET", "/api/tasks/{taskId}", "getTask")}
	routes := []RouteSpec{NewRouteSpec("GET", "/api/tasks/{taskId}", "")}
	openapi := []RouteSpec{NewRouteSpec("GET", "/api/tasks/{id}", "getTask")}
	report, err := Compare(
		Side{Name: "catalog", Routes: catalog},
		Side{Name: "routes", Routes: routes},
		Side{Name: "openapi", Routes: openapi},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(report.Diffs) != 1 || report.Diffs[0].Kind != DiffParamNameMismatch {
		t.Fatalf("expected single param-name-mismatch, got:\n%s", report)
	}
	diff := report.Diffs[0]
	if diff.Path != "/api/tasks/{}" {
		t.Errorf("skeleton path = %q", diff.Path)
	}
	if diff.Paths["openapi"] != "/api/tasks/{id}" || diff.Paths["catalog"] != "/api/tasks/{taskId}" {
		t.Errorf("paths = %v", diff.Paths)
	}
	if diff.MissingIn != nil {
		t.Errorf("param diffs must not carry missing_in: %v", diff.MissingIn)
	}
}

func TestCompareOperationIDMismatch(t *testing.T) {
	catalog := []RouteSpec{NewRouteSpec("GET", "/api/tasks", "listTasks")}
	routes := []RouteSpec{NewRouteSpec("GET", "/api/tasks", "")}
	openapi := []RouteSpec{NewRouteSpec("GET", "/api/tasks", "listTaskV2")}
	report, err := Compare(
		Side{Name: "catalog", Routes: catalog},
		Side{Name: "routes", Routes: routes},
		Side{Name: "openapi", Routes: openapi},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(report.Diffs) != 1 || report.Diffs[0].Kind != DiffOperationIDMismatch {
		t.Fatalf("expected single operation-id-mismatch, got:\n%s", report)
	}
	diff := report.Diffs[0]
	if diff.OperationIDs["catalog"] != "listTasks" || diff.OperationIDs["openapi"] != "listTaskV2" {
		t.Errorf("operation ids = %v", diff.OperationIDs)
	}
	if _, has := diff.OperationIDs["routes"]; has {
		t.Errorf("sides without operation IDs must be omitted: %v", diff.OperationIDs)
	}
}

func TestCompareDuplicate(t *testing.T) {
	duplicated := []RouteSpec{
		NewRouteSpec("GET", "/api/tasks", "listTasks"),
		NewRouteSpec("get", "/api/tasks", "listTasksAlias"),
		NewRouteSpec("POST", "/api/tasks", "createTask"),
	}
	other := []RouteSpec{
		NewRouteSpec("GET", "/api/tasks", "listTasks"),
		NewRouteSpec("POST", "/api/tasks", "createTask"),
	}
	report, err := Compare(
		Side{Name: "catalog", Routes: duplicated},
		Side{Name: "openapi", Routes: other},
	)
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(report.Diffs) != 1 || report.Diffs[0].Kind != DiffDuplicate {
		t.Fatalf("expected single duplicate diff, got:\n%s", report)
	}
	diff := report.Diffs[0]
	if strings.Join(diff.Sides, ",") != "catalog" {
		t.Errorf("duplicate sides = %v", diff.Sides)
	}
	if !strings.Contains(diff.Detail, "listTasks") || !strings.Contains(diff.Detail, "listTasksAlias") {
		t.Errorf("duplicate detail must name both claims: %s", diff.Detail)
	}
}

func TestCompareDeterministicOrdering(t *testing.T) {
	catalog := []RouteSpec{
		NewRouteSpec("GET", "/b", ""),
		NewRouteSpec("GET", "/a", ""),
		NewRouteSpec("POST", "/a", ""),
	}
	routes := []RouteSpec{NewRouteSpec("GET", "/a", "")}
	first, err := Compare(Side{Name: "catalog", Routes: catalog}, Side{Name: "routes", Routes: routes})
	if err != nil {
		t.Fatalf("first compare: %v", err)
	}
	second, err := Compare(Side{Name: "catalog", Routes: catalog}, Side{Name: "routes", Routes: routes})
	if err != nil {
		t.Fatalf("second compare: %v", err)
	}
	if first.String() != second.String() {
		t.Fatalf("equal inputs produced different reports:\n%s\nvs\n%s", first, second)
	}
}

func TestCompareValidation(t *testing.T) {
	if _, err := Compare(Side{Name: "only", Routes: nil}); err == nil || !strings.Contains(err.Error(), "at least two sides") {
		t.Fatalf("single side not rejected: %v", err)
	}
	if _, err := Compare(); err == nil || !strings.Contains(err.Error(), "at least two sides") {
		t.Fatalf("zero sides not rejected: %v", err)
	}
	if _, err := Compare(Side{Name: "a"}, Side{Name: " "}); err == nil || !strings.Contains(err.Error(), "blank name") {
		t.Fatalf("blank side name not rejected: %v", err)
	}
	if _, err := Compare(Side{Name: "a"}, Side{Name: "a"}); err == nil || !strings.Contains(err.Error(), "duplicate side name") {
		t.Fatalf("duplicate side name not rejected: %v", err)
	}
	if _, err := Compare(
		Side{Name: "a", Routes: []RouteSpec{{Method: "GET", Path: ""}}},
		Side{Name: "b"},
	); err == nil || !strings.Contains(err.Error(), "blank method or path") {
		t.Fatalf("blank route not rejected: %v", err)
	}
}

func TestEntryRoutes(t *testing.T) {
	routes, err := EntryRoutes(catalogFixture())
	if err != nil {
		t.Fatalf("EntryRoutes: %v", err)
	}
	if len(routes) != 4 {
		t.Fatalf("routes = %d, want 4: %+v", len(routes), routes)
	}

	want := map[string]bool{
		"GET /api/workspaces/{workspaceId}/tasks":             true,
		"POST /api/workspaces/{workspaceId}/tasks":            true,
		"GET /api/workspaces/{workspaceId}/tasks/{taskId}":    true,
		"DELETE /api/workspaces/{workspaceId}/tasks/{taskId}": true,
	}
	got := make(map[string]bool, len(routes))
	for _, route := range routes {
		got[route.Method+" "+route.Path] = true
	}
	for route := range want {
		if !got[route] {
			t.Errorf("missing route %s", route)
		}
	}
}

func TestEntryRoutesErrors(t *testing.T) {
	cases := []struct {
		name    string
		entries []Entry
		wantErr string
	}{
		{
			name:    "method without path",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"http_method": {"GET"}}}},
			wantErr: "is missing",
		},
		{
			name:    "path without method",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"path": {"/x"}}}},
			wantErr: "is missing",
		},
		{
			name:    "non-http transport carrying route attributes",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"transport": {"internal"}, "http_method": {"GET"}, "path": {"/x"}}}},
			wantErr: "carries route attributes",
		},
		{
			name:    "multi-valued method",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"http_method": {"GET", "POST"}, "path": {"/x"}}}},
			wantErr: "must be single-valued",
		},
		{
			name:    "multi-valued path",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"http_method": {"GET"}, "path": {"/x", "/y"}}}},
			wantErr: "must be single-valued",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := EntryRoutes(tc.entries)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tc.wantErr)
			}
		})
	}
}
