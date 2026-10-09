package pgm

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const noTxMarker = "-- migrate:no-transaction"

type Hook func(ctx context.Context, conn *pgxpool.Conn) error

type StatusRow struct {
	Version   string
	Applied   bool
	AppliedAt *string

	Orphan bool
}

type Migrator struct {
	pool   *pgxpool.Pool
	fsys   embed.FS
	subdir string
	hooks  map[string][]Hook
}

func New(pool *pgxpool.Pool, fsys embed.FS, subdir string) *Migrator {
	return &Migrator{pool: pool, fsys: fsys, subdir: subdir, hooks: map[string][]Hook{}}
}

func (m *Migrator) RegisterPreHook(version string, h Hook) {
	m.hooks[version] = append(m.hooks[version], h)
}

var fileRe = regexp.MustCompile(`^([0-9]{3,})_[a-z0-9_]+\.(up|down)\.sql$`)

type migrationFile struct {
	version string
	kind    string
	name    string
	data    string
}

func versionLess(a, b string) bool {
	na, nb := leadingNum(a), leadingNum(b)
	if na != nb {
		return na < nb
	}
	return a < b
}

func leadingNum(v string) uint64 {
	i := 0
	for i < len(v) && v[i] >= '0' && v[i] <= '9' {
		i++
	}
	n, _ := strconv.ParseUint(v[:i], 10, 64)
	return n
}

func sortVersions(vs []string) {
	sort.Slice(vs, func(i, j int) bool { return versionLess(vs[i], vs[j]) })
}

func (m *Migrator) scan() (map[string]migrationFile, map[string]migrationFile, []string, error) {
	entries, err := fs.ReadDir(m.fsys, m.subdir)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("pgm: read migrations dir: %w", err)
	}
	ups, downs := map[string]migrationFile{}, map[string]migrationFile{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		mat := fileRe.FindStringSubmatch(e.Name())
		if mat == nil {
			return nil, nil, nil, fmt.Errorf("pgm: invalid migration filename %q (must be NNN_name.up|down.sql)", e.Name())
		}

		raw, err := fs.ReadFile(m.fsys, path.Join(m.subdir, e.Name()))
		if err != nil {
			return nil, nil, nil, fmt.Errorf("pgm: read %s: %w", e.Name(), err)
		}

		mf := migrationFile{version: mat[1], kind: mat[2], name: e.Name(),
			data: strings.TrimPrefix(string(raw), "\uFEFF")}
		if mf.kind == "up" {
			if _, dup := ups[mf.version]; dup {
				return nil, nil, nil, fmt.Errorf("pgm: duplicate up version %q", mf.version)
			}
			ups[mf.version] = mf
		} else {

			if _, dup := downs[mf.version]; dup {
				return nil, nil, nil, fmt.Errorf("pgm: duplicate down version %q", mf.version)
			}
			downs[mf.version] = mf
		}
	}
	versions := make([]string, 0, len(ups))
	for v := range ups {
		versions = append(versions, v)
	}
	sortVersions(versions)
	return ups, downs, versions, nil
}

type dbRunner interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func ensureVersionTableOn(ctx context.Context, q dbRunner) error {
	_, err := q.Exec(ctx, `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`)
	return err
}

func normVersion(v string) string {
	if i := strings.IndexByte(v, '_'); i > 0 {
		return v[:i]
	}
	return v
}

func appliedOn(ctx context.Context, q dbRunner) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT version, to_char(applied_at, 'YYYY-MM-DD HH24:MI:SS') FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	applied := map[string]string{}
	for rows.Next() {
		var v, at string
		if err := rows.Scan(&v, &at); err != nil {
			return nil, err
		}
		applied[normVersion(v)] = at
	}
	return applied, rows.Err()
}

func (m *Migrator) Up(ctx context.Context, limit int) ([]string, error) {
	var appliedList []string
	err := m.withRunLock(ctx, func(ctx context.Context, conn *pgxpool.Conn) error {
		applied, err := appliedOn(ctx, conn)
		if err != nil {
			return err
		}
		ups, _, versions, err := m.scan()
		if err != nil {
			return err
		}
		n := 0
		for _, v := range versions {
			if _, ok := applied[v]; ok {
				continue
			}
			if limit > 0 && n >= limit {
				break
			}
			for _, h := range m.hooks[v] {
				if err := h(ctx, conn); err != nil {
					return fmt.Errorf("pgm: pre-hook of %s: %w", v, err)
				}
			}
			if err := execMigrationOn(ctx, conn, ups[v], true); err != nil {
				return err
			}
			appliedList = append(appliedList, v)
			n++
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return appliedList, nil
}

func (m *Migrator) Down(ctx context.Context, limit int) ([]string, error) {
	if limit == 0 {
		return nil, fmt.Errorf("pgm: Down limit=0 拒绝执行(旧语义静默等于全量回滚):传显式正数回滚最近 N 个;确认要全量回滚传负数(limit<0),会先记 Error 日志")
	}
	full := limit < 0
	if full {
		slog.Error("pgm: Down full rollback requested (limit<0), rolling back ALL applied versions")
	}
	var rolled []string
	err := m.withRunLock(ctx, func(ctx context.Context, conn *pgxpool.Conn) error {
		applied, err := appliedOn(ctx, conn)
		if err != nil {
			return err
		}
		_, downs, versions, err := m.scan()
		if err != nil {
			return err
		}
		var appliedVersions []string
		for _, v := range versions {
			if _, ok := applied[v]; ok {
				appliedVersions = append(appliedVersions, v)
			}
		}
		n := 0
		for i := len(appliedVersions) - 1; i >= 0; i-- {
			v := appliedVersions[i]
			if !full && n >= limit {
				break
			}
			down, ok := downs[v]
			if !ok {
				return fmt.Errorf("pgm: %s is missing its down file, cannot roll back", v)
			}
			if err := execMigrationOn(ctx, conn, down, false); err != nil {
				return err
			}
			rolled = append(rolled, v)
			n++
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rolled, nil
}

func (m *Migrator) Status(ctx context.Context) ([]StatusRow, error) {
	if err := ensureVersionTableOn(ctx, m.pool); err != nil {
		return nil, err
	}
	applied, err := appliedOn(ctx, m.pool)
	if err != nil {
		return nil, err
	}
	_, _, versions, err := m.scan()
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(versions))
	out := make([]StatusRow, 0, len(versions))
	for _, v := range versions {
		known[v] = true
		row := StatusRow{Version: v}
		if at, ok := applied[v]; ok {
			row.Applied = true
			row.AppliedAt = &at
		}
		out = append(out, row)
	}
	var orphans []string
	for v := range applied {
		if !known[v] {
			orphans = append(orphans, v)
		}
	}
	sortVersions(orphans)
	for _, v := range orphans {
		at := applied[v]
		out = append(out, StatusRow{Version: v, Applied: true, AppliedAt: &at, Orphan: true})
	}
	return out, nil
}

func (m *Migrator) withRunLock(ctx context.Context, fn func(ctx context.Context, conn *pgxpool.Conn) error) error {
	conn, err := m.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("pgm: acquire conn: %w", err)
	}
	defer conn.Release()

	if err := ensureVersionTableOn(ctx, conn); err != nil {
		return fmt.Errorf("pgm: ensure version table: %w", err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext('ploykit_migrations'))`); err != nil {
		return fmt.Errorf("pgm: advisory lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtext('ploykit_migrations'))`)
	}()
	return fn(ctx, conn)
}

func hasNoTxMarker(data string) bool {
	s := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(data), "\uFEFF"))
	if len(s) < len(noTxMarker) {
		return false
	}
	return strings.EqualFold(s[:len(noTxMarker)], noTxMarker)
}

func execMigrationOn(ctx context.Context, conn *pgxpool.Conn, mf migrationFile, isUp bool) error {
	bookkeeping := fmt.Sprintf("INSERT INTO schema_migrations(version) VALUES ('%s');", mf.version)
	if !isUp {

		bookkeeping = fmt.Sprintf("DELETE FROM schema_migrations WHERE split_part(version, '_', 1) = '%s';", mf.version)
	}

	pgc := conn.Conn().PgConn()

	if hasNoTxMarker(mf.data) {
		if _, err := pgc.Exec(ctx, mf.data).ReadAll(); err != nil {
			return fmt.Errorf("pgm: exec %s: %w", mf.name, err)
		}
		results, err := pgc.Exec(ctx, bookkeeping).ReadAll()
		if err != nil {
			return noTxBookkeepError(mf, err)
		}
		if !isUp && len(results) > 0 && results[len(results)-1].CommandTag.RowsAffected() == 0 {

			return noTxBookkeepError(mf, fmt.Errorf("DELETE 命中 0 行(账面与迁移目录在锁外被改动)"))
		}
		return nil
	}

	body := strings.TrimSpace(mf.data)
	if !strings.HasSuffix(body, ";") {
		body += ";"
	}
	script := fmt.Sprintf("BEGIN;\n%s\n%s\nCOMMIT;", body, bookkeeping)
	if _, err := pgc.Exec(ctx, script).ReadAll(); err != nil {
		_, _ = pgc.Exec(ctx, "ROLLBACK").ReadAll()
		return fmt.Errorf("pgm: exec %s: %w", mf.name, err)
	}
	return nil
}

func noTxBookkeepError(mf migrationFile, err error) error {
	return fmt.Errorf(
		"pgm: no-transaction 迁移 %s 已执行但记账失败: %w\n"+
			"迁移体不在事务内,pgm 无法自动回滚;请人工修复后重试:\n"+
			"  ① 确认迁移体已实际生效 → 手工补账: INSERT INTO schema_migrations(version) VALUES ('%s');\n"+
			"  ② 或手工回滚迁移体的全部变更后,删除半途状态再重跑",
		mf.name, err, mf.version)
}

func Up(ctx context.Context, pool *pgxpool.Pool, fsys embed.FS, subdir string) error {
	_, err := New(pool, fsys, subdir).Up(ctx, 0)
	return err
}
