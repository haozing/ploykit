package pgrepo

import (
	"context"
	"fmt"
	"time"

	"github.com/haozing/ploykit/identity/app"
)

func (r *Repo) FindOAuthAccount(ctx context.Context, provider, subject string) (string, bool, error) {
	var userID string
	err := r.pool.QueryRow(ctx,
		`SELECT user_id FROM oauth_account WHERE provider = $1 AND subject = $2`, provider, subject).Scan(&userID)
	if isNoRows(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, mapErr(err)
	}
	return userID, true, nil
}

// LinkOAuthAccount 绑定 (provider, subject) → user。旧实现 ON CONFLICT DO
// NOTHING 静默吞掉「已绑到另一用户」的冲突（OA-1，oauth-admin-config-
// audit-2026-10-31）：同一 provider 账号在改邮箱瞬间并发两次回调会造出
// 第二个用户且登录成功，而 oauth_account 行永久指向第一个用户——下次
// 登录回到旧账号，身份漂移且无告警。现在冲突时回读既有行比对 user_id：
// 一致（幂等重放）正常返回；不一致 fail-closed 报 app.ErrOAuthLinkConflict，
// 本次登录失败、用户重点一次即走 FindOAuthAccount 命中既有绑定。
func (r *Repo) LinkOAuthAccount(ctx context.Context, provider, subject, userID, emailAtLink string, now time.Time) error {
	var linkedTo string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO oauth_account (provider, subject, user_id, email_at_link, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, subject) DO UPDATE SET user_id = oauth_account.user_id
		RETURNING user_id`, provider, subject, userID, emailAtLink, now).Scan(&linkedTo)
	if err != nil {
		return mapErr(err)
	}
	if linkedTo != userID {
		return fmt.Errorf("%w: %s/%s already linked to user %s (this login is user %s)",
			app.ErrOAuthLinkConflict, provider, subject, linkedTo, userID)
	}
	return nil
}
