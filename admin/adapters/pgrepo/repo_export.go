package pgrepo

import (
	"context"
	"time"
)

const exportAuditLimit = 500

type exportUserRow struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	DisplayName     string     `json:"display_name"`
	AvatarURL       *string    `json:"avatar_url,omitempty"`
	Status          string     `json:"status"`
	IsPlatformAdmin bool       `json:"is_platform_admin"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`

	TokensValidAfter *time.Time `json:"tokens_valid_after,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type exportMembershipRow struct {
	WorkspaceID string     `json:"workspace_id"`
	Slug        string     `json:"workspace_slug"`
	Name        string     `json:"workspace_name"`
	Role        string     `json:"role"`
	CreatedAt   time.Time  `json:"created_at"`
	RemovedAt   *time.Time `json:"removed_at,omitempty"`
}

type exportSessionRow struct {
	ID              string     `json:"id"`
	IPHash          *string    `json:"ip_hash,omitempty"`
	UserAgent       *string    `json:"user_agent,omitempty"`
	LastSeenAt      time.Time  `json:"last_seen_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	AbsoluteExpires time.Time  `json:"absolute_expires_at"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type exportPATRow struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type exportAuditEventRow struct {
	ID            string         `json:"id"`
	WorkspaceID   string         `json:"workspace_id,omitempty"`
	ActorType     string         `json:"actor_type"`
	ActorID       string         `json:"actor_id,omitempty"`
	ActorSnapshot map[string]any `json:"actor_snapshot"`
	Action        string         `json:"action"`
	ResourceType  string         `json:"resource_type"`
	ResourceID    string         `json:"resource_id,omitempty"`
	RequestID     string         `json:"request_id,omitempty"`
	Metadata      map[string]any `json:"metadata"`
	CreatedAt     time.Time      `json:"created_at"`
}

func (r *Repo) ExportUserdata(ctx context.Context, userID string) (map[string]any, error) {
	var user exportUserRow
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, email, display_name, avatar_url, status, is_platform_admin,
		       email_verified_at,
		       CASE WHEN tokens_valid_after = '-infinity' THEN NULL ELSE tokens_valid_after END,
		       created_at, updated_at
		FROM "user" WHERE id = $1`, userID).
		Scan(&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL, &user.Status,
			&user.IsPlatformAdmin, &user.EmailVerifiedAt, &user.TokensValidAfter,
			&user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, err
	}

	memberships, err := r.exportMemberships(ctx, userID)
	if err != nil {
		return nil, err
	}
	sessions, err := r.exportSessions(ctx, userID)
	if err != nil {
		return nil, err
	}
	pats, err := r.exportPATs(ctx, userID)
	if err != nil {
		return nil, err
	}
	events, err := r.exportAuditEvents(ctx, userID)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"user":                   user,
		"memberships":            memberships,
		"sessions":               sessions,
		"personal_access_tokens": pats,
		"audit_events":           events,
		"exported_at":            time.Now().UTC(),
	}, nil
}

func (r *Repo) exportMemberships(ctx context.Context, userID string) ([]exportMembershipRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT m.workspace_id::text, w.slug, w.name, m.role, m.created_at, m.removed_at
		FROM member m JOIN workspace w ON w.id = m.workspace_id
		WHERE m.user_id = $1
		ORDER BY m.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []exportMembershipRow{}
	for rows.Next() {
		var m exportMembershipRow
		if err := rows.Scan(&m.WorkspaceID, &m.Slug, &m.Name, &m.Role, &m.CreatedAt, &m.RemovedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) exportSessions(ctx context.Context, userID string) ([]exportSessionRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, ip_hash, user_agent, last_seen_at, expires_at,
		       absolute_expires_at, revoked_at, created_at
		FROM session WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []exportSessionRow{}
	for rows.Next() {
		var s exportSessionRow
		if err := rows.Scan(&s.ID, &s.IPHash, &s.UserAgent, &s.LastSeenAt, &s.ExpiresAt,
			&s.AbsoluteExpires, &s.RevokedAt, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repo) exportPATs(ctx context.Context, userID string) ([]exportPATRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, prefix, last_used_at, expires_at, revoked_at, created_at
		FROM personal_access_token WHERE user_id = $1
		ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []exportPATRow{}
	for rows.Next() {
		var p exportPATRow
		if err := rows.Scan(&p.ID, &p.Name, &p.Prefix, &p.LastUsedAt, &p.ExpiresAt,
			&p.RevokedAt, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) exportAuditEvents(ctx context.Context, userID string) ([]exportAuditEventRow, error) {

	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(workspace_id::text, ''), actor_type,
		       COALESCE(actor_id, ''), actor_snapshot, action, resource_type,
		       COALESCE(resource_id, ''), COALESCE(request_id, ''), metadata, created_at
		FROM audit_event WHERE actor_id = $1
		ORDER BY created_at DESC, id DESC LIMIT $2`, userID, exportAuditLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []exportAuditEventRow{}
	for rows.Next() {
		var e exportAuditEventRow
		if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.ActorType, &e.ActorID, &e.ActorSnapshot,
			&e.Action, &e.ResourceType, &e.ResourceID, &e.RequestID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
