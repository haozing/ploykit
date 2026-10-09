package quota

import (
	"testing"
	"time"
)

func TestPeriod(t *testing.T) {

	cases := []struct {
		t    time.Time
		want string
	}{
		{time.Date(2026, 10, 5, 8, 0, 0, 0, time.UTC), "2026-10"},
		{time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), "2026-10"},
		{time.Date(2026, 9, 30, 23, 59, 59, 0, time.UTC), "2026-09"},
		{time.Date(2026, 5, 1, 0, 30, 0, 0, time.FixedZone("CST", 8*3600)), "2026-04"},
		{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "2026-01"},
	}
	for _, c := range cases {
		if got := Period(c.t); got != c.want {
			t.Errorf("Period(%v)=%q want %q", c.t, got, c.want)
		}
	}
}

func TestStatusExceeded(t *testing.T) {
	cases := []struct {
		st   Status
		want bool
	}{
		{Status{Limit: 100, Used: 99}, false},
		{Status{Limit: 100, Used: 100}, true},
		{Status{Limit: 100, Used: 101}, true},
		{Status{Limit: 0, Used: 0}, true},
	}
	for _, c := range cases {
		if got := c.st.Exceeded(); got != c.want {
			t.Errorf("Exceeded(L=%d,U=%d)=%v want %v", c.st.Limit, c.st.Used, got, c.want)
		}
	}
}
