package legal

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Acceptance methods (LC-3): how an (user, doc, version) triple came to be
// recorded. signup = the account itself (every registration path via
// AfterRegister); login_implicit = "signing in means agreeing" backfill via
// AfterLogin; reaccept = an explicit POST /api/legal/acceptances.
const (
	MethodSignup        = "signup"
	MethodLoginImplicit = "login_implicit"
	MethodReaccept      = "reaccept"
)

// Acceptance is one click-through evidence row (migration 052). The unique
// constraint (user_id, doc_key, doc_version) makes every write idempotent —
// first evidence wins, and the client environment columns store the
// structured triple, never a raw User-Agent string.
type Acceptance struct {
	UserID         string    `json:"user_id"`
	DocKey         string    `json:"doc_key"`
	DocVersion     string    `json:"doc_version"`
	Method         string    `json:"method"`
	IP             string    `json:"ip"`
	ClientPlatform string    `json:"client_platform"`
	ClientVersion  string    `json:"client_version"`
	ClientOS       string    `json:"client_os"`
	AcceptedAt     time.Time `json:"accepted_at"`
}

// AcceptanceRepo is the persistence port for acceptance evidence. The
// PG implementation is the shipped one; hermetic tests substitute a fake.
type AcceptanceRepo interface {
	// InsertAcceptances writes rows idempotently (INSERT … ON CONFLICT DO
	// NOTHING on the natural key). An empty slice is a no-op.
	InsertAcceptances(ctx context.Context, rows []Acceptance) error

	// UnacceptedDocs filters docs down to those whose CURRENT version has
	// no recorded acceptance for the user (any method counts — a signup
	// row covers the same version a login would). One lookup backs the
	// AfterLogin fast path.
	UnacceptedDocs(ctx context.Context, userID string, docs []Doc) ([]Doc, error)

	// AcceptancesByUser lists a user's full acceptance history, newest
	// first (admin evidence export / dispute response).
	AcceptancesByUser(ctx context.Context, userID string) ([]Acceptance, error)
}

// PGAcceptanceRepo is the AcceptanceRepo implementation over the shared
// pool. It never opens its own transactions: every statement is a single
// idempotent write or read, safe under concurrent logins.
type PGAcceptanceRepo struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewAcceptanceRepo builds the PG repo; the clock is injectable for tests.
func NewAcceptanceRepo(pool *pgxpool.Pool) *PGAcceptanceRepo {
	return &PGAcceptanceRepo{pool: pool, now: time.Now}
}

func (r *PGAcceptanceRepo) InsertAcceptances(ctx context.Context, rows []Acceptance) error {
	if len(rows) == 0 {
		return nil
	}
	// One batch = one round trip for the whole doc set; ON CONFLICT DO
	// NOTHING keeps every row idempotent against the natural key, which is
	// the whole contract of the AfterRegister/AfterLogin hooks.
	b := &pgx.Batch{}
	for _, row := range rows {
		b.Queue(`INSERT INTO legal_acceptances
			(user_id, doc_key, doc_version, method, ip, client_platform, client_version, client_os, accepted_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (user_id, doc_key, doc_version) DO NOTHING`,
			row.UserID, row.DocKey, row.DocVersion, row.Method, row.IP,
			row.ClientPlatform, row.ClientVersion, row.ClientOS, r.now())
	}
	br := r.pool.SendBatch(ctx, b)
	defer br.Close()
	for range rows {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (r *PGAcceptanceRepo) UnacceptedDocs(ctx context.Context, userID string, docs []Doc) ([]Doc, error) {
	if len(docs) == 0 {
		return nil, nil
	}
	// One query for everything the user has ever accepted; the doc filter
	// then happens in memory (a user's rows scale with docs × lived-through
	// versions, not with logins).
	rows, err := r.pool.Query(ctx,
		`SELECT doc_key, doc_version FROM legal_acceptances WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	recorded := map[string]bool{}
	for rows.Next() {
		var key, version string
		if err := rows.Scan(&key, &version); err != nil {
			return nil, err
		}
		recorded[key+"\x00"+version] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var missing []Doc
	for _, d := range docs {
		if !recorded[d.Key+"\x00"+d.Version] {
			missing = append(missing, d)
		}
	}
	return missing, nil
}

func (r *PGAcceptanceRepo) AcceptancesByUser(ctx context.Context, userID string) ([]Acceptance, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT user_id::text, doc_key, doc_version, method, ip,
		       client_platform, client_version, client_os, accepted_at
		FROM legal_acceptances
		WHERE user_id = $1
		ORDER BY accepted_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Acceptance{}
	for rows.Next() {
		var a Acceptance
		if err := rows.Scan(&a.UserID, &a.DocKey, &a.DocVersion, &a.Method, &a.IP,
			&a.ClientPlatform, &a.ClientVersion, &a.ClientOS, &a.AcceptedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
