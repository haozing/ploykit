package pgpart

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	DefaultRetentionMonths = 12

	EnsureAhead = 2
)

type Table struct {
	Pool   *pgxpool.Pool
	Parent string

	RetentionMonths int
}

type Round struct {
	Skipped bool
	Created []string
	Dropped []string
}

func (t *Table) retention() int {
	if t.RetentionMonths <= 0 {
		return DefaultRetentionMonths
	}
	return t.RetentionMonths
}

func MonthStart(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func partitionName(parent string, month time.Time) string {
	return parent + "_" + month.UTC().Format("2006_01")
}

func parsePartitionMonth(parent, relname string) (time.Time, bool) {
	prefix := parent + "_"
	if !strings.HasPrefix(relname, prefix) {
		return time.Time{}, false
	}
	m, err := time.Parse("2006_01", relname[len(prefix):])
	if err != nil {
		return time.Time{}, false
	}
	return m, true
}

func boundLiteral(m time.Time) string {
	return "'" + m.UTC().Format("2006-01-02T15:04:05+00:00") + "'"
}

func (t *Table) Maintain(ctx context.Context, now time.Time) (Round, error) {
	conn, err := t.Pool.Acquire(ctx)
	if err != nil {
		return Round{}, fmt.Errorf("pgpart: acquire conn: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock(hashtext($1))`, "ploykit_pgpart:"+t.Parent).Scan(&locked); err != nil {
		return Round{}, fmt.Errorf("pgpart: advisory lock: %w", err)
	}
	if !locked {
		return Round{Skipped: true}, nil
	}
	defer func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx),
			`SELECT pg_advisory_unlock(hashtext($1))`, "ploykit_pgpart:"+t.Parent)
	}()

	created, err := t.EnsureForward(ctx, now)
	if err != nil {
		return Round{Created: created}, err
	}
	dropped, err := t.DropExpired(ctx, now)
	return Round{Created: created, Dropped: dropped}, err
}

func (t *Table) EnsureForward(ctx context.Context, now time.Time) ([]string, error) {
	var created []string
	for i := 0; i <= EnsureAhead; i++ {
		month := MonthStart(now).AddDate(0, i, 0)
		end := month.AddDate(0, 1, 0)
		name := partitionName(t.Parent, month)
		attached, err := t.partitionAttached(ctx, name)
		if err != nil {
			return created, err
		}
		if attached {
			continue
		}
		if _, err := t.Pool.Exec(ctx, fmt.Sprintf(
			`CREATE TABLE IF NOT EXISTS %s PARTITION OF %s FOR VALUES FROM (%s) TO (%s)`,
			name, t.Parent, boundLiteral(month), boundLiteral(end))); err != nil {
			return created, fmt.Errorf("pgpart: create partition %s: %w", name, err)
		}

		if ok, err := t.partitionAttached(ctx, name); err != nil {
			return created, err
		} else if !ok {
			continue
		}
		created = append(created, name)
	}
	return created, nil
}

func (t *Table) partitionAttached(ctx context.Context, name string) (bool, error) {
	var yes bool
	err := t.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
			WHERE i.inhparent = $1::regclass AND c.relname = $2)`,
		t.Parent, name).Scan(&yes)
	return yes, err
}

func (t *Table) DropExpired(ctx context.Context, now time.Time) ([]string, error) {
	cutoff := MonthStart(now).AddDate(0, -(t.retention() - 1), 0)

	rows, err := t.Pool.Query(ctx, `
		SELECT c.relname FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = $1::regclass
		ORDER BY c.relname`, t.Parent)
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, n)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	var dropped []string
	for _, name := range names {
		month, ok := parsePartitionMonth(t.Parent, name)
		if !ok {
			continue
		}
		if month.AddDate(0, 1, 0).After(cutoff) {
			continue
		}
		if _, err := t.Pool.Exec(ctx, fmt.Sprintf(
			`ALTER TABLE %s DETACH PARTITION %s CONCURRENTLY`, t.Parent, name)); err != nil {
			return dropped, fmt.Errorf("pgpart: detach %s: %w", name, err)
		}
		if _, err := t.Pool.Exec(ctx, fmt.Sprintf(`DROP TABLE %s`, name)); err != nil {
			return dropped, fmt.Errorf("pgpart: drop detached %s: %w", name, err)
		}
		dropped = append(dropped, name)
	}
	return dropped, nil
}
