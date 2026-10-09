package contractx

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseOpenAPIYAML(t *testing.T) {
	routes := mustOpenAPIRoutes(t, "testdata/openapi.yaml")
	want := []RouteSpec{
		{Method: "GET", Path: "/api/workspaces/{workspaceId}/tasks", OperationID: "listTasks"},
		{Method: "POST", Path: "/api/workspaces/{workspaceId}/tasks", OperationID: "createTask"},
		{Method: "DELETE", Path: "/api/workspaces/{workspaceId}/tasks/{taskId}", OperationID: "deleteTask"},
		{Method: "GET", Path: "/api/workspaces/{workspaceId}/tasks/{taskId}", OperationID: "getTask"},
	}
	if !reflect.DeepEqual(routes, want) {
		t.Fatalf("routes = %+v, want %+v", routes, want)
	}
}

func TestParseOpenAPIJSON(t *testing.T) {
	fromJSON := mustOpenAPIRoutes(t, "testdata/openapi.json")
	fromYAML := mustOpenAPIRoutes(t, "testdata/openapi.yaml")
	if !reflect.DeepEqual(fromJSON, fromYAML) {
		t.Fatalf("JSON and YAML fixtures disagree:\njson:  %+v\nyaml:  %+v", fromJSON, fromYAML)
	}
}

func TestParseOpenAPIErrors(t *testing.T) {
	cases := []struct {
		name    string
		document string
		wantErr string
	}{
		{
			name:     "no paths",
			document: "info:\n  title: x\n",
			wantErr:  "no paths object",
		},
		{
			name:     "paths wrong type",
			document: "paths: 7\n",
			wantErr:  "paths is not an object",
		},
		{
			name:     "path without leading slash",
			document: "paths:\n  webhooks:\n    get:\n      operationId: x\n",
			wantErr:  "does not start with '/'",
		},
		{
			name:     "malformed yaml",
			document: "paths: [unclosed\n",
			wantErr:  "decode openapi document",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseOpenAPIRoutes([]byte(tc.document))
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestParseOpenAPIIgnoresNonMethodKeys(t *testing.T) {
	document := `openapi: 3.1.0
paths:
  /api/ping:
    parameters:
      - name: x
        in: query
    x-vendor-note: hello
    summary: ping
    get:
      operationId: ping
      responses:
        "200":
          description: ok
`
	routes, err := ParseOpenAPIRoutes([]byte(document))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(routes) != 1 || routes[0].Method != "GET" || routes[0].OperationID != "ping" {
		t.Fatalf("routes = %+v", routes)
	}
}
