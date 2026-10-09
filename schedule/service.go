package schedule

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/haozing/ploykit/platform/cronx"
	"github.com/haozing/ploykit/platform/ids"
)

const JobKind = "ploykit.schedule.fire"

type FireArgs struct {
	PlanID       string    `json:"plan_id"`
	ScheduledFor time.Time `json:"scheduled_for"`
}

func (FireArgs) Kind() string { return JobKind }

type Enqueuer interface {
	Insert(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

const Grace = 60 * time.Second

var (
	ErrInvalidCron = errors.New("invalid cron expression")
	ErrInvalidTZ   = errors.New("invalid timezone")
	ErrNotFound    = errors.New("schedule plan not found")
	ErrInvalidKind = errors.New("kind must be 1-100 characters after trim")
	ErrBadMisfire  = errors.New("misfire must be one of: skip, once")
)

type Service struct {
	repo  Repo
	enq   Enqueuer
	now   func() time.Time
	grace time.Duration
}

func NewService(repo Repo, enq Enqueuer, now func() time.Time) *Service {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{repo: repo, enq: enq, now: now, grace: Grace}
}

type CreateInput struct {
	Kind     string `json:"kind"`
	CronExpr string `json:"cron_expr"`
	Timezone string `json:"timezone"`
	Misfire  string `json:"misfire"`
}

func validateCron(cronExpr, tz string, now time.Time) (time.Time, error) {
	cronExpr = strings.TrimSpace(cronExpr)
	tz = strings.TrimSpace(tz)
	if tz == "" {
		tz = "UTC"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return time.Time{}, ErrInvalidTZ
	}

	if strings.EqualFold(tz, "Local") {
		return time.Time{}, ErrInvalidTZ
	}
	next, err := cronx.Next(cronExpr, tz, now)
	if err != nil {
		return time.Time{}, ErrInvalidCron
	}
	return next, nil
}

func normalizeMisfire(misfire string) (string, error) {
	misfire = strings.TrimSpace(misfire)
	if misfire == "" {
		return MisfireSkip, nil
	}
	if !ValidMisfire(misfire) {
		return "", ErrBadMisfire
	}
	return misfire, nil
}

func normalizeKind(kind string) (string, error) {
	k := strings.TrimSpace(kind)
	n := len([]rune(k))
	if n < 1 || n > 100 {
		return "", ErrInvalidKind
	}
	return k, nil
}

func (s *Service) Create(ctx context.Context, workspaceID string, in CreateInput) (SchedulePlan, error) {
	kind, err := normalizeKind(in.Kind)
	if err != nil {
		return SchedulePlan{}, err
	}
	misfire, err := normalizeMisfire(in.Misfire)
	if err != nil {
		return SchedulePlan{}, err
	}
	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		tz = "UTC"
	}
	next, err := validateCron(in.CronExpr, tz, s.now())
	if err != nil {
		return SchedulePlan{}, err
	}
	p := SchedulePlan{
		ID:          ids.NewV7().String(),
		WorkspaceID: workspaceID,
		Kind:        kind,
		CronExpr:    strings.TrimSpace(in.CronExpr),
		Timezone:    tz,
		NextFireAt:  next,
		Misfire:     misfire,
		Enabled:     true,
	}
	if err := s.repo.Create(ctx, &p); err != nil {
		return SchedulePlan{}, err
	}
	return p, nil
}

type UpdateInput struct {
	Kind     *string `json:"kind"`
	CronExpr *string `json:"cron_expr"`
	Timezone *string `json:"timezone"`
	Misfire  *string `json:"misfire"`
	Enabled  *bool   `json:"enabled"`
}

func (s *Service) Update(ctx context.Context, workspaceID, id string, in UpdateInput) (SchedulePlan, error) {
	p, err := s.repo.Get(ctx, workspaceID, id)
	if err != nil {
		return SchedulePlan{}, err
	}

	if in.Kind != nil {
		kind, err := normalizeKind(*in.Kind)
		if err != nil {
			return SchedulePlan{}, err
		}
		p.Kind = kind
	}
	if in.Misfire != nil {
		misfire, err := normalizeMisfire(*in.Misfire)
		if err != nil {
			return SchedulePlan{}, err
		}
		p.Misfire = misfire
	}
	if in.Timezone != nil {
		p.Timezone = strings.TrimSpace(*in.Timezone)
		if p.Timezone == "" {
			p.Timezone = "UTC"
		}
	}
	if in.CronExpr != nil {
		p.CronExpr = strings.TrimSpace(*in.CronExpr)
	}
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}

	if in.CronExpr != nil || in.Timezone != nil || (in.Enabled != nil && *in.Enabled) {
		next, err := validateCron(p.CronExpr, p.Timezone, s.now())
		if err != nil {
			return SchedulePlan{}, err
		}
		p.NextFireAt = next
	}
	if err := s.repo.Update(ctx, &p); err != nil {
		return SchedulePlan{}, err
	}
	return p, nil
}

func (s *Service) List(ctx context.Context, workspaceID string) ([]SchedulePlan, error) {
	return s.repo.ListByWorkspace(ctx, workspaceID)
}

func (s *Service) Delete(ctx context.Context, workspaceID, id string) error {
	return s.repo.Delete(ctx, workspaceID, id)
}

func (s *Service) Preview(ctx context.Context, cronExpr, tz string, n int) ([]time.Time, error) {
	if n <= 0 {
		n = 3
	}
	if n > 10 {
		n = 10
	}
	next, err := validateCron(cronExpr, tz, s.now())
	if err != nil {
		return nil, err
	}
	out := make([]time.Time, 0, n)
	for range n {
		out = append(out, next)
		next, err = cronx.Next(strings.TrimSpace(cronExpr), strings.TrimSpace(tz), next)
		if err != nil {
			return nil, ErrInvalidCron
		}
	}
	return out, nil
}

func (s *Service) Fire(ctx context.Context, plan SchedulePlan, scheduledFor time.Time) error {
	if s.enq == nil {
		return nil
	}
	_, err := s.enq.Insert(ctx, FireArgs{PlanID: plan.ID, ScheduledFor: scheduledFor}, &river.InsertOpts{
		UniqueOpts: river.UniqueOpts{ByArgs: true},
	})
	return err
}
