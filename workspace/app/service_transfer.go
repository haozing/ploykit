package app

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace/domain"
)

func (s *WorkspaceService) TransferOwnership(ctx context.Context, actor *webx.Principal, wsID, newOwnerUserID string) error {

	var fromUserID string
	me, ok, err := s.repo.GetMember(ctx, wsID, actor.UserID)
	if err != nil {
		return err
	}
	if ok && me.Role == domain.RoleOwner {
		fromUserID = actor.UserID
	} else if !actor.IsPlatformAdmin {

		return webx.NewForbidden("owner required to transfer ownership")
	} else {

		owner, ok, err := s.repo.OldestActiveOwner(ctx, wsID)
		if err != nil {
			return err
		}
		if !ok {
			return webx.NewConflict("workspace has no active owner to transfer from")
		}
		fromUserID = owner.UserID
	}

	target, userStatus, ok, err := s.repo.GetMemberUserStatus(ctx, wsID, newOwnerUserID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("member not found")
	}
	if target.UserID == fromUserID {
		return webx.NewConflict("target is already the owner")
	}
	if target.Role == domain.RoleOwner {
		return webx.NewConflict("target is already an owner")
	}
	if userStatus != "active" {
		return webx.NewConflict("cannot transfer ownership to a disabled user")
	}

	if s.hooks.BeforeOwnerChange != nil {
		if err := s.hooks.BeforeOwnerChange(ctx, wsID, fromUserID, newOwnerUserID); err != nil {
			return webx.NewConflict("ownership cannot be transferred: " + err.Error())
		}
	}

	if err := s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return s.repo.TransferOwnershipTx(ctx, tx, wsID, fromUserID, newOwnerUserID)
	}); err != nil {
		if err == ErrNotFound {
			return webx.NewConflict("ownership state changed concurrently; retry")
		}
		return err
	}

	s.audit(ctx, &wsID, actor, "workspace.owner_transfer", "workspace", wsID, map[string]any{
		"from_owner": fromUserID, "from_role": domain.RoleOwner,
		"to_owner": newOwnerUserID, "to_role": target.Role,
	})

	if s.hooks.OnOwnerTransfer != nil {
		if err := s.hooks.OnOwnerTransfer(ctx, wsID, fromUserID, newOwnerUserID); err != nil {
			slog.Warn("owner transfer hook failed", "workspace", wsID,
				"from", fromUserID, "to", newOwnerUserID, "err", err)
		}
	}
	return nil
}
