package devx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

// JobSummary is the list-view shape of a river job.
type JobSummary struct {
	ID          int64             `json:"id"`
	Kind        string            `json:"kind"`
	Queue       string            `json:"queue"`
	State       string            `json:"state"`
	Tags        []string          `json:"tags,omitempty"`
	Attempt     int               `json:"attempt"`
	MaxAttempts int               `json:"max_attempts"`
	ScheduledAt time.Time         `json:"scheduled_at"`
	FinalizedAt *time.Time        `json:"finalized_at,omitempty"`
	Errors      []JobAttemptError `json:"errors,omitempty"`
}

// JobDetail adds the arguments payload to the summary — the single most
// valuable field when an agent needs to understand what a failed job was
// trying to do.
type JobDetail struct {
	JobSummary
	Args json.RawMessage `json:"args"`
}

// JobAttemptError mirrors rivertype.AttemptError for JSON output.
type JobAttemptError struct {
	At      time.Time `json:"at"`
	Error   string    `json:"error"`
	TraceID string    `json:"trace_id,omitempty"`
}

// JobService wraps the river client with the list/get/retry/cancel verbs used
// by both the HTTP surface and the MCP tools.
type JobService struct {
	client *river.Client[pgxTx]
}

// pgxTx aliases the concrete transaction type river is parameterized with in
// this framework (events builds its client over pgx transactions).
type pgxTx = pgx.Tx

// NewJobService builds the service over an events emitter's client. A nil
// client (events not wired) yields a service whose queries return
// ErrNotWired — surfaces gate on Available.
func NewJobService(client *river.Client[pgxTx]) *JobService {
	return &JobService{client: client}
}

// Available reports whether a river client backs this service.
func (s *JobService) Available() bool { return s != nil && s.client != nil }

// List returns jobs filtered by state/queue/kind, ordered by ID descending
// (newest first). Default and maximum page size: 50.
func (s *JobService) List(ctx context.Context, state, queue, kind string, limit int) ([]JobSummary, error) {
	if !s.Available() {
		return nil, ErrNotWired
	}
	params := river.NewJobListParams().OrderBy(river.JobListOrderByID, river.SortOrderDesc)
	if state != "" {
		st, err := parseState(state)
		if err != nil {
			return nil, err
		}
		params = params.States(st)
	}
	if queue != "" {
		params = params.Queues(queue)
	}
	if kind != "" {
		params = params.Kinds(kind)
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	params = params.First(limit)

	res, err := s.client.JobList(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("devx: list jobs: %w", err)
	}
	out := make([]JobSummary, 0, len(res.Jobs))
	for _, j := range res.Jobs {
		out = append(out, summarize(j))
	}
	return out, nil
}

// Get returns one job with its args payload.
func (s *JobService) Get(ctx context.Context, id int64) (*JobDetail, error) {
	if !s.Available() {
		return nil, ErrNotWired
	}
	j, err := s.client.JobGet(ctx, id)
	if errors.Is(err, river.ErrNotFound) {
		return nil, ErrJobNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("devx: get job %d: %w", id, err)
	}
	return &JobDetail{JobSummary: summarize(j), Args: json.RawMessage(j.EncodedArgs)}, nil
}

// Retry makes a job immediately available to run again (running jobs are left
// untouched; MaxAttempts is incremented when already exhausted).
func (s *JobService) Retry(ctx context.Context, id int64) error {
	if !s.Available() {
		return ErrNotWired
	}
	if _, err := s.client.JobRetry(ctx, id); err != nil {
		if errors.Is(err, river.ErrNotFound) {
			return ErrJobNotFound
		}
		return fmt.Errorf("devx: retry job %d: %w", id, err)
	}
	return nil
}

// Cancel cancels a job: queued jobs immediately, running jobs cooperatively
// (via context cancellation inside the worker). Already-finalized jobs error.
func (s *JobService) Cancel(ctx context.Context, id int64) error {
	if !s.Available() {
		return ErrNotWired
	}
	if _, err := s.client.JobCancel(ctx, id); err != nil {
		if errors.Is(err, river.ErrNotFound) {
			return ErrJobNotFound
		}
		return fmt.Errorf("devx: cancel job %d: %w", id, err)
	}
	return nil
}

func summarize(j *rivertype.JobRow) JobSummary {
	out := JobSummary{
		ID:          j.ID,
		Kind:        j.Kind,
		Queue:       j.Queue,
		State:       string(j.State),
		Tags:        j.Tags,
		Attempt:     j.Attempt,
		MaxAttempts: j.MaxAttempts,
		ScheduledAt: j.ScheduledAt,
	}
	if j.FinalizedAt != nil {
		out.FinalizedAt = j.FinalizedAt
	}
	for _, e := range j.Errors {
		out.Errors = append(out.Errors, JobAttemptError{At: e.At, Error: e.Error, TraceID: e.Trace})
	}
	return out
}

func parseState(s string) (rivertype.JobState, error) {
	switch s {
	case "available":
		return rivertype.JobStateAvailable, nil
	case "cancelled":
		return rivertype.JobStateCancelled, nil
	case "completed":
		return rivertype.JobStateCompleted, nil
	case "discarded":
		return rivertype.JobStateDiscarded, nil
	case "pending":
		return rivertype.JobStatePending, nil
	case "retryable":
		return rivertype.JobStateRetryable, nil
	case "running":
		return rivertype.JobStateRunning, nil
	case "scheduled":
		return rivertype.JobStateScheduled, nil
	}
	return "", fmt.Errorf("%w: unknown job state %q (available|cancelled|completed|discarded|pending|retryable|running|scheduled)", ErrValidation, s)
}

// Sentinel errors surfaced by the service; the HTTP layer and MCP tools map
// them to statuses/codes once, here.
var (
	// ErrNotWired means the job service was built without a river client
	// (events not constructed) — the surface is present but inert.
	ErrNotWired = errors.New("devx: job service not wired (events not constructed)")
	// ErrJobNotFound means no river job with that id exists.
	ErrJobNotFound = errors.New("devx: job not found")
	// ErrValidation wraps input-shape errors.
	ErrValidation = errors.New("devx: validation")
	// ErrScopeDenied is returned to MCP tool calls whose PAT lacks the
	// required dev scope (the HTTP layer answers 403 via webx.RequireScope
	// before reaching handlers, so only the MCP path surfaces this).
	ErrScopeDenied = errors.New("devx: scope denied")
)
