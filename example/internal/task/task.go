package task

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/analytics/app"
	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/events"
	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/quota"
	webhooksapp "github.com/haozing/ploykit/webhooks/app"
)

type Task struct {
	ID        string     `json:"id"`
	Number    int64      `json:"number"`
	Title     string     `json:"title"`
	Done      bool       `json:"done"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type QuotaPort interface {
	Consume(ctx context.Context, workspaceID, key string, n int64, now time.Time) error

	Release(ctx context.Context, workspaceID, key string, n int64, now time.Time) error
}

type EventPublisher func(event string, payload any)

type Deps struct {
	Pool      *pgxpool.Pool
	Quota     *quota.Service
	Analytics *app.TrackService
	Authz     *authz.Authorizer

	Webhooks *webhooksapp.WebhookService

	QuotaReleaser QuotaPort

	Publish EventPublisher

	Emitter *events.Emitter
}

func Mount(mux *http.ServeMux, d Deps, wsMW func(http.Handler) http.Handler) {
	require := authz.Require(d.Authz, "tasks:read")
	write := authz.Require(d.Authz, "tasks:write")
	done := authz.RequireOwn(d.Authz, "tasks:write", d.taskOwner)
	mux.Handle("GET /api/tasks", wsMW(require(webx.P(d.list))))
	mux.Handle("POST /api/tasks", wsMW(write(webx.P(d.create))))
	mux.Handle("GET /api/tasks/{taskId}", wsMW(require(webx.P(d.get))))
	mux.Handle("POST /api/tasks/{taskId}/done", wsMW(done(webx.P(d.done))))
	mux.Handle("PATCH /api/tasks/{taskId}", wsMW(write(webx.P(d.update))))
	mux.Handle("DELETE /api/tasks/{taskId}", wsMW(write(webx.P(d.delete))))
	mux.Handle("GET /api/task-stats", wsMW(require(webx.P(d.stats))))
}

func (d Deps) stats(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	n, err := d.Analytics.CountByTypeInWorkspace(r.Context(), p.WorkspaceID, "task_created", time.Now().Add(-24*time.Hour))
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]int{"task_created_24h": n})
}

const (
	opCreate   = "create"
	opComplete = "complete"
)

const (
	KindTaskCreated  = "task.created"
	wsEventCompleted = "task.completed"
	wsEventDeleted   = "task.deleted"
)

const idemIndexName = "task_ws_idem_key"

const numberInsertAttempts = 3

type taskEvent struct {
	Type    string
	Payload map[string]any
}

func taskEventFor(op string, t Task) (taskEvent, bool) {
	payload := map[string]any{
		"task_id": t.ID,
		"number":  t.Number,
		"title":   t.Title,
	}
	switch op {
	case opCreate:
		return taskEvent{Type: KindTaskCreated, Payload: payload}, true
	case opComplete:
		return taskEvent{Type: "task.completed", Payload: payload}, true
	default:
		return taskEvent{}, false
	}
}

func (d Deps) emitWebhook(ctx context.Context, workspaceID, op string, t Task) {
	if d.Webhooks == nil {
		return
	}
	ev, ok := taskEventFor(op, t)
	if !ok {
		return
	}
	if _, err := d.Webhooks.Emit(ctx, workspaceID, webhooksapp.OutboundEvent{
		ID:      ids.NewV7().String(),
		Type:    ev.Type,
		Payload: ev.Payload,
	}); err != nil {
		slog.Warn("webhook emit skipped", "event", ev.Type, "workspace_id", workspaceID, "err", err)
	}
}

func (d Deps) publishWs(event string, t Task, workspaceID string) {
	if d.Publish == nil {
		return
	}
	d.Publish(event, map[string]any{"workspace_id": workspaceID, "task": t})
}

func validateTitle(raw string) (string, bool) {
	t := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(t)
	return t, n >= 1 && n <= 200
}

func (d Deps) taskOwner(r *http.Request, p *webx.Principal) bool {
	taskID := r.PathValue("taskId")
	if taskID == "" || d.Pool == nil {
		return false
	}
	var owner string
	err := d.Pool.QueryRow(
		r.Context(),
		`SELECT created_by FROM task WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL`,
		taskID, p.WorkspaceID,
	).Scan(&owner)
	return err == nil && owner == p.UserID
}

func (d Deps) findByIdemKey(ctx context.Context, workspaceID, key string) (Task, bool, error) {
	var t Task
	err := d.Pool.QueryRow(ctx, `
		SELECT id, number, title, done, created_at, updated_at
		FROM task WHERE workspace_id = $1 AND idempotency_key = $2 AND removed_at IS NULL`,
		workspaceID, key).Scan(&t.ID, &t.Number, &t.Title, &t.Done, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, false, nil
	}
	if err != nil {
		return Task{}, false, err
	}
	return t, true, nil
}

func (d Deps) insertTask(ctx context.Context, workspaceID, title, userID, idemKey string, t *Task) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "task_number:"+workspaceID); err != nil {
		return err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO task (workspace_id, number, title, created_by, idempotency_key)
		VALUES ($1, (SELECT COALESCE(max(number),0)+1 FROM task WHERE workspace_id=$1), $2, $3, NULLIF($4,''))
		RETURNING id, number, title, done, created_at, updated_at`,
		workspaceID, title, userID, idemKey).
		Scan(&t.ID, &t.Number, &t.Title, &t.Done, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return err
	}

	if d.Emitter != nil {
		wsUUID, uerr := uuid.Parse(workspaceID)
		if uerr != nil {
			return uerr
		}
		payload, merr := json.Marshal(map[string]any{
			"workspace_id": workspaceID, "actor_id": userID, "task": t,
		})
		if merr != nil {
			return merr
		}
		if eerr := d.Emitter.Emit(ctx, tx, events.Event{
			Kind:           KindTaskCreated,
			WorkspaceID:    wsUUID,
			Payload:        payload,
			IDempotencyKey: "task:" + t.ID,
		}); eerr != nil {
			return eerr
		}
	}
	return tx.Commit(ctx)
}

func (d Deps) create(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Title string `json:"title"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	title, ok := validateTitle(req.Title)
	if !ok {
		webx.ErrValidation(w, "title must be 1-200 characters after trim")
		return
	}
	idemKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))

	if idemKey != "" {
		if t, found, err := d.findByIdemKey(r.Context(), p.WorkspaceID, idemKey); err != nil {
			webx.ErrInternal(w)
			return
		} else if found {
			webx.WriteJSON(w, http.StatusOK, t)
			return
		}
	}

	if err := d.Quota.Consume(r.Context(), p.WorkspaceID, "tasks_monthly", 1, time.Now()); err != nil {
		webx.WriteErr(w, err)
		return
	}
	release := func() {
		_ = d.Quota.Release(r.Context(), p.WorkspaceID, "tasks_monthly", 1, time.Now())
	}

	var (
		t        Task
		inserted bool
	)
	for range numberInsertAttempts {
		err := d.insertTask(r.Context(), p.WorkspaceID, title, p.UserID, idemKey, &t)
		if err == nil {
			inserted = true
			break
		}
		if pg.IsUniqueViolation(err, "") {
			if pg.IsUniqueViolation(err, idemIndexName) && idemKey != "" {

				release()
				if ex, found, qerr := d.findByIdemKey(r.Context(), p.WorkspaceID, idemKey); qerr == nil && found {
					webx.WriteJSON(w, http.StatusOK, ex)
					return
				}
				webx.ErrConflict(w, "concurrent duplicate idempotency key")
				return
			}
			continue
		}
		release()
		webx.ErrInternal(w)
		return
	}
	if !inserted {
		release()
		webx.ErrInternal(w)
		return
	}

	d.Analytics.Track(r.Context(), app.Event{
		WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		Type: "task_created", EntityType: "task", EntityID: t.ID,
	})

	d.emitWebhook(r.Context(), p.WorkspaceID, opCreate, t)

	d.publishWs(KindTaskCreated, t, p.WorkspaceID)
	webx.WriteJSON(w, http.StatusCreated, t)
}

func (d Deps) list(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	rows, err := d.Pool.Query(r.Context(), `
		SELECT id, number, title, done, created_at, updated_at
		FROM task WHERE workspace_id = $1 AND removed_at IS NULL
		ORDER BY number DESC LIMIT 100`, p.WorkspaceID)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		var t Task
		if err := rows.Scan(&t.ID, &t.Number, &t.Title, &t.Done, &t.CreatedAt, &t.UpdatedAt); err != nil {
			webx.ErrInternal(w)
			return
		}
		out = append(out, t)
	}
	webx.WriteJSON(w, http.StatusOK, out)
}

func (d Deps) done(w http.ResponseWriter, r *http.Request, p *webx.Principal) {

	var t Task
	err := d.Pool.QueryRow(r.Context(), `
		UPDATE task SET done=true, updated_at=now() WHERE workspace_id=$1 AND id=$2 AND removed_at IS NULL
		RETURNING id, number, title, done, created_at, updated_at`,
		p.WorkspaceID, r.PathValue("taskId")).Scan(&t.ID, &t.Number, &t.Title, &t.Done, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		webx.ErrNotFound(w, "task not found")
		return
	}
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	d.Analytics.Track(r.Context(), app.Event{
		WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		Type: "task_completed", EntityType: "task", EntityID: r.PathValue("taskId"),
	})
	d.emitWebhook(r.Context(), p.WorkspaceID, opComplete, t)
	d.publishWs(wsEventCompleted, t, p.WorkspaceID)
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) get(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var t Task
	err := d.Pool.QueryRow(r.Context(), `
		SELECT id, number, title, done, created_at, updated_at
		FROM task WHERE workspace_id = $1 AND id = $2 AND removed_at IS NULL`,
		p.WorkspaceID, r.PathValue("taskId")).Scan(&t.ID, &t.Number, &t.Title, &t.Done, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		webx.ErrNotFound(w, "task not found")
		return
	}
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, t)
}

func (d Deps) update(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Title *string `json:"title"`
		Done  *bool   `json:"done"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Title == nil && req.Done == nil {
		webx.ErrValidation(w, "at least one of title or done is required")
		return
	}
	var titleArg, doneArg any
	if req.Title != nil {
		title, ok := validateTitle(*req.Title)
		if !ok {
			webx.ErrValidation(w, "title must be 1-200 characters after trim")
			return
		}
		titleArg = title
	}
	if req.Done != nil {
		doneArg = *req.Done
	}
	var t Task
	err := d.Pool.QueryRow(r.Context(), `
		UPDATE task SET
			title = COALESCE($3, title),
			done = COALESCE($4, done),
			updated_at = now()
		WHERE workspace_id = $1 AND id = $2 AND removed_at IS NULL
		RETURNING id, number, title, done, created_at, updated_at`,
		p.WorkspaceID, r.PathValue("taskId"), titleArg, doneArg).
		Scan(&t.ID, &t.Number, &t.Title, &t.Done, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		webx.ErrNotFound(w, "task not found")
		return
	}
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	if req.Done != nil && *req.Done {

		d.Analytics.Track(r.Context(), app.Event{
			WorkspaceID: p.WorkspaceID, UserID: p.UserID,
			Type: "task_completed", EntityType: "task", EntityID: t.ID,
		})
		d.emitWebhook(r.Context(), p.WorkspaceID, opComplete, t)
		d.publishWs(wsEventCompleted, t, p.WorkspaceID)
	}
	webx.WriteJSON(w, http.StatusOK, t)
}

func (d Deps) delete(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var t Task
	err := d.Pool.QueryRow(r.Context(), `
		UPDATE task SET removed_at = now()
		WHERE workspace_id = $1 AND id = $2 AND removed_at IS NULL
		RETURNING id, number, title, done, created_at, updated_at`,
		p.WorkspaceID, r.PathValue("taskId")).Scan(&t.ID, &t.Number, &t.Title, &t.Done, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		webx.ErrNotFound(w, "task not found")
		return
	}
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	if d.QuotaReleaser != nil {
		if err := d.QuotaReleaser.Release(r.Context(), p.WorkspaceID, "tasks_monthly", 1, time.Now()); err != nil {
			slog.Warn("quota release after task delete failed",
				"workspace_id", p.WorkspaceID, "task_id", t.ID, "err", err)
		}
	}
	d.publishWs(wsEventDeleted, t, p.WorkspaceID)
	w.WriteHeader(http.StatusNoContent)
}
