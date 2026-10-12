package devx

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/haozing/ploykit/platform/logring"
	"github.com/haozing/ploykit/platform/webx"
)

// RegisterTools installs the devx built-in tools on an MCP server. Products
// call this from their mcpx register callback with the same Deps instance
// Mount received, so both surfaces (HTTP /dev/* and MCP tools) share one
// service layer and stay behaviorally identical.
//
// Scope enforcement: the mount gates /mcp with webx.Authenticate; in
// stateless mode the HTTP request context (principal included) is the tool
// handler's ctx, so tools re-check the caller's PAT scope exactly like the
// HTTP routes do via webx.RequireScope — session callers pass, PAT callers
// must carry dev:observe / dev:operate.
func RegisterTools(s *mcp.Server, deps *Deps) {
	type logsIn struct {
		RequestID string `json:"request_id" jsonschema:"request id to fetch logs for; omit for the recent global tail"`
		Level     string `json:"level,omitempty" jsonschema:"minimum level filter: debug|info|warn|error (default: all)"`
		Limit     int    `json:"limit,omitempty" jsonschema:"max entries to return (default 100)"`
	}
	mcp.AddTool(s, &mcp.Tool{
		Name: "tail_request_logs",
		Description: "Fetch the log records captured for one failed request by its request id, or the recent global tail when request_id is omitted. " +
			"This is the fastest way to see what happened behind an error response: the response body of a failed API call carries X-Request-Id, pass it here.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in logsIn) (*mcp.CallToolResult, any, error) {
		if err := requireToolScope(ctx, ScopeObserve); err != nil {
			return nil, nil, err
		}
		if !deps.Logs.Available() {
			return textResult(map[string]any{"enabled": false, "hint": "log capture is not enabled (logring not wired)"}), nil, nil
		}
		level, err := parseLevelParam(in.Level)
		if err != nil {
			return toolError("invalid level (debug|info|warn|error)"), nil, nil
		}
		var entries []logring.Entry
		if in.RequestID != "" {
			entries = deps.Logs.ByRequestID(in.RequestID, level, in.Limit)
		} else {
			entries = deps.Logs.Tail(level, in.Limit)
		}
		if entries == nil {
			entries = []logring.Entry{}
		}
		return textResult(map[string]any{"request_id": in.RequestID, "entries": entries}), nil, nil
	})

	type jobsIn struct {
		State string `json:"state,omitempty" jsonschema:"filter by job state: available|cancelled|completed|discarded|pending|retryable|running|scheduled. Use \"discarded\" for jobs that exhausted retries."`
		Queue string `json:"queue,omitempty" jsonschema:"filter by queue name"`
		Kind  string `json:"kind,omitempty" jsonschema:"filter by job kind"`
		Limit int    `json:"limit,omitempty" jsonschema:"max jobs to return (default 50)"`
	}
	mcp.AddTool(s, &mcp.Tool{
		Name: "list_failed_jobs",
		Description: "List background jobs (river) by state — the entry point for 'something in the queue is failing'. " +
			"Returns id, kind, queue, state, attempt counters and the last attempt errors per job.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in jobsIn) (*mcp.CallToolResult, any, error) {
		if err := requireToolScope(ctx, ScopeObserve); err != nil {
			return nil, nil, err
		}
		if !deps.Jobs.Available() {
			return textResult(map[string]any{"enabled": false, "hint": "job inspection is not enabled (events not wired)"}), nil, nil
		}
		jobs, err := deps.Jobs.List(ctx, in.State, in.Queue, in.Kind, in.Limit)
		if err != nil {
			return toolError(err.Error()), nil, nil
		}
		if jobs == nil {
			jobs = []JobSummary{}
		}
		return textResult(map[string]any{"jobs": jobs}), nil, nil
	})

	type jobIDIn struct {
		ID int64 `json:"id" jsonschema:"numeric job id (from list_failed_jobs)"`
	}
	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_job",
		Description: "Fetch one background job by id, including its full arguments payload — use after list_failed_jobs to understand what a failing job was trying to do.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in jobIDIn) (*mcp.CallToolResult, any, error) {
		if err := requireToolScope(ctx, ScopeObserve); err != nil {
			return nil, nil, err
		}
		if !deps.Jobs.Available() {
			return textResult(map[string]any{"enabled": false}), nil, nil
		}
		job, err := deps.Jobs.Get(ctx, in.ID)
		if err != nil {
			return toolError(err.Error()), nil, nil
		}
		return textResult(job), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "retry_job",
		Description: "Schedule an immediate retry of a background job. Use after inspecting get_job; running jobs are left untouched.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in jobIDIn) (*mcp.CallToolResult, any, error) {
		if err := requireToolScope(ctx, ScopeOperate); err != nil {
			return nil, nil, err
		}
		if !deps.Jobs.Available() {
			return textResult(map[string]any{"enabled": false}), nil, nil
		}
		if err := deps.Jobs.Retry(ctx, in.ID); err != nil {
			return toolError(err.Error()), nil, nil
		}
		deps.audit(nil, "devx.job.retry", strconv.FormatInt(in.ID, 10))
		return textResult(map[string]any{"id": in.ID, "action": "retry"}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "cancel_job",
		Description: "Cancel a background job: queued jobs immediately, running jobs cooperatively (the worker observes context cancellation). Already-finalized jobs error.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in jobIDIn) (*mcp.CallToolResult, any, error) {
		if err := requireToolScope(ctx, ScopeOperate); err != nil {
			return nil, nil, err
		}
		if !deps.Jobs.Available() {
			return textResult(map[string]any{"enabled": false}), nil, nil
		}
		if err := deps.Jobs.Cancel(ctx, in.ID); err != nil {
			return toolError(err.Error()), nil, nil
		}
		deps.audit(nil, "devx.job.cancel", strconv.FormatInt(in.ID, 10))
		return textResult(map[string]any{"id": in.ID, "action": "cancel"}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "run_doctor",
		Description: "Run the boot self-diagnostics and return pass/fail per check with fix hints. Diagnoses the classic wiring failures (job queue schema not migrated, secrets encryption key missing, shutdown window misaligned, health checks without probes).",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		if err := requireToolScope(ctx, ScopeObserve); err != nil {
			return nil, nil, err
		}
		if deps.Doctor == nil {
			return textResult(map[string]any{"enabled": false, "hint": "doctor not configured"}), nil, nil
		}
		return textResult(deps.Doctor.RunDoctor(ctx, 0)), nil, nil
	})
}

// requireToolScope mirrors webx.RequireScope for tool handlers: only PAT
// principals are scope-bounded; sessions pass (role checks stay with the
// product). The stateless transport carries the Authenticate-installed
// principal in ctx.
func requireToolScope(ctx context.Context, scope string) error {
	p := webx.PrincipalFrom(ctx)
	if p == nil || p.Source != webx.SourcePAT {
		return nil
	}
	if !p.Scope.Allows(scope) {
		return fmt.Errorf("%w: PAT scope does not include %s", ErrScopeDenied, scope)
	}
	return nil
}

func textResult(v any) *mcp.CallToolResult {
	b, _ := json.Marshal(v)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}
}

func toolError(msg string) *mcp.CallToolResult {
	b, _ := json.Marshal(map[string]any{"error": msg})
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}
}
