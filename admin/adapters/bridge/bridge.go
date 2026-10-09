package bridge

import (
	"context"

	adminpg "github.com/haozing/ploykit/admin/adapters/pgrepo"
	"github.com/haozing/ploykit/admin/app"
	billingapp "github.com/haozing/ploykit/billing/app"
	identityapp "github.com/haozing/ploykit/identity/app"
	notifyapp "github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/webx"
	webhooksapp "github.com/haozing/ploykit/webhooks/app"
	workspaceapp "github.com/haozing/ploykit/workspace/app"
)

type UserOps struct {
	sessions  *identityapp.SessionService
	tokens    *identityapp.TokenService
	account   *identityapp.AccountService
	adminRepo *adminpg.Repo
}

func NewUserOps(
	sessions *identityapp.SessionService,
	tokens *identityapp.TokenService,
	account *identityapp.AccountService,
	adminRepo *adminpg.Repo,
) *UserOps {
	return &UserOps{sessions: sessions, tokens: tokens, account: account, adminRepo: adminRepo}
}

func (u *UserOps) GetUser(ctx context.Context, userID string) (app.AdminUser, bool, error) {
	return u.adminRepo.GetUserByID(ctx, userID)
}

func (u *UserOps) ListSessions(ctx context.Context, userID string) ([]app.UserSession, error) {
	infos, err := u.sessions.ListSessionsFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]app.UserSession, len(infos))
	for i, s := range infos {
		out[i] = app.UserSession{
			ID: s.ID, Device: s.UserAgent, IPHash: s.IPHash,
			CreatedAt: s.CreatedAt, LastSeenAt: s.LastSeenAt, ExpiresAt: s.ExpiresAt,
		}
	}
	return out, nil
}

func (u *UserOps) RevokeAllSessions(ctx context.Context, userID string) error {
	return u.sessions.RevokeAllSessionsFor(ctx, userID)
}

func (u *UserOps) RevokeSessionByID(ctx context.Context, userID, sessionID string) error {
	return u.sessions.RevokeSessionByIDFor(ctx, userID, sessionID)
}

func (u *UserOps) SendPasswordReset(ctx context.Context, email string) error {
	return u.account.RequestPasswordReset(ctx, email)
}

func (u *UserOps) ResendEmailVerification(ctx context.Context, userID, email string) error {
	return u.account.ResendVerificationFor(ctx, email)
}

func (u *UserOps) MarkEmailVerified(ctx context.Context, userID string) error {
	return u.account.MarkVerified(ctx, userID)
}

func (u *UserOps) ListPATs(ctx context.Context, userID string) ([]app.AdminPAT, error) {
	pats, err := u.tokens.ListPATsFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]app.AdminPAT, len(pats))
	for i, p := range pats {
		out[i] = app.AdminPAT{
			ID: p.ID, Name: p.Name, Prefix: p.Prefix,
			LastUsedAt: p.LastUsedAt, ExpiresAt: p.ExpiresAt, CreatedAt: p.CreatedAt,
		}
	}
	return out, nil
}

func (u *UserOps) RevokePAT(ctx context.Context, userID, patID string) error {
	return u.tokens.RevokePATFor(ctx, userID, patID)
}

func (u *UserOps) DeleteAccount(ctx context.Context, actorEmail, userID string) error {

	return u.account.DeleteAccountFor(ctx, &webx.Principal{Email: actorEmail}, userID)
}

type WorkspaceLister struct{ Repo *adminpg.Repo }

func NewWorkspaceLister(repo *adminpg.Repo) *WorkspaceLister {
	return &WorkspaceLister{Repo: repo}
}

func (w *WorkspaceLister) ListUserWorkspaces(ctx context.Context, userID string) ([]app.AdminUserWorkspace, error) {
	return w.Repo.ListUserWorkspaces(ctx, userID)
}

type WsOps struct {
	Svc *workspaceapp.WorkspaceService
}

func (w *WsOps) UpdateMemberRole(ctx context.Context, actor *webx.Principal, wsID, targetUserID, newRole string) error {
	return w.Svc.UpdateMemberRole(ctx, actor, wsID, targetUserID, newRole)
}

func (w *WsOps) RemoveMember(ctx context.Context, actor *webx.Principal, wsID, targetUserID string) error {
	return w.Svc.RemoveMember(ctx, actor, wsID, targetUserID)
}

func (w *WsOps) DeleteWorkspace(ctx context.Context, actor *webx.Principal, wsID string) error {
	return w.Svc.DeleteWorkspace(ctx, actor, wsID)
}

func (w *WsOps) TransferOwnership(ctx context.Context, actor *webx.Principal, wsID, newOwnerUserID string) error {
	return w.Svc.TransferOwnership(ctx, actor, wsID, newOwnerUserID)
}

type Announcer struct {
	NotifySvc *notifyapp.NotifyService
	Repo      *adminpg.Repo
}

func NewAnnouncer(notifySvc *notifyapp.NotifyService, repo *adminpg.Repo) *Announcer {
	return &Announcer{NotifySvc: notifySvc, Repo: repo}
}

func (a *Announcer) Notify(ctx context.Context, in app.NotifyInput) error {
	return a.NotifySvc.Notify(ctx, notifyapp.NotifyInput{
		UserID: in.UserID, Type: in.Type, Title: in.Title,
		Body: in.Body, Link: in.Link, DedupKey: in.DedupKey,
	})
}

func (a *Announcer) AllActiveUserIDs(ctx context.Context) ([]string, error) {
	return a.Repo.AllActiveUserIDs(ctx)
}

type BillingOps struct {
	Svc *billingapp.BillingAdminService
}

func (b *BillingOps) ListAllOrders(ctx context.Context, workspaceID, status string, limit, offset int) ([]app.AdminOrder, int, error) {
	views, total, err := b.Svc.ListAllOrders(ctx, billingapp.AdminOrderFilter{WorkspaceID: workspaceID, Status: status}, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	out := make([]app.AdminOrder, len(views))
	for i, v := range views {
		out[i] = app.AdminOrder{
			ID: v.ID, WorkspaceID: v.WorkspaceID, WorkspaceName: v.WorkspaceName,
			UserID: v.UserID, PlanCode: v.PlanCode, Interval: string(v.Interval),
			AmountCents: v.AmountCents, Currency: v.Currency, Channel: v.Channel,
			Status: string(v.Status), ChannelRef: v.ChannelRef, PaidAt: v.PaidAt,
			CanceledAt: v.CanceledAt, RefundedAt: v.RefundedAt, CreatedAt: v.CreatedAt,
		}
	}
	return out, total, nil
}

func (b *BillingOps) ListPaymentEvents(ctx context.Context, workspaceID string, limit, offset int) ([]app.AdminPaymentEvent, int, error) {
	views, total, err := b.Svc.ListPaymentEvents(ctx, billingapp.PaymentEventFilter{WorkspaceID: workspaceID}, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	out := make([]app.AdminPaymentEvent, len(views))
	for i, v := range views {
		out[i] = app.AdminPaymentEvent{
			ID: v.ID, Channel: v.Channel, ChannelEventID: v.ChannelEventID,
			EventType: v.Type, OrderID: v.OrderID, ProcessStatus: v.ProcessStatus,
			ProcessError: v.ProcessError, ProcessedAt: v.ProcessedAt, Processed: v.Processed,
			CreatedAt: v.CreatedAt,
		}
	}
	return out, total, nil
}

func (b *BillingOps) AdminCancelPendingOrder(ctx context.Context, actor *webx.Principal, orderID string) error {
	return b.Svc.AdminCancelPendingOrder(ctx, actor, orderID)
}

func (b *BillingOps) RunExpiryNow(ctx context.Context) (int, error)  { return b.Svc.RunExpiryNow(ctx) }
func (b *BillingOps) RunOverageNow(ctx context.Context) (int, error) { return b.Svc.RunOverageNow(ctx) }

func (b *BillingOps) ListPlanCodes(ctx context.Context) ([]string, error) {
	return b.Svc.ListPlanCodes(ctx)
}

func (b *BillingOps) ListPlanViews(ctx context.Context) ([]app.AdminPlanView, error) {
	views, err := b.Svc.ListPlanViews(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]app.AdminPlanView, len(views))
	for i, v := range views {
		out[i] = app.AdminPlanView{
			Code: v.Code, Name: v.Name, Currency: v.Currency,
			TrialDays: v.TrialDays, SortNo: v.SortNo, Limits: v.Limits,
		}
	}
	return out, nil
}

func (b *BillingOps) MarkOrderPaid(ctx context.Context, actor *webx.Principal, orderID string) error {
	return b.Svc.MarkOrderPaid(ctx, actor, orderID)
}

func (b *BillingOps) BillingConfig(ctx context.Context) (app.AdminBillingConfig, error) {
	view, err := b.Svc.BillingConfig(ctx)
	if err != nil {
		return app.AdminBillingConfig{}, err
	}
	out := make([]app.AdminBillingChannel, len(view.Channels))
	for i, v := range view.Channels {
		out[i] = app.AdminBillingChannel{
			Name: v.Name, Configured: v.Configured, KeyMasked: v.KeyMasked,
			WebhookConfigured: v.WebhookConfigured,
		}
	}
	return app.AdminBillingConfig{Channels: out}, nil
}

func (b *BillingOps) TestChannelConnection(ctx context.Context, channel string) error {
	return b.Svc.TestChannelConnection(ctx, channel)
}

func (b *BillingOps) AdminCancelSubscription(ctx context.Context, actor *webx.Principal, workspaceID string) error {
	return b.Svc.AdminCancelSubscription(ctx, actor, workspaceID)
}

type WebhookOps struct{ Svc *webhooksapp.WebhookService }

func mapDelivery(v webhooksapp.AdminDeliveryView) app.AdminWebhookDelivery {
	return app.AdminWebhookDelivery{
		ID: v.ID, WorkspaceID: v.WorkspaceID, URL: v.URL,
		SubscriptionID: v.SubscriptionID, EventID: v.EventID, EventType: v.EventType,
		Status: v.Status, Attempts: v.Attempts,
		LastStatusCode: v.LastStatusCode, LastError: v.LastError,
		DeliveredAt: v.DeliveredAt, CreatedAt: v.CreatedAt,
	}
}

func (w *WebhookOps) ListAllDeliveries(ctx context.Context, workspaceID, status string, limit, offset int) ([]app.AdminWebhookDelivery, int, error) {
	views, total, err := w.Svc.ListAllDeliveries(ctx, webhooksapp.DeliveryFilter{WorkspaceID: workspaceID, Status: status}, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	out := make([]app.AdminWebhookDelivery, len(views))
	for i, v := range views {
		out[i] = mapDelivery(v)
	}
	return out, total, nil
}

func (w *WebhookOps) AdminRedeliver(ctx context.Context, deliveryID string) (app.AdminWebhookDelivery, error) {
	v, err := w.Svc.AdminRedeliver(ctx, deliveryID)
	if err != nil {
		return app.AdminWebhookDelivery{}, err
	}
	return mapDelivery(v), nil
}

var (
	_ app.UserDetailProvider = (*UserOps)(nil)
	_ app.WorkspaceLister    = (*WorkspaceLister)(nil)
	_ app.WorkspaceAdminOps  = (*WsOps)(nil)
	_ app.Announcer          = (*Announcer)(nil)
	_ app.BillingAdminOps    = (*BillingOps)(nil)
	_ app.WebhookAdminOps    = (*WebhookOps)(nil)
)
