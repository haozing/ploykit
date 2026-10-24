// Package simhttp 是 sim 模拟渠道的 DEV 测试 HTTP 面（「模拟三个支付渠道的
// 测试接口」），供人工 curl / 外部脚本驱动全管线：
//
//	POST /dev/billing-sim/{channel}/checkout   下单（走真实 svc.CreateCheckout）
//	POST /dev/billing-sim/{channel}/event      构造签名事件投递（真实
//	                                          svc.HandleWebhook,raw body 保真）
//	GET  /dev/billing-sim/{channel}/approve    本地 approve 占位页（会话回跳目标）
//
// channel ∈ simwaffo | simpaypal | simstripe。
//
// THIS SURFACE IS DEV-ONLY AND MUST NEVER BE MOUNTED IN PRODUCTION —— it
// forges payment webhooks. Mount 时以 Deps.Production=true 直接 panic 兜底
// （接线侧必须同时用 PLOYKIT_DEV_ENABLED=1 且非 production 双重门控）。
// 本包路由刻意放在 sim/simhttp 而非 */adapters/http：tools/check_api.py 只
// 扫描各域 adapters/http 与 example 主干——DEV 测试面不入 OpenAPI 契约。
package simhttp

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/billing/adapters/sim"
	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

// Deps wires the dev billing-sim surface.
type Deps struct {
	Svc      *app.BillingService
	Channels app.ChannelSet // sim 渠道实例来源（取当前验签密钥；热重建后取新实例）
	Repo     app.Repo       // 订单反查（事件旋钮自动补全）
	Pool     *pgxpool.Pool  // 下单旋钮落点（plan 价格覆盖 / expires_at 改写）
	Now      func() time.Time
	Log      *slog.Logger

	// Production=true 时 Mount 直接 panic——DEV-ONLY 的编译期外兜底。
	Production bool
}

// Mount registers the dev billing-sim endpoints. DEV-ONLY：见包注释。
func Mount(mux webx.Router, deps Deps) {
	if deps.Production {
		panic("simhttp: DEV-ONLY billing simulator mounted with Production=true — 绝不能进生产（伪造支付 webhook 的接口）")
	}
	if deps.Now == nil {
		deps.Now = func() time.Time { return time.Now().UTC() }
	}
	if deps.Log == nil {
		deps.Log = slog.Default()
	}
	mux.HandleFunc("POST /dev/billing-sim/{channel}/checkout", deps.handleCheckout)
	mux.HandleFunc("POST /dev/billing-sim/{channel}/event", deps.handleEvent)
	mux.HandleFunc("GET /dev/billing-sim/{channel}/approve", deps.handleApprove)
}

// simChannelOf 校验路径上的渠道名确实是注册在案的 sim 方言渠道。
func (d Deps) simChannelOf(w http.ResponseWriter, r *http.Request) string {
	name := r.PathValue("channel")
	ch, ok := d.Channels.Get(name)
	if !ok {
		webx.ErrNotFound(w, "unknown payment channel: "+name)
		return ""
	}
	if _, ok := ch.(sim.Signer); !ok {
		webx.ErrNotFound(w, "not a sim channel: "+name)
		return ""
	}
	return name
}

// checkoutReq 是下单请求体。amount 是**分**（整数，覆盖 plan 价格——先改
// plan 再下单，订单金额由真实管线生成）；expires_in 是秒（可负——负值把
// order.expires_at 挪到过去，驱动弃单清扫/竞态场景；0=不动）。
type checkoutReq struct {
	Workspace string `json:"workspace"`
	Plan      string `json:"plan"`
	Interval  string `json:"interval"`
	Amount    int    `json:"amount"`
	Currency  string `json:"currency"`
	ExpiresIn int    `json:"expires_in"`
}

func (d Deps) handleCheckout(w http.ResponseWriter, r *http.Request) {
	channel := d.simChannelOf(w, r)
	if channel == "" {
		return
	}
	var req checkoutReq
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Workspace == "" || req.Plan == "" || req.Interval == "" {
		webx.ErrValidation(w, "workspace/plan/interval required")
		return
	}
	interval := domain.BillingInterval(req.Interval)
	if req.Amount > 0 || req.Currency != "" {
		if err := sim.OverridePlanPrice(r.Context(), d.Pool, req.Plan, interval, req.Amount, req.Currency); err != nil {
			webx.WriteErr(w, err)
			return
		}
	}
	userID, err := sim.WorkspaceOwner(r.Context(), d.Pool, req.Workspace)
	if err != nil {
		webx.ErrNotFound(w, "workspace not found: "+req.Workspace)
		return
	}
	p := &webx.Principal{UserID: userID, WorkspaceID: req.Workspace}
	session, err := d.Svc.CreateCheckout(r.Context(), p, req.Workspace, req.Plan, interval, channel)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	expiresAt := session.ExpiresAt
	if req.ExpiresIn != 0 {
		expiresAt = d.Now().Add(time.Duration(req.ExpiresIn) * time.Second)
		if err := sim.SetOrderExpiresAt(r.Context(), d.Pool, session.OrderID, expiresAt); err != nil {
			webx.WriteErr(w, err)
			return
		}
	}
	webx.WriteJSON(w, http.StatusCreated, map[string]any{
		"order_id":     session.OrderID,
		"channel":      session.Channel,
		"action_url":   session.ActionURL,
		"session_ref":  session.SessionRef,
		"expires_at":   expiresAt,
		"webhook_hint": "POST /dev/billing-sim/" + channel + "/event 用 event_type + order_id 投递支付事件",
	})
}

// eventReq 是事件投递请求体：EventSpec 的 JSON 形态。agreement_id /
// custom_id 为 *string 三态：缺省(nil)=自动补全；""=显式缺失（复刻个别
// 载荷形态）；非空=指定。amount 是字符串（"4500"/"4500.00"/畸形都收）。
type eventReq struct {
	EventType          string  `json:"event_type"`
	OrderID            string  `json:"order_id"`
	ID                 string  `json:"id"`
	EventID            string  `json:"event_id"`
	Amount             string  `json:"amount"`
	Currency           string  `json:"currency"`
	PeriodNumber       int     `json:"period_number"`
	SaleID             string  `json:"sale_id"`
	PaymentStatus      string  `json:"payment_status"`
	AgreementID        *string `json:"agreement_id"`
	CustomID           *string `json:"custom_id"`
	TotalRefundedShape bool    `json:"total_refunded_shape"`
	Repeat             int     `json:"repeat"`
}

func (d Deps) handleEvent(w http.ResponseWriter, r *http.Request) {
	channel := d.simChannelOf(w, r)
	if channel == "" {
		return
	}
	var req eventReq
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if req.EventType == "" {
		webx.ErrValidation(w, "event_type required")
		return
	}
	spec := sim.EventSpec{
		Type:               req.EventType,
		OrderID:            req.OrderID,
		ID:                 req.ID,
		EventID:            req.EventID,
		Amount:             req.Amount,
		Currency:           req.Currency,
		PeriodNumber:       req.PeriodNumber,
		SaleID:             req.SaleID,
		PaymentStatus:      req.PaymentStatus,
		TotalRefundedShape: req.TotalRefundedShape,
		Repeat:             req.Repeat,
	}
	if req.AgreementID != nil && *req.AgreementID == "" {
		spec.DropAgreementID = true
	}
	if req.CustomID != nil && *req.CustomID == "" {
		spec.DropCustomID = true
	}
	repeat := spec.Repeat
	if repeat < 1 {
		repeat = 1
	}
	// 与 Harness.Deliver 同一份「补全→建信封→签名」代码；同进程 handler
	// 直接进 Svc.HandleWebhook（真实 HTTP 入口在 billinghttp 里也只是包
	// raw body 后调它——raw body 与验签保真，注释说明的降级路径）。
	var lastErr error
	for i := 0; i < repeat; i++ {
		if err := sim.DeliverTo(r.Context(), d.Svc, d.Channels, d.Repo, channel, spec); err != nil {
			lastErr = err
			break
		}
	}
	if lastErr != nil {
		webx.WriteErr(w, lastErr)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"status":   "received",
		"channel":  channel,
		"order_id": spec.OrderID,
		"repeat":   repeat,
	})
}

// handleApprove 是 CreateCheckout 返回的本地 approve URL 的落点：一个
// 说明页（告诉驱动方下一步用 event 端点完成/取消支付），不产生副作用。
func (d Deps) handleApprove(w http.ResponseWriter, r *http.Request) {
	channel := r.PathValue("channel")
	orderID := r.URL.Query().Get("order")
	if _, ok := d.Channels.Get(channel); !ok {
		webx.ErrNotFound(w, "unknown payment channel: "+channel)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"channel":  channel,
		"order_id": orderID,
		"page":     "sim approve (no-op placeholder)",
		"hint":     "buyer-side action is simulated by POSTing an event: e.g. {\"event_type\":\"subscription.activated\",\"order_id\":\"" + orderID + "\"} to /dev/billing-sim/" + channel + "/event",
	})
}
