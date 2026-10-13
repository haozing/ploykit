package migrations

import (
	"context"
	"testing"
)

func TestProbeAppliedFull(t *testing.T) {
	pool, m := testMigrator(t)
	_ = pool
	st, err := m.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var all []string
	for _, r := range st {
		if r.Applied {
			all = append(all, r.Version)
		}
	}
	t.Logf("applied count=%d all=%v", len(all), all)
}
