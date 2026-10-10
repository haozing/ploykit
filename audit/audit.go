package audit

import (
	"context"
	"encoding/csv"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/platform/webx"
)

type Recorder struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func NewRecorder(pool *pgxpool.Pool, log *slog.Logger) *Recorder {
	if log == nil {
		log = slog.Default()
	}
	return &Recorder{pool: pool, log: log}
}

// execer abstracts the shared write surface of pool and tx so Record /
// RecordTx keep one SQL source of truth.
type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// RecordTx writes the audit entry inside the caller's transaction: failures
// return an error (the caller decides whether to roll back) - no swallowing,
// no detaching from the caller's ctx (opposite of Record's fire-and-forget).
// Product gates that need "business write and audit live or die together"
// should use this instead of hand-writing INSERT SQL (which silently decouples
// from schema evolution).
func (r *Recorder) RecordTx(ctx context.Context, tx execer, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any) error {
	_, err := r.record(ctx, tx, workspaceID, p, action, resourceType, resourceID, meta)
	return err
}

func (r *Recorder) Record(ctx context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any) {
	ctx = context.WithoutCancel(ctx)
	if _, err := r.record(ctx, r.pool, workspaceID, p, action, resourceType, resourceID, meta); err != nil {
		r.log.Error("audit write failed", "action", action, "err", err)
	}
}

func (r *Recorder) record(ctx context.Context, q execer, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any) (pgconn.CommandTag, error) {
	actorType, actorID := "system", ""
	snapshot := map[string]any{}
	if p != nil {
		switch p.Source {
		case webx.SourcePAT:
			actorType = "pat"
		case webx.SourceSession:
			actorType = "user"
		}
		actorID = p.UserID
		snapshot = map[string]any{"email": p.Email}
		if p.WorkspaceID != "" {
			snapshot["role"] = p.Role
			snapshot["workspace_id"] = p.WorkspaceID
		}
	}
	var wsID any
	if workspaceID != nil {
		wsID = *workspaceID
	}
	return q.Exec(ctx, `INSERT INTO audit_event
		(workspace_id, actor_type, actor_id, actor_snapshot, action, resource_type, resource_id, request_id, metadata)
		VALUES ($1, $2, $3, COALESCE($4, '{}'::jsonb), $5, $6, $7, $8, COALESCE($9, '{}'::jsonb))`,
		wsID, actorType, actorID, snapshot, action, resourceType, strOrNil(resourceID),
		r.requestID(ctx), metaOrNil(meta))
}

func (r *Recorder) requestID(ctx context.Context) any {
	if v, ok := ctx.Value(requestIDKey{}).(string); ok && v != "" {
		return v
	}
	return nil
}

type requestIDKey struct{}

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

func strOrNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func metaOrNil(m map[string]any) any {
	if len(m) == 0 {
		return nil
	}
	return m
}

func (r *Recorder) List(ctx context.Context, workspaceID string, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.pool.Query(ctx, `SELECT id, actor_type, actor_id, actor_snapshot, action,
		resource_type, resource_id, metadata, created_at
		FROM audit_event WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, actorType, action, rtype, createdAt any
		var actorID, resourceID any
		var snapshot, metadata map[string]any
		if err := rows.Scan(&id, &actorType, &actorID, &snapshot, &action, &rtype, &resourceID, &metadata, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "actor_type": actorType, "actor_id": actorID,
			"actor_snapshot": snapshot, "action": action, "resource_type": rtype,
			"resource_id": resourceID, "metadata": metadata, "created_at": createdAt,
		})
	}
	return out, rows.Err()
}

type ListQuery struct {
	WorkspaceID   string
	ActorID       string
	Action        string
	ResourceType  string
	From, To      *time.Time
	Limit, Offset int
}

const (
	colWorkspaceID  = "workspace_id"
	colActorID      = "actor_id"
	colAction       = "action"
	colResourceType = "resource_type"
	colCreatedAt    = "created_at"
)

func (q ListQuery) whereClause() (string, []any) {
	var conds []string
	var args []any
	add := func(col, op string, v any) {
		args = append(args, v)
		conds = append(conds, col+" "+op+" $"+strconv.Itoa(len(args)))
	}
	if q.WorkspaceID != "" {
		add(colWorkspaceID, "=", q.WorkspaceID)
	}
	if q.ActorID != "" {
		add(colActorID, "=", q.ActorID)
	}
	if q.Action != "" {
		add(colAction, "=", q.Action)
	}
	if q.ResourceType != "" {
		add(colResourceType, "=", q.ResourceType)
	}
	if q.From != nil {
		add(colCreatedAt, ">=", *q.From)
	}
	if q.To != nil {
		add(colCreatedAt, "<", *q.To)
	}
	if len(conds) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

type page struct{ limit, offset int }

func normalizePage(limit, offset, def, max int) page {
	if limit <= 0 {
		limit = def
	}
	if limit > max {
		limit = max
	}
	if offset < 0 {
		offset = 0
	}
	return page{limit, offset}
}

func pageArgs(args []any, pg page) ([]any, string, string) {
	all := append(append([]any{}, args...), pg.limit, pg.offset)
	return all,
		"$" + strconv.Itoa(len(all)-1),
		"$" + strconv.Itoa(len(all))
}

func (r *Recorder) Query(ctx context.Context, q ListQuery) ([]map[string]any, int, error) {
	pg := normalizePage(q.Limit, q.Offset, 100, 500)
	where, args := q.whereClause()

	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM audit_event`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	all, limitPh, offsetPh := pageArgs(args, pg)
	rows, err := r.pool.Query(ctx, `SELECT id::text, COALESCE(workspace_id::text,''), actor_type, actor_id, actor_snapshot, action,
		resource_type, resource_id, metadata, created_at
		FROM audit_event`+where+` ORDER BY created_at DESC, id DESC LIMIT `+limitPh+` OFFSET `+offsetPh, all...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, wsID, actorType, action, rtype string
		var actorID, resourceID any
		var createdAt any
		var snapshot, metadata map[string]any
		if err := rows.Scan(&id, &wsID, &actorType, &actorID, &snapshot, &action, &rtype, &resourceID, &metadata, &createdAt); err != nil {
			return nil, 0, err
		}
		out = append(out, map[string]any{
			"id": id, "workspace_id": wsID, "actor_type": actorType, "actor_id": actorID,
			"actor_snapshot": snapshot, "action": action, "resource_type": rtype,
			"resource_id": resourceID, "metadata": metadata, "created_at": createdAt,
		})
	}
	return out, total, rows.Err()
}

var csvColumns = []string{
	"created_at", "actor_type", "actor_id", "actor_email", "action",
	"resource_type", "resource_id", "request_id", "metadata",
}

func CSVCell(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

func (r *Recorder) ExportCSV(ctx context.Context, q ListQuery, w io.Writer) error {
	pg := normalizePage(q.Limit, q.Offset, 5000, 5000)
	where, args := q.whereClause()
	all, limitPh, offsetPh := pageArgs(args, pg)

	rows, err := r.pool.Query(ctx, `SELECT created_at, actor_type, COALESCE(actor_id, ''),
		COALESCE(actor_snapshot->>'email', ''), action, resource_type,
		COALESCE(resource_id, ''), COALESCE(request_id, ''), metadata::text
		FROM audit_event`+where+` ORDER BY created_at DESC, id DESC LIMIT `+limitPh+` OFFSET `+offsetPh, all...)
	if err != nil {
		return err
	}
	defer rows.Close()

	cw := csv.NewWriter(w)
	if err := cw.Write(csvColumns); err != nil {
		return err
	}
	for rows.Next() {
		var createdAt time.Time
		var actorType, actorID, actorEmail, action, rtype, resourceID, requestID, metadata string
		if err := rows.Scan(&createdAt, &actorType, &actorID, &actorEmail,
			&action, &rtype, &resourceID, &requestID, &metadata); err != nil {
			return err
		}
		if err := cw.Write([]string{
			createdAt.UTC().Format(time.RFC3339Nano), CSVCell(actorType), CSVCell(actorID), CSVCell(actorEmail),
			CSVCell(action), CSVCell(rtype), CSVCell(resourceID), CSVCell(requestID), CSVCell(metadata),
		}); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	cw.Flush()
	return cw.Error()
}
