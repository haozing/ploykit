// Package mcpx is the mountable MCP (Model Context Protocol) server kernel:
// it turns a product's app into an agent-operable control plane by exposing
// intent-level tools over the streamable-HTTP MCP transport.
//
// The mount is env-gated and silent by default (same contract as
// platform/metrics): with Enabled=false the mount is inert and the port
// disappears. Auth is NOT built in — mount the handler behind
// webx.Authenticate + webx.RequireScope so PAT callers are scoped and browser
// sessions can be excluded (or allowed) per product policy. See
// docs/adr/0014-agent-eyes-and-hands.md for the shape rationale: ploykit is a
// framework, so "the framework's MCP server" is a component mounted into each
// product's app, not a hosted service; agents connect to the product app they
// are developing.
package mcpx

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Config gates and shapes the mount.
type Config struct {
	// Enabled gates the whole surface. nil counts as false (silent
	// degradation); the mount returns an inert 404 handler instead of a
	// live endpoint.
	Enabled *bool
	// Path is the mount point. Defaults to "/mcp".
	Path string
	// ServerName/ServerVersion identify the MCP server in initialize.
	// Defaults: "ploykit" and "0.0.0-dev".
	ServerName    string
	ServerVersion string
}

// Mount is the assembled MCP surface. Mount it on the shared mux with
// .Handler() at .Path(), and gate it with auth middleware before serving.
type Mount struct {
	path   string
	server *mcp.Server
	get    func(*http.Request) *mcp.Server

	mu       sync.Mutex
	inner    http.Handler // lazily built streamable handler
	disabled bool
}

// NewMount assembles the mount. tools registers the built-in tools (each
// product adds its own via Mount.Server() before serving traffic — tool
// registration must happen before the first session, or rely on the SDK's
// tools/list_changed notification).
func NewMount(cfg Config, register func(s *mcp.Server)) *Mount {
	enabled := cfg.Enabled != nil && *cfg.Enabled
	path := cfg.Path
	if path == "" {
		path = "/mcp"
	}
	name := cfg.ServerName
	if name == "" {
		name = "ploykit"
	}
	version := cfg.ServerVersion
	if version == "" {
		version = "0.0.0-dev"
	}
	m := &Mount{path: path, disabled: !enabled}
	if !enabled {
		return m
	}
	server := mcp.NewServer(&mcp.Implementation{
		Name:    name,
		Version: version,
	}, nil)
	if register != nil {
		register(server)
	}
	m.server = server
	m.get = func(*http.Request) *mcp.Server { return server }
	return m
}

// Path is the configured mount point (always non-empty, even when disabled,
// so wiring code can mux.Handle unconditionally).
func (m *Mount) Path() string { return m.path }

// Handler serves the MCP streamable-HTTP endpoint. When the mount is disabled
// it answers 404 (like metrics' token gate — indistinguishable from a missing
// route).
//
// The endpoint runs in Stateless mode: every POST is self-contained, so the
// product's HTTP middleware chain (Authenticate, RequireScope) evaluates the
// caller on every request and context values it installs (Principal,
// request id) flow into tool handlers — the sessionful transport would only
// carry headers. That is the right shape for a control plane embedded in a
// product app: no session affinity, no server-side session state, auth
// semantics identical to the product's other API routes.
func (m *Mount) Handler() http.Handler {
	if m.disabled {
		return http.HandlerFunc(http.NotFound)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.inner == nil {
		m.inner = mcp.NewStreamableHTTPHandler(m.get, &mcp.StreamableHTTPOptions{Stateless: true})
	}
	return m.inner
}

// Server exposes the underlying SDK server so the product (or framework
// packages like devx) can register additional tools with mcp.AddTool. Panics
// when the mount is disabled — calling it is a wiring bug, not a runtime
// condition.
func (m *Mount) Server() *mcp.Server {
	if m.disabled || m.server == nil {
		panic("mcpx: Server() on a disabled mount; check Config.Enabled at wiring time")
	}
	return m.server
}

// ToolResultText builds a plain-text tool result. Errors inside tool handlers
// should return (nil, out, err) and let the SDK pack them as tool errors;
// this helper is for the success path where the caller has a formatted string
// (e.g. JSON) to hand back.
func ToolResultText(s string) (*mcp.CallToolResult, error) {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: s}}}, nil
}

// RawArgs is a convenience for raw-schema tools: unmarshal the request's raw
// arguments into a typed struct. Used by framework-internal tools whose input
// shape is declared via a hand-written JSON schema.
func RawArgs(req *mcp.CallToolRequest, into any) error {
	if len(req.Params.Arguments) == 0 {
		return nil
	}
	if err := json.Unmarshal(req.Params.Arguments, into); err != nil {
		return fmt.Errorf("invalid arguments: %w", err)
	}
	return nil
}
