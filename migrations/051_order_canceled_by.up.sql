-- P0 弃单清扫 vs 迟到支付事件竞态（2026-10-24 billing 内核修复 #1）：
-- ExpireStaleOrders 零宽限期清扫 + handlePaid 撞 canceled 终局忽略，
-- 导致「用户已付款但渠道 webhook 迟到（重试/发布在途）」的钱被丢弃。
-- canceled_by 记录取消来源，复活路径据此判定：
--   'expiry' — 弃单清扫取消；迟到 paid 事件允许 canceled→paid 复活；
--   'user'   — 用户主动取消；不可复活；
--   'admin'  — 管理员取消；不可复活；
--   NULL     — 051 之前的存量行；语义 = 不可复活（宁可漏复活不可错发权益）。
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS canceled_by text;
