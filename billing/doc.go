// Package billing is the billing domain: plans, orders, subscriptions, and
// the channel-agnostic payment-event pipeline (event idempotency, amount
// reconciliation, order state machine, entitlement hooks) shared by every
// payment channel adapter under billing/adapters.
//
// # 适配器契约五律
//
// 新增渠道的验收清单，源自 waffo 首个非 Stripe 渠道接入复盘，
// docs/plan-billing-channel-framework-2026-10-23.md §BC-4：
//
//  1. 钱事件唯一：续费类生命周期每个计费周期只产生一个 EventSubscriptionRenewed，
//     取"钱到账"事件（waffo=payment_succeeded、stripe=invoice.paid、
//     paypal=PAYMENT.SALE.COMPLETED）；周期滚动通知（如 waffo subscription.renewed）
//     必须映射为 ignored。
//  2. 首期去重：首笔付款同时触发激活+付款双事件时，只映射激活事件为
//     EventCheckoutCompleted（waffo 以 periodNumber=1 判定）。
//  3. 稳定订阅引用：SubscriptionRef = 渠道侧跨周期不变的标识（stripe=subscription
//     id、waffo=orderId）；结账会话 metadata 必须带 order_id 并确认渠道会回传
//     （waffo orderMetadata 全事件透传）。
//  4. ChannelEventID 全局唯一：库表幂等键是 (channel, channel_event_id) 复合列、
//     无事件类型维度；渠道侧幂等键为 (type, id) 二元组时（waffo），必须拼进
//     ChannelEventID 这一个字段（"type:id"）。
//  5. 环境标记：事件带 mode: test|prod 时记入 Payload 并审计；渠道配置了 mode 时
//     跨环境事件直接拒收（test 回调永不落生产权益）。
//
// 五律契约修订（2026-10-24 billing 内核修复 #3，续期路径两条）：
//
//  6. 续期事件锚 PI：续期事件（EventSubscriptionRenewed）携带 OrderID 与
//     PaymentIntentRef 时，内核把 PI 落库进订单 metadata（SetOrderPaymentIntentRef）。
//     此前全仓只在 checkout.completed 落 PI，续期发票漏锚导致后续仅携 PI 的
//     退款/失败事件反查不到订单。渠道适配器因此必须在续期事件里尽量带上 PI。
//  7. 续期金额对账：续期事件携带 OrderID 且金额 > 0 时，内核按订单 planCode+interval
//     查「当前」plan 价格对账（目录价即收款价，改价必须同步——这条防线原本只在
//     handlePaid 生效，续期路径是漏洞）。不等（EqualFold 比币种）则拒发续期：
//     log.Error + 审计 billing.amount_mismatch + 事件收敛 processed；plan 缺失或
//     无价则跳过对账。OrderID 为空的续期（waffo/stripe）不受影响。
package billing
