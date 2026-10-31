package mcpx_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/mcpx"
)

func boolPtr(b bool) *bool { return &b }

func newTestMount(t *testing.T, enabled bool) *mcpx.Mount {
	t.Helper()
	return mcpx.NewMount(mcpx.Config{Enabled: boolPtr(enabled)}, func(s *mcp.Server) {
		type echoIn struct {
			Message string `json:"message" jsonschema:"text to echo"`
		}
		type echoOut struct {
			Echo string `json:"echo"`
		}
		mcp.AddTool(s, &mcp.Tool{Name: "echo", Description: "echo the message"}, func(ctx context.Context, req *mcp.CallToolRequest, in echoIn) (*mcp.CallToolResult, echoOut, error) {
			return nil, echoOut{Echo: in.Message}, nil
		})
	})
}

func TestMcpx_EnabledEndToEnd(t *testing.T) {
	m := newTestMount(t, true)
	srv := httptest.NewServer(m.Handler())
	defer srv.Close()

	ctx := context.Background()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "0"}, nil)
	tr := &mcp.StreamableClientTransport{Endpoint: srv.URL}
	session, err := client.Connect(ctx, tr, nil)
	require.NoError(t, err)
	defer session.Close()

	// initialize happened during Connect; the server must be the configured one.
	init := session.InitializeResult()
	assert.Equal(t, "ploykit", init.ServerInfo.Name)

	// tools/list sees the product-registered tool.
	tools, err := session.ListTools(ctx, nil)
	require.NoError(t, err)
	names := []string{}
	for _, tl := range tools.Tools {
		names = append(names, tl.Name)
	}
	assert.Contains(t, names, "echo")

	// tools/call round-trips through the typed schema.
	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "echo", Arguments: map[string]any{"message": "hi"}})
	require.NoError(t, err)
	require.NotEmpty(t, res.Content)
	txt, ok := res.Content[0].(*mcp.TextContent)
	require.True(t, ok, "first content block must be text, got %T", res.Content[0])
	var out struct {
		Echo string `json:"echo"`
	}
	require.NoError(t, json.Unmarshal([]byte(txt.Text), &out))
	assert.Equal(t, "hi", out.Echo)
	assert.False(t, res.IsError)
}

func TestMcpx_DisabledIsInert404(t *testing.T) {
	m := newTestMount(t, false)
	assert.Equal(t, "/mcp", m.Path(), "path stays non-empty for unconditional wiring")

	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)

	assert.Panics(t, func() { m.Server() }, "Server() on a disabled mount is a wiring bug")
}

func TestMcpx_DefaultsAndCustomPath(t *testing.T) {
	yes := boolPtr(true)
	m := mcpx.NewMount(mcpx.Config{Enabled: yes}, nil)
	assert.Equal(t, "/mcp", m.Path())

	m2 := mcpx.NewMount(mcpx.Config{Enabled: yes, Path: "/agent-mcp", ServerName: "myproduct", ServerVersion: "1.2.3"}, nil)
	assert.Equal(t, "/agent-mcp", m2.Path())
	assert.NotNil(t, m2.Server())

	// nil Enabled counts as disabled.
	m3 := mcpx.NewMount(mcpx.Config{}, nil)
	rec := httptest.NewRecorder()
	m3.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestMcpx_RawArgsHelper(t *testing.T) {
	m := mcpx.NewMount(mcpx.Config{Enabled: boolPtr(true)}, func(s *mcp.Server) {
		var in struct {
			RequestID string `json:"request_id"`
		}
		mcp.AddTool(s, &mcp.Tool{
			Name:        "raw_tool",
			Description: "declares its schema by hand",
			InputSchema: &jsonschemaObject,
		}, func(ctx context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, struct{}, error) {
			require.NoError(t, mcpx.RawArgs(req, &in))
			res, err := mcpx.ToolResultText("got:" + in.RequestID)
			return res, struct{}{}, err
		})
	})
	srv := httptest.NewServer(m.Handler())
	defer srv.Close()

	ctx := context.Background()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: srv.URL}, nil)
	require.NoError(t, err)
	defer session.Close()

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "raw_tool", Arguments: map[string]any{"request_id": "abc"}})
	require.NoError(t, err)
	require.NotEmpty(t, res.Content)
	txt := res.Content[0].(*mcp.TextContent)
	assert.Equal(t, "got:abc", txt.Text)
}

// hand-written object schema for the raw-tool path.
var jsonschemaObject = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"request_id": map[string]any{"type": "string", "description": "request id to look up"},
	},
	"required": []string{"request_id"},
}
