package pgrepo

import (
	"context"
	"encoding/csv"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/audit"
)

const auditExtPage = 500

const (
	auditExtDefaultLimit = 100
	auditExtMaxLimit     = 500
)

var auditExtColumns = []string{
	"created_at", "actor_type", "actor_id", "actor_email", "action",
	"resource_type", "resource_id", "request_id", "metadata",
}

func auditExtWhere(q audit.ListQuery, actorIDs []string) (string, []any) {
	var conds []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, cond+" $"+strconv.Itoa(len(args)))
	}
	if q.WorkspaceID != "" {
		add("workspace_id =", q.WorkspaceID)
	}
	if q.ActorID != "" {
		add("actor_id =", q.ActorID)
	}
	if q.Action != "" {
		add("action =", q.Action)
	}
	if q.ResourceType != "" {
		add("resource_type =", q.ResourceType)
	}
	if q.From != nil {
		add("created_at >=", *q.From)
	}
	if q.To != nil {
		add("created_at <", *q.To)
	}
	if len(actorIDs) > 0 {
		args = append(args, actorIDs)
		conds = append(conds, "actor_id = ANY($"+strconv.Itoa(len(args))+"::text[])")
	}
	if len(conds) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

func (r *Repo) UserIDsByEmailPrefix(ctx context.Context, emailPrefix string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text FROM "user" WHERE email ILIKE $1 || '%'
		ORDER BY created_at DESC LIMIT $2`, emailPrefix, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *Repo) QueryAuditExt(ctx context.Context, q audit.ListQuery, actorIDs []string) ([]app.AuditEntry, int, error) {
	where, args := auditExtWhere(q, actorIDs)

	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM audit_event`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limit, offset := q.Limit, q.Offset
	if limit <= 0 {
		limit = auditExtDefaultLimit
	}
	if limit > auditExtMaxLimit {
		limit = auditExtMaxLimit
	}
	if offset < 0 {
		offset = 0
	}
	all := append(append([]any{}, args...), limit, offset)
	lp, op := "$"+strconv.Itoa(len(all)-1), "$"+strconv.Itoa(len(all))
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(workspace_id::text, ''), actor_type, COALESCE(actor_id, ''),
		       actor_snapshot, action, resource_type, COALESCE(resource_id, ''), metadata, created_at
		FROM audit_event`+where+`
		ORDER BY created_at DESC, id DESC LIMIT `+lp+` OFFSET `+op, all...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]app.AuditEntry, 0, limit)
	for rows.Next() {
		var e app.AuditEntry
		if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.ActorType, &e.ActorID, &e.ActorSnapshot,
			&e.Action, &e.ResourceType, &e.ResourceID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}

func (r *Repo) ExportAuditCSV(ctx context.Context, q audit.ListQuery, actorIDs []string, maxRows int, w io.Writer) (bool, error) {
	cw := csv.NewWriter(w)
	if err := cw.Write(auditExtColumns); err != nil {
		return false, err
	}

	if actorIDs != nil && len(actorIDs) == 0 {
		cw.Flush()
		return false, cw.Error()
	}
	if maxRows <= 0 {
		maxRows = 50000
	}

	where, args := auditExtWhere(q, actorIDs)

	cursorCond := func(base string, baseArgs []any, at time.Time, id string) (string, []any) {
		all := append(append([]any{}, baseArgs...), at, id)
		joiner := " AND "
		if base == "" {
			joiner = " WHERE "
		}
		n := len(all)
		return joiner + "(created_at, id) < ($" + strconv.Itoa(n-1) + ", $" + strconv.Itoa(n) + "::uuid)", all
	}

	written, truncated := 0, false
	var lastAt time.Time
	var lastID string
	for {
		fetch := auditExtPage
		if remain := maxRows - written; remain < fetch {
			fetch = remain
		}
		cond, qargs := "", append([]any{}, args...)
		if written > 0 {
			cond, qargs = cursorCond(where, qargs, lastAt, lastID)
		}
		qargs = append(qargs, fetch)
		lp := "$" + strconv.Itoa(len(qargs))
		rows, err := r.pool.Query(ctx, `
			SELECT created_at, id::text, actor_type, COALESCE(actor_id, ''),
			       COALESCE(actor_snapshot->>'email', ''), action, resource_type,
			       COALESCE(resource_id, ''), COALESCE(request_id, ''), metadata::text
			FROM audit_event`+where+cond+`
			ORDER BY created_at DESC, id DESC LIMIT `+lp, qargs...)
		if err != nil {
			return truncated, err
		}
		n := 0
		for rows.Next() {
			var createdAt time.Time
			var id string
			var actorType, actorID, actorEmail, action, rtype, resourceID, requestID, metadata string
			if err := rows.Scan(&createdAt, &id, &actorType, &actorID, &actorEmail,
				&action, &rtype, &resourceID, &requestID, &metadata); err != nil {
				rows.Close()
				return truncated, err
			}
			if err := cw.Write([]string{
				createdAt.UTC().Format(time.RFC3339Nano), audit.CSVCell(actorType), audit.CSVCell(actorID),
				audit.CSVCell(actorEmail), audit.CSVCell(action), audit.CSVCell(rtype),
				audit.CSVCell(resourceID), audit.CSVCell(requestID), audit.CSVCell(metadata),
			}); err != nil {
				rows.Close()
				return truncated, err
			}
			lastAt, lastID = createdAt, id
			n++
			written++
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return truncated, err
		}
		cw.Flush()
		if err := cw.Error(); err != nil {
			return truncated, err
		}
		if n < fetch {
			break
		}
		if written >= maxRows {

			pcond, pargs := cursorCond(where, args, lastAt, lastID)
			var more bool
			if err := r.pool.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM audit_event`+where+pcond+` LIMIT 1)`, pargs...).Scan(&more); err != nil {
				return true, err
			}
			truncated = more
			break
		}
	}
	cw.Flush()
	return truncated, cw.Error()
}
