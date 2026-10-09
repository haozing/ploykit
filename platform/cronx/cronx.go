package cronx

import (
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

var parser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

func Next(expr, tz string, after time.Time) (time.Time, error) {
	loc := time.UTC
	if tz != "" {
		if tz == "Local" {
			return time.Time{}, fmt.Errorf("cronx: timezone %q rejected: schedules must not depend on the host's local timezone; use an explicit IANA name or empty (UTC)", tz)
		}
		l, err := time.LoadLocation(tz)
		if err != nil {
			return time.Time{}, fmt.Errorf("bad timezone %q: %w", tz, err)
		}
		loc = l
	}
	sched, err := parser.Parse(expr)
	if err != nil {
		return time.Time{}, fmt.Errorf("bad cron %q: %w", expr, err)
	}
	return sched.Next(after.In(loc)), nil
}
