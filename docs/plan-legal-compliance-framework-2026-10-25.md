# Plan: 法务与合规框架化 —— shuijing 协议改版实战复盘 → legal 最小合规内核

> Status: **audited 2026-10-25 round 1**（见 `audit-legal-compliance-plan-2026-10-25.md`：
> L1–L8 = 2 项事实修正 + 2 项设计纠偏 + 3 项 DX 简化 + 1 项裁剪，已回写本文；L1 修正
> 取消器覆盖面（waffo/paypal 已实现、stripe 缺）、L2 修正 LC-4 语义（AdminCancelSubscription
> 立即降级与周期末承诺冲突）、L4–L6 把接入面收敛为 **一行 Wire + 一次 RegisterDocs**）。
> **2026-10-26 勘误（L1 二次修正）**：stripe.Channel 实已实现 SubscriptionCanceller
> （v0.15.0 起，`billing/adapters/stripe/channel.go` CancelSubscription），下文"stripe 缺
> 取消器/进运营队列"表述按当时认知保留，事实以本行为准——stripe 的 Caps 声明已改为与
> 实现一致（`CancelTiming=immediate`：DELETE /v1/subscriptions 为立即取消调用）。
> Source: shuijing 产品仓 2026-10-25 Waffo Pancake（MoR）账号审核模板对齐——TOS/Privacy
> 由 10/6 节重写为 18/14 节（产品仓工作树未提交，`web/src/lib/i18n/messages/{en,zh}.ts`
> 各 +192/-64），本文把这次改版当成一次"合规压力测试"，复盘全部摩擦点，结合业界调研
> 给出 ploykit 的分期改造方案。目标形态：**法务身份/占位符走 settings，接受有留痕，
> 用户自助取消/导出/删除有端点，文案承诺有系统兜底——产品接入面 = 一行 Wire + 一次
> RegisterDocs，默认状态下可见复杂度为零**。

## 0. 拆分规则（沿用 plan-upstream-shuijing-admin-billing.md §0）

"换一个 ploykit 产品要不要？" → 框架；"只对本产品有意义" → 产品。

本次判例：**协议文本本身属产品**（每个站的法务措辞、AI 模型、画廊授权差异太大，框架
不托管文案）；**合规的"骨架"属框架**——占位符解析、接受留痕、自助取消、DSAR 导出/
删除、保留期清扫、变更通知，这些每个站都会重复写，且写错的代价是监管风险而非功能
bug。框架提供机制，产品提供措辞；**文档版本随代码发布**（正文本来就在产品仓 i18n
里，DB 存版本就是第二真源——审计 L4）。

## 1. 实战复盘：这次协议改版踩到的每一个坑（证据表）

改版全程发生在产品仓，每行"当时的解法"都是框架缺位的补丁。这是本设计的全部需求来源。

| # | 摩擦点 | 当时的解法（产品仓） | 框架化归属 |
|---|---|---|---|
| F1 | 法定姓名/管辖法占位符手填——`[Your full legal name]`/`[governing jurisdiction]` 中英共 8 处，上线前纯人工 grep 核对 | 文案里留占位符，报告里列清单提醒用户填 | LC-1 法务设置键组 |
| F2 | **承诺与实现脱节三例**：①TOS §6 写"付款邮件里的订阅管理链接"（站内并无取消入口）；②隐私政策写"日志 30 天/事件 12 个月"（服务器日志无轮转配置）；③写"删除账号即移除数据"（框架只有 soft-delete，无导出） | 写进文案时人工确认了一遍现状；没有机制防止未来漂移 | LC-4/LC-5/LC-6 + LC-9 对账卡 |
| F3 | 协议文案硬编码在产品仓 i18n 文件（en/zh × terms/privacy 四份手工同步），且 SEO description 也内嵌其中 | 手工同步，靠 tsc 的 Messages 类型对齐保证键不缺 | LC-2 文档注册表（结构化数据，不托管文案） |
| F4 | 退款政策两处真源：TOS §7 文本 vs Waffo Pancake 店铺设置里的退款政策（收银台自动展示）——口径必须人工保持一致 | 手工复制粘贴 | LC-9 对账卡提醒项（退款文案单一真源在渠道侧，框架不越界） |
| F5 | 条款变更邮件义务（TOS 14 天/隐私 15 天提前通知账号持有者）——纯承诺，无邮件任务支撑 | 写了承诺，实现为零 | LC-7 武装好的通知按钮 |
| F6 | SignInForm 渲染"登录即同意 服务条款 与 隐私政策"（termsUrl+privacyUrl 齐备即出），**但接受行为零留痕**——无版本号、无时间戳、无方式记录。click-through 争议里拿不出用户同意了哪一版的证据 | 无处理（UI 承诺了，数据库没有） | LC-3 接受留痕（挂 IdentityHooks） |
| F7 | MoR 名称 "Waffo Pancake" 硬编码进两份协议 10 处——哪天切 Stripe/PayPal 直连，全部变成谎言 | 手写进文案 | LC-1/LC-6（`payment_processor_name` 由 billing 当前渠道活值解析，文案占位符自动跟上） |
| F8 | Waffo 模板自身要求"三选一计费章节（V1 订阅/V2 积分/V3 混合）+ 占位符清单 + 版本号生效日"——核对纯人工 | 人工按模板逐节对照 | LC-2 文档元数据（billing_model/version/effective_from）+ LC-9 审计卡 |
| F9 | **CA ARL（AB 2863，2025-07-01 生效）：取消须与注册同介质同难度**——注册是站内表单，取消却只有渠道邮件门户。~~waffo 适配器未实现 SubscriptionCanceller~~（审计 L1 修正：**waffo/paypal 已实现（billing plan BC-9/F13 已落地），stripe 才是缺口**；2026-10-26 勘误：stripe 亦已实现，见文首）；真正的两个缺口=①无终端用户自助取消端点（AdminCancelSubscription 是 admin-only）；②admin 取消语义是**立即降级 free+清空订阅**（service_billingcfg.go:105-121），与"权益保留到周期末"的承诺直接冲突 | TOS 里写"用付款邮件里的管理链接或发邮件"——严格说已违反同介质要求 | LC-4 用户自助取消（Caps 声明取消时序） |
| F10 | 隐私政策"我们收集什么"依赖工程自觉——shuijing 的 analytics 无 PII 是 event.go 注释里的硬规则，框架层面无约束、无对账清单 | 手工照实写 | LC-9（对账清单：声明项 vs 框架已知数据面） |

## 2. 业界调研：五个模式，采不采逐个裁决

### 2.1 条款版本化 + 接受留痕（audit trail）→ **采，P0**

共识做法（ToughClicks 2025、Sirion、TermsFeed、ABA 合同实践）：每次接受记录
**谁、哪一版、何时、什么方式（勾选/隐式续用）、IP/客户端环境**；重大变更时弹再接受
门；记录不可变、可导出给法务。SaaS 判例法（click-through 可执行性）的核心就是拿得出
"该用户于某日接受了某版"的证据。GitHub/Atlassian 另有版本 diff 页——**不采**（对我们
量级的站点是过度设计），保留"版本号+生效日"展示即可。

### 2.2 隐私中心 / DSAR 自助 → **采瘦版，P1**

代表：Optimizely（账户设置内 Access or Deletion 入口）、Klaviyo（导出档案+删除+请求
日志）。企业版做独立"隐私中心"门户+请求工单队列+身份核验流程（OneTrust/SecurePrivacy
整条产品线）。我们裁剪为：**账号设置内两个按钮**——导出我的数据（JSON，30 天时限
自动满足）、删除我的账号（复用已有 `DeleteAccount` soft-delete + 补 purge 期）。
不做请求工单队列（邮件即工单，量级不支持）、不做 OneTrust 对接。

### 2.3 Sub-processor 注册表公开页 → **采自动推导版，P2**

代表：Stripe/Vercel 的 `/subprocessors` 公开页+变更邮件订阅。GDPR Art.28 链路里控制者
有义务向用户告知处理者名单。审计 L7 升级：**框架自己那份名单从活配置自动推导**——
邮件通道（resend/smtp）、billing 渠道（OrderedChannels→"Waffo Pancake"/"Stripe"/
"PayPal"）都是框架已知事实，不可能与实际配置漂移；产品只补产品侧供应商（Google
OAuth、hiapi/OpenAI）一行注册。不做变更邮件订阅。

### 2.4 订阅取消合规 → **采，P0（风险最高的一项）**

法规现状（2026-10 核实）：FTC click-to-cancel（Negative Option Rule）2025-07 被
第八巡回法院**程序性撤销**、从未生效；但 **California AB 2863（修订版自动续费法）
2025-07-01 已生效且不受影响**——要求取消机制与注册同介质同难度（线上注册→线上
一键取消）；另有律师行跟踪 FTC 复活动向（Jones Day 2026-05），方向只会更严不是更松。
EU 侧：数字内容 14 天撤销权 + 续费前提醒。结论：**站内自助取消端点是一切订阅站的
安全默认**，不依赖渠道门户是否存在。

### 2.5 承诺-实现对账（retention sweeper 等）→ **采，P1**

业界的"privacy by design"落到工程上就是：文案承诺的每个数字（保留期、Cookie 类别、
数据面）有系统行为兜底。我们已有正面案例：shuijing analytics 无 PII 硬规则、订单
过期清扫工（billing plan BC-4 / 迁移 049）。缺的是**框架自有表的保留期清扫**；
服务器日志（nginx/systemd）在框架管辖外——文档给 logrotate 模板，不假装能管。

## 3. 合规义务矩阵（法规 × 义务 × 框架承载点 × 现状）

| 法规 | 关键义务 | 框架承载点 | 现状 |
|---|---|---|---|
| GDPR | 知情/访问/更正/删除/可携带/反对，30 天响应；72h 泄露通知；记录处理活动 | LC-5 导出+删除；泄露通知=runbook 文档（不建系统）；RoPA 不建表 | 部分（有删除无导出） |
| CCPA/CPRA | 知情/删除/退出"出售"；不出售声明 | 文案层（产品）；LC-5 删除 | 缺自助 |
| ePrivacy | 非必要 Cookie 需同意；严格必要可免横幅 | **不加 Cookie 横幅**——全生态只有 session+CSRF（严格必要）；若产品将来加统计类 Cookie，LC-2 文档注册表加 cookie 声明节即可 | 合规（靠不做什么） |
| CA ARL / EU CRD | 取消同介质同难度；续费提醒；14 天撤销权 | LC-4 自助取消（P0）；续费提醒邮件=P2 可选 | **缺（最高风险）** |
| PCI-DSS | 卡数据不落站 | MoR 模式天然转嫁（Waffo Pancake）；文案声明"支付处理方=X"由 LC-1 活值注入 | 合规 |
| COPPA/年龄 | 13/16 最低年龄声明 | 文案层（产品），LC-2 元数据带 min_age 提醒项 | 文案已有 |

## 4. 框架现状盘点（改造的既有地基，审计 round 1 全部核实 @ v0.15.0）

- **settings v0.15 KeySpec 注册表**（`settings/registry.go:20`）：Key/Description/
  Sensitive/Env/Default/Validate/Normalize；**产品注册键自动渲染进 AdminSettingsPage
  产品卡**（`packages/ui/src/pages/admin/AdminSettingsPage.tsx:208-211`——"effective 里
  出现在内建集之外"的键即出卡）——`legal_*` 键注册即得后台编辑+env 回退，零新 UI。
- **IdentityHooks**（`identity/hooks.go`）：**接受留痕的天然挂点，零 identity 改动**
  （审计 S7/L3）——`AfterRegister` 在**全部注册路径**触发（密码/admin/OAuth JIT/验证码
  JIT），幂等且失败下次登录补跑（hooks.go:21-31）；`AfterLogin` 每次成功登录触发、
  观察语义不阻断（hooks.go:36-39）。LC-3 的三个写入点=这两个现成钩子。
- **webx ctx 客户端元数据**：ClientMetadata（platform/version/OS）已在 ctx
  （`platform/webx/client.go:11-31`）；ClientIP 每请求现算（`webx/ratelimit.go:36`，
  AccessLog 在用）但**未入 ctx**——补一对 `WithClientIP/ClientIPFrom`（照 client.go
  模式）即让钩子层拿到 IP；接受留痕记 platform/version/OS，不存原始 UA 串。
- **audit.Recorder**（`audit/audit.go`）：Record/RecordTx 双模式（`account.deleted`
  已在用）——接受/DSAR 动作同步写一条 audit 行，不另发明日志。
- **identity.AccountService.DeleteAccount**（`identity/app/service_account.go:54`）：
  soft-delete 事务+审计已在——DSAR 删除地基；缺导出与到期 purge。
- **billing**：`SubscriptionCanceller` 可选能力——**waffo（adapters/waffo/channel.go:176）
  与 paypal（adapters/paypal/channel.go:176）已实现，stripe 未实现**（审计 L1；
  2026-10-26 勘误：stripe 同样已实现，且其取消为立即生效——Caps 已声明
  `CancelTiming=immediate`，见文首勘误）；
  `ChannelCaps` 能力描述符是渠道知识单一真源（waffo channel.go:55）——LC-4 的取消
  时序声明挂这里。admin 侧 AdminCancelSubscription 语义=立即降级（F9/L2），用户侧
  端点不复用它。
- **schedule + platform/cronx**：定时任务基建在（订单过期清扫工先例=迁移 049）——
  retention sweeper 与"周期末取消"续费缺位清扫直接挂。
- **notify/mailtpl**（v0.15）：邮件模板单一真源，三通道免费兼容——条款变更通知加
  一套模板即入。
- **packages/ui SignInForm**：termsUrl+privacyUrl 齐备自动渲染法务行（SignInForm.tsx:
  67-111）——前端已承诺，LC-3 只补后端记录。
- **公开 /config 面**：settings/adapters/http 已是公开配置端点、全部产品前端已消费、
  预渲染 loader 已 warm——LC-6 的法务块搭车，不新增消费面（审计 L6）。
- **一行接线先例**：provisioning.PersonalWorkspace 工厂（example/cmd/app/main.go:
  487-498，ADR 0016）——LC-1 的 `legal.Wire` 照此形态。
- **migrations**：下一个可用 052。

## 5. 设计原则

1. **文案是数据不是代码，版本随代码发布**：协议文本留在产品仓，框架只定义元数据
   契约（版本/生效日/计费模式/占位符清单）——不建 DB 文档表（审计 L4：正文在产品
   i18n 里，DB 存版本=第二真源）。
2. **能 settings 不代码，能注册不复制**：法务身份、管辖法、联系方式全部是 settings
   键，**KeySpec 由框架的 Wire() 统一注册**，产品零手工拷贝（审计 L5）。
3. **活值优先于快照**：支付处理方名、sub-processor 名单从 billing/notify 当前配置
   实时推导——换渠道文案自动跟上，名单永不漂移（审计 L7）。
4. **承诺可执行才可书写**：文案里每个数字（保留期/取消路径/导出）必须在框架里有
   对应机制，admin 卡上能对账——写出来做不到=监管证据。
5. **留痕复用 audit 与 IdentityHooks**：不建平行体系，不动 identity 签名。
6. **可见复杂度为零直到需要**：不 Wire 的产品行为与今天完全一致；产品接入面收敛为
   **一行 `legal.Wire(cfg)` + 一次 `RegisterDocs(...)`**，其余全可选。

## 6. 模块设计（LC-1 … LC-9，已并入审计 L2–L8 修正）

### LC-1 `legal.Wire` 一行接线（P0）

```go
legal.Wire(legal.Config{
    Store: store, Sessions: sessions, Auditor: auditor, Log: log,
    // 可选:NotifySender(变更通知)、BillingChannels(sub-processor 推导)
})
```

Wire 内部完成：①注册全部 `legal_*` KeySpec（框架持有规格，产品不复制）；②挂
IdentityHooks（AfterRegister→注册接受、AfterLogin→补登录接受，见 LC-3）；③注册
LC-6 框架自有清扫工；④把 `legal` 块并入公开 /config（见 LC-6）。产品接入总量=
**一行 Wire + 一次 RegisterDocs**（+可选 RegisterSubprocessor/DataContributor）。
先例=provisioning.PersonalWorkspace 工厂。

法务键组（全部非敏感，Wire 注册）：

```
legal_entity_name        法定名称（个人姓名或公司注册名；LC-9 卡对缺值红灯）
legal_entity_address     注册地址（个人经营者可空——校验允许空+卡提示）
legal_jurisdiction       管辖法（如 "the laws of Singapore"）
legal_contact_email      法务/隐私统一邮箱（缺省回退 notify 发件地址的产品约定）
legal_billing_model      v1_subscription | v2_credits | v3_hybrid（对齐 Waffo 模板三选一）
legal_min_age            13/16（文案提醒用）
```

### LC-2 文档代码注册表（P0 元数据 / P2 可选渲染）

```go
legal.RegisterDocs(
    legal.Doc{Key: "tos", Version: "1.0", EffectiveFrom: parsing("2026-10-25"),
              BillingModel: "v1_subscription", MaterialChange: false,
              Placeholders: []string{"legal_entity_name", "payment_processor_name"}},
    legal.Doc{Key: "privacy", ...},
)
```

- **版本随代码发布**（审计 L4）：无 DB 表、无 admin CRUD；元数据是编译期常量，
  `legal_billing_model` 与 Doc 声明不一致=启动期 fail-fast（模板三选一对账自动化，
  F8）。
- P2 可选：框架出极简法务页组件（吃结构化 sections），新产品零文案起步用；产品
  自渲染正文永远受支持（shuijing 路径）。

### LC-3 接受留痕（P0，挂 IdentityHooks）

`legal_acceptances(user_id, doc_key, doc_version, method, ip, client_platform,
client_version, client_os, accepted_at)`，`(user_id, doc_key, doc_version)` 唯一。

- 写入点=两个现成钩子（审计 L3，零 identity 改动）：`AfterRegister`→method=signup
  （全注册路径含 OAuth/验证码 JIT，幂等契约由钩子层保证）；`AfterLogin`→method=
  login_implicit（当前版本未记录过才补一行）。
- IP 经 webx 新增 `WithClientIP/ClientIPFrom`（照 client.go ctx 模式，AccessLog
  同源取值）；客户端环境用现有 ClientMetadata，不存原始 UA 串。
- 显式再接受 `POST /api/legal/acceptances`（method=reaccept，五行 handler，P0）；
  **再接受横幅 UI 降 P2**（审计 L8——端点便宜、横幅是年轻站点用不上的表面面积）。
- admin 查询：按用户导出接受历史（应对争议/审计）；同步写一条 audit 行。
- 不做：登录页强制勾选框（"登录即同意"措辞+留痕已是行业标准形态，不添摩擦）。

### LC-4 用户自助取消端点（P0，合规风险最高项；审计 L2 重设计）

`POST /api/billing/subscription/cancel`（登录态，本人订阅）：

- 渠道实现 `SubscriptionCanceller` → **渠道直通取消**（waffo/paypal 今日即可）；
- **取消时序是渠道知识，进 ChannelCaps**：新增 `CancelTiming: immediate |
  period_end`（Caps 已是渠道能力单一真源）——immediate→本地立即 ChangeWorkspacePlan
  （同 admin 现语义）；period_end→置 `cancel_requested` + 续费事件缺位清扫工收尾
  （订单过期清扫工同模式）；
- 渠道未实现（~~stripe 今日~~；2026-10-26 勘误：stripe 已实现 canceller 且立即取消，
  此分支仅剩第三方无 canceller 渠道）→ 返回现有 `CodeChannelCancelUnsupported` + 请求进
  **运营队列**（LC-9 卡可见），如实告知"已受理，人工在渠道后台完成"——**绝不假称
  自助停扣**（MoR 自动续费下，没有渠道 API 框架拦不住下一笔扣款，原方案的"站内
  兜底立即停扣"是做不到的承诺，审计 L2 已纠正）；
- ui 包出 AccountSettings 可选"取消订阅"按钮（props 不传不渲染），确认弹窗按 Caps
  时序显示"立即生效/有效期至 X"。

### LC-5 DSAR 导出与删除（P1）

- `GET /api/account/export`：聚合 JSON（身份资料、接受记录、订单/权益、产品贡献块）。
  产品注册 `DataContributor` 回调（镜像 billing OnPlanChangedTx 钩子模式）补业务数据
  （shuijing 注册"设计列表"）。同步导出，30 天时限天然达标。
- 删除：复用 `DeleteAccount`（soft-delete）；新增 `purged_at` 列 + 到期硬删（LC-6）。
  soft-delete（防误删/风控）与硬删（GDPR 擦除）分两段，窗口期写进隐私政策模板。
- **税务例外显式化**：billing 订单按会计要求保留（GDPR Art.17(3)(b) 法定例外），
  导出/删除时明示哪些留下了、为什么。

### LC-6 /config 法务块 + 框架自有表清扫（P0 块 / P1 清扫）

- **搭现有公开 /config**（审计 L6，零新消费面）：

```json
"legal": {
  "entity_name": "…", "jurisdiction": "…",
  "processor_name": "Waffo Pancake",          ← billing 当前渠道活值推导
  "docs": [{"key":"tos","version":"1.0","effective_from":"2026-10-25"}]
}
```

  产品法务页/预渲染 loader 从这里取占位符解析值——shuijing 的 8 处手填占位符变成
  读配置，换渠道文案自动跟上（F1/F7 一并解决）。
- **清扫工=具体实现不建注册表**（审计 L8）：框架自有三张面——soft-deleted 用户到期
  purge（默认 30d）、acceptances 随 purge 连带删、analytics 事件（默认 365d）——
  `retention_*` 键调参（Wire 注册，又是自动卡）。产品表给 SQL 模板文档，不给 API。
- 服务器日志框架外：docs/ 给 logrotate/nginx 模板，LC-9 卡标注"人工项"。

### LC-7 条款变更通知：武装好的按钮（P1；审计 L4 改形）

版本随代码发布 → 变更通知不再是"admin 保存新版触发"，而是 admin 卡上一个**显式
按钮**："就版本 X 向全部账号发送变更通知"——预填模板（版本号/生效日=发布日+14 天
TOS 或 +15 天 privacy/查看链接），二次确认后群发（复用 mailtpl+notify 三通道）。
**绝不自动群发**（自动邮件是不可撤回动作，必须有人扣扳机）。

### LC-8 Sub-processor 名单：活配置自动推导（P2；审计 L7）

框架份自动生成：邮件通道（resend→Resend、smtp→SMTP provider）、billing 渠道
（OrderedChannels→Waffo Pancake/Stripe/PayPal）、托管地（文档注明）。产品份一行
注册：`legal.RegisterSubprocessor(name, purpose, url)`（shuijing 注册 Google OAuth、
hiapi/OpenAI）。输出：`GET /api/legal/subprocessors` 公开端点+ui 极简表格组件。
无 JSON textarea、永不与实际配置漂移。

### LC-9 admin 合规对账卡（P0 lite / P2 完整）

AdminShell 下一张"Compliance"卡：

- **占位符缺口红灯**（P0，读 settings 即得）：哪些 legal_* 键未填、`/config.legal`
  里哪些占位符还是空——F1 的 grep 人工环节变成后台红灯；
- **承诺对账清单**（P0 lite）：导出端点在不在、retention 任务最近一次跑没跑、取消
  端点渠道直通还是运营队列、退款政策渠道侧是否已配（提示项，F4）；
- 接受覆盖率（当前版本已接受/活跃用户）、DSAR 计数、取消运营队列——P2 计数查询。

## 7. 数据模型与迁移（编号顺延；审计 L4 后比原稿少一张表）

```
052_legal_acceptances.up.sql    -- 上节 DDL + (user_id, doc_key, doc_version) 唯一
053_account_purge.up.sql        -- identity users 加 purged_at;billing 订单保留例外不加列(现表已足)
```

legal_documents **不建表**（版本=代码常量）；audit 不加表（复用现有）。

## 8. API 面（对齐 api-conventions；审计后净减两条）

| 端点 | 方法 | 面 | 说明 |
|---|---|---|---|
| `/config` 的 `legal` 块 | GET | 公开 | 占位符解析值+文档版本（搭现有端点，替代原 `/api/legal/documents`） |
| `/api/legal/subprocessors` | GET | 公开 | LC-8，P2 |
| `/api/legal/acceptances` | POST | 登录 | 显式再接受（method=reaccept） |
| `/api/account/export` | GET | 登录 | LC-5 JSON 导出 |
| `/api/billing/subscription/cancel` | POST | 登录 | LC-4 自助取消（Caps 时序） |
| `/api/admin/legal/acceptances` | GET | admin | 按用户查接受历史 |
| `/api/admin/legal/notify` | POST | admin | LC-7 武装好的变更通知按钮 |
| `/api/admin/legal/compliance` | GET | admin | LC-9 对账卡数据 |

（原稿 `PUT /api/admin/legal/documents` 随 DB 文档表一起删除——版本随代码。）

## 9. 前端（packages/ui）

- SignInForm：不加东西（法务行已在）；接受写入在服务端钩子链完成。
- AccountSettings：可选区块 `LegalAndPrivacySection`（props：onExport、订阅状态与
  CancelTiming、onCancel）——不传 props 不渲染。
- `TermsReacceptBanner`：P2 可选（端点 P0 已在，横幅表面面积后置——审计 L8）。
- **Boundary（2026-10-25 P0 交付声明）**：`LegalAndPrivacySection` 不在 example 挂载——
  它的 props 需要产品侧装配订阅数据与取消/导出动作（example 的账号页没有这套装配缝），
  API 数据源已随本批提供（GET /api/billing/subscription 的 cancel_requested_at /
  renews_at / cancel_timing 三字段 + POST /api/billing/subscription/cancel），
  `AdminComplianceCard` 经 children 缝挂在 example admin 设置页（NavVisibilityCard 先例）。

## 10. 分期与验收

**P0（LC-1 Wire/LC-2/LC-3/LC-4 + LC-6 config 块 + LC-9 lite）——验收**：example
一行 Wire+RegisterDocs 后——admin 扩展卡出现 6 个 legal_* 键；新用户注册（含 OAuth
JIT 路径）产生 acceptance 行（版本/IP/客户端环境齐）；`POST /cancel` 在 waffo 渠道
直通取消、无 canceller 渠道返回 CodeChannelCancelUnsupported+进队列；`/config.legal`
返回 entity/jurisdiction/processor_name 活值与文档版本；billing_model 与 Doc 不一致
启动期 fail-fast；合规卡对缺 legal_entity_name 亮红灯。hermetic 测试+example 真库
全链。

**P1（LC-5/LC-6 清扫/LC-7）——验收**：导出 JSON 含身份/订单/接受记录+产品贡献块；
soft-deleted 用户 30 天后 purge（测试用短 TTL）；purge 连带删 acceptance；变更通知
按钮在 emaildev 断言邮件内容与生效日。

**P2（LC-8 + LC-2 完整渲染 + LC-9 计数 + 横幅）——验收**：sub-processor 端点输出
=活配置推导∪产品注册项（换渠道→输出变，无需人工）；框架法务页组件渲染 example
示例文档。

**shuijing 迁移路径**（P0 落地后）：一行 Wire+RegisterDocs（版本 1.0/2026-10-25）→
i18n 文案 8 处占位符改吃 `/config.legal`（预渲染 loader 取值）→ 注册/登录自动留痕 →
AccountSettings 挂取消按钮（TOS §6 文案改"账户设置内一键取消"）→ DataContributor
补设计列表导出 → RegisterSubprocessor 补 Google/hiapi。

## 11. 不做清单（防 scope 蔓延）

- Cookie 同意横幅/CMP——全生态仅严格必要 Cookie，加横幅是负合规。将来真加统计
  Cookie 时另立 plan。
- OneTrust/任何第三方合规平台对接。
- 多法域定制文案、法务 DSL、条款 diff 视图。
- DPA 自动签署/信任中心门户——DPA 按需邮件人工。
- RoPA 表——个体经营量级，文档模板足够。
- 邮件退订管理（全生态只发事务邮件，无营销列表）。
- 通用 RetentionSweeper 注册表 API（审计 L8：具体清扫工+产品 SQL 模板足够）。

## 12. 风险与开放问题

1. **个人经营者 vs 公司**：legal_entity_name 语义取决于用户主体形态，键描述给两种
   示例；不做法人校验。
2. **soft-delete 窗口 vs GDPR 擦除权**：purge 窗口在隐私政策里如实声明（"删除请求
   后最多 N 天内彻底清除"），文案模板随 LC-5 给。
3. **waffo 取消 API 时序语义未知**（immediate 还是 period_end）——external，LC-4
   实现时实测一次并写进 waffo Caps()；这是 P0 验收里的活验证项。
4. **接受留痕的 IP 存储**本身是个人数据——保留期挂账号生命周期（purge 连带删，
   LC-6 清扫面已含）。
5. **生效日硬编码 14/15 天**是否可配——先默认值，真有需求再加键。
6. **群发上限**：小账号量直接发；若站点过万账号，LC-7 按钮需分批发——实现期注意，
   不进设计。

## 13. 参考资料

- Waffo 模板（本次实战的需求源）：docs.waffo.ai/zh/mor/account-reviews/tos、
  …/privacy-policy
- 接受留痕：[ToughClicks — In-App Contract Acceptance Best Practices](https://toughclicks.com/blog/in-app-contract-acceptance-best-practices-for-product-teams)、
  [Sirion — T&C vs EULA](https://www.sirion.ai/library/contract-management/terms-and-conditions-vs-eula)
- DSAR 自助：[Optimizely — Request or delete data](https://docs.optimizely.com/experimentation-strategy/docs/request-or-delete-data-under-the-general-data-protection-regulation-gdpr-or-california-consumer-privacy-act-ccpa)、
  [Klaviyo — GDPR/CCPA requests](https://help.klaviyo.com/hc/en-us/articles/360004217631)
- 取消法规：[Fenwick — Eighth Circuit vacates Click-to-Cancel](https://www.fenwick.com/insights/publications/eighth-circuit-vacates-ftcs-click-to-cancel-rule)、
  [Lowenstein — CA ARL intact after FTC rule on hold](https://www.lowenstein.com/news-insights/publications/client-alerts/ftc-click-to-cancel-rule-on-hold-but-california-s-automatic-renewal-law-remains-intact-what-companies-need-to-know-privacy)、
  [Jones Day — FTC revives click-to-cancel (2026-05)](https://www.jonesday.com/en/insights/2026/05/ftc-revives-clicktocancel-rule-new-risks-for-subscription-businesses)
- CCPA 官方：[California AG — CCPA overview](https://oag.ca.gov/privacy/ccpa)
