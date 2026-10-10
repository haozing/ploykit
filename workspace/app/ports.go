package app

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
)

type Clock func() time.Time

type Auditor interface {
	Record(ctx context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any)
}

type EmailSender interface {
	SendInvite(ctx context.Context, to, workspaceName, invitationID string) error
}

type Repo interface {
	CreateWorkspaceWithOwner(ctx context.Context, slug, name, ownerUserID string, now time.Time) (Workspace, error)
	ListWorkspacesByUser(ctx context.Context, userID string) ([]WorkspaceMembership, error)
	GetWorkspace(ctx context.Context, id string) (Workspace, bool, error)
	CountWorkspacesByUser(ctx context.Context, userID string) (int, error)
	GetMember(ctx context.Context, workspaceID, userID string) (Member, bool, error)
	IsMemberByEmail(ctx context.Context, workspaceID, email string) (bool, error)
	ListMembers(ctx context.Context, workspaceID string, page, pageSize int) (Page[Member], error)
	CountActiveOwners(ctx context.Context, workspaceID string) (int, error)

	UpdateMemberRole(ctx context.Context, workspaceID, userID, newRole string, now time.Time) error

	SoftRemoveMember(ctx context.Context, workspaceID, userID, removedBy string, now time.Time) error

	CreateInvitation(ctx context.Context, workspaceID, email, role, createdBy string, expiresAt time.Time) (Invitation, error)
	ListInvitations(ctx context.Context, workspaceID string, page, pageSize int) (Page[Invitation], error)
	RevokeInvitation(ctx context.Context, workspaceID, invitationID string, now time.Time) error
	HasPendingInvitation(ctx context.Context, workspaceID, email string) (bool, error)
	PendingInvitationsByEmail(ctx context.Context, email string) ([]InvitationWithWorkspace, error)
	AcceptInvitation(ctx context.Context, invitationID, userID, email string, now time.Time) (Workspace, error)
	DeclineInvitation(ctx context.Context, invitationID, email string, now time.Time) error

	CreateShareLink(ctx context.Context, workspaceID, codeHash, codePrefix, role, createdBy string, maxUses int, expiresAt time.Time) (ShareLink, error)
	ListShareLinks(ctx context.Context, workspaceID string, page, pageSize int) (Page[ShareLink], error)
	RevokeShareLink(ctx context.Context, workspaceID, linkID string, now time.Time) error
	RedeemShareLink(ctx context.Context, codeHash, userID string, now time.Time) (Workspace, error)

	RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error

	CountWorkspacesByUserForCreateTx(ctx context.Context, tx pgx.Tx, userID string) (int, error)

	CreateWorkspaceWithOwnerTx(ctx context.Context, tx pgx.Tx, slug, name, ownerUserID string, now time.Time) (Workspace, error)

	AcceptInvitationTx(ctx context.Context, tx pgx.Tx, invitationID, userID, email string, now time.Time) (Workspace, error)
	RedeemShareLinkTx(ctx context.Context, tx pgx.Tx, codeHash, userID string, now time.Time) (Workspace, error)

	UpdateWorkspaceName(ctx context.Context, id, name string, now time.Time) error

	DeleteWorkspaceCascade(ctx context.Context, tx pgx.Tx, workspaceID string) error

	GetMemberUserStatus(ctx context.Context, workspaceID, userID string) (Member, string, bool, error)

	OldestActiveOwner(ctx context.Context, workspaceID string) (Member, bool, error)

	TransferOwnershipTx(ctx context.Context, tx pgx.Tx, workspaceID, fromUserID, toUserID string) error

	// Role-config write side (read side lives in authz's Provider). An
	// override row REPLACES the role's built-in permission set entirely —
	// not a merge.
	ListRoleOverrides(ctx context.Context, workspaceID string) (map[string][]authz.Permission, error)
	UpsertRolePerms(ctx context.Context, workspaceID, role string, perms []authz.Permission, now time.Time) error
	DeleteRolePerms(ctx context.Context, workspaceID, role string) error
}

type PoolDeps struct {
	Pool *pgxpool.Pool
}

var ErrDuplicate = errors.New("duplicate")

var ErrNotFound = errors.New("not found")

var ErrLastOwner = errors.New("last active owner protected")
