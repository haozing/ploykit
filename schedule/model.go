package schedule

import "time"

const (
	MisfireSkip = "skip"

	MisfireOnce = "once"
)

func ValidMisfire(s string) bool {
	return s == MisfireSkip || s == MisfireOnce
}

type SchedulePlan struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"workspace_id"`
	Kind        string     `json:"kind"`
	CronExpr    string     `json:"cron_expr"`
	Timezone    string     `json:"timezone"`
	NextFireAt  time.Time  `json:"next_fire_at"`
	Misfire     string     `json:"misfire"`
	LastFiredAt *time.Time `json:"last_fired_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	Enabled     bool       `json:"enabled"`
}

type Claimed struct {
	Plan SchedulePlan
	Due  time.Time
}
