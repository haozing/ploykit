# ploykit 宿主改造清单

> 本清单已按宿主代码实际成熟度做过一轮校准（2026-06-17）。
> 原则不变：**接口归宿主、策略归产品；前置依赖驱动落地顺序；不在产品需求出现前把策略固化进地基。**

---

## 〇、现状校准（先纠正几处"现状"误判）

落地前先对齐宿主实际已有的能力，避免把"补字段 / 换实现"当成"大改造"，也避免重复造轮子：

| 清单原描述 | 实际现状 | 影响 |
|---|---|---|
| 审计是松散的 `{type, metadata}`，需"升级为一等 schema" | 已有 `RuntimeStoreAuditRecord.integrity`：`schemaVersion / category / risk / resourceType / resourceId / correlationId / previousHash / recordHash`——已是哈希链式一等审计 | 3.6 降级为"补字段"，非重写 |
| reserve/confirm/refund 需引入 `runAtomic` 抽象 | 已有 `RuntimeStore.transaction`，且 redeem 路径已用 `pg_advisory_xact_lock` 做并发控制 | 原子性原语已存在，2.1 不需重建事务层 |
| 限流是"进程内 Map"，需升级为持久存储 | 限流是能力接口 `ModuleRateLimitApi`，由宿主注入实现 | 3.8 是"换实现"，架构不动 |
| 需新增"密钥托管"替代静态内存 map | secrets 确实是静态只读 map（`createStaticModuleSecretsApi`），无签名密钥——**此项准确** | 1.2 接口化成立，但范围要收 |
| `RuntimeStoreScope` 缺 environment 轴 | 确实无 `environmentId`——**此项准确** | 1.1 成立，真地基 |
| `createModuleCapabilityMeter` 已存在但未接线 | 初始判断准确；当前已接入 `services.invoke` 并写通用 `egress.call` usage | 2.4 已闭环 |

结论：清单**方法论正确，但把宿主成熟度估低、把范围铺大**。下面按"是否必须现在加的通用能力"重新分档。

---

## 一、现在做（真地基级，阻断后续工作）

只有两项达到"地基级、晚做迁移成本陡增"的标准。

### 处理进度（2026-06-17）

| 条目 | 状态 | 说明 |
|---|---|---|
| 1.1 environment（dev/live）租户轴 | 已处理（当前地基） | `RuntimeStoreScope` 已补 `environmentId`；通用幂等表/索引、host action/API route 幂等中间件、runs/outbox 的幂等键/查询/claim、API key 创建/验证/list 均已按 product + environment + workspace 分域。旧历史域是否补 environment 不应无边界横切，后续只在出现明确 dev/live 隔离语义的域内迁移。 |
| 1.2 幂等表（Stripe 式写 API 幂等） | 已处理 | 已新增通用 `module_idempotency_keys` 表、memory/Postgres store 原语、schema/index 审计、action route 中间件与 API route contract/runtime 包装；支持首响应缓存、`request_hash` 冲突 400、`in_progress` 409、`locked_at` 恢复、24h GC 和 environment 分域。具体哪些 endpoint 启用仍由模块 contract 声明。 |
| 1.3(a) 额度金额类型硬化 | 已处理（非破坏性） | commercial/credits/checkout/refund/redeem 等权威金额入口已运行时强制 safe integer minor unit，拒绝小数和超安全整数；public SDK 仍保留 `number` 以避免本轮破坏性升级，品牌类型或 decimal string 留到 major 版本切换。 |
| 1.3(b) 预扣超时回收 | 已处理 | `module_credit_reservations` 新增 `expires_at` + expiry index；runtime store、commercial runtime 会释放过期 reserved reservation 并写 `reserve.expired` 回补账。 |

### 1.1 environment（dev/live）租户轴

| 项 | 说明 |
|---|---|
| 为什么现在做 | 一旦后续能力落了数据再回头加 `environmentId`，复合唯一键/索引/幂等键前缀全要迁移，成本陡增。这是真正的横切地基。 |
| 改什么 | 已落地 `RuntimeStoreScope`、通用幂等、runs/outbox、API key 的 `environmentId` 分域；product-scope resolver 提供默认 environment。旧历史域不做盲目全表迁移，只在具体域出现 dev/live 隔离语义时补字段和索引。 |
| 范围提醒 | 本质是"加一个字段 + 谓词注入"，不是大工程。别借机扩散到别的改动。 |
| 不属于宿主的 | environment 的具体含义（如"仅 live 计费"）是产品策略配置 |

### 1.2 幂等表（Stripe 式写 API 幂等）

| 项 | 说明 |
|---|---|
| 为什么现在做 | 当前只有"每操作一个 `idempotencyKey` 字段"，缺"首次响应字节级缓存 + in_progress 锁 + request_hash 冲突检测"。对任何写 API 高度通用，且越早接入中间件越省后续返工。 |
| 改什么 | 新增 `idempotency_key` 表（scope 命名空间 + 首次响应字节级缓存 + `request_hash` 同 key 不同 body 冲突 400 + `in_progress` 409 锁 + `locked_at` 卡死恢复 + 24h GC）；包装成中间件，模块可声明哪些 action/route 启用 |
| 不属于宿主的 | 具体哪些 endpoint 需要幂等由模块 contract 声明 |

### 1.3 额度账本：只做两件低成本硬化（不做全量重做）

| 项 | 说明 |
|---|---|
| 为什么现在做 | 金额用 JS `number` 承载权威额度是**精度 bug 风险**，越早改越便宜；预扣无超时回收会导致额度泄漏。这两件便宜且收益明确。 |
| 改什么 | (a) 权威金额入口运行时强制整数 minor unit / safe integer，public SDK 类型升级到品牌类型或 decimal string 留到 major 版本；(b) 预扣加 `expires_at` 并在 runtime/commercial 路径释放过期 reservation、写 `reserve.expired` 回补账。 |
| 明确**不做** | 复式三桶账本（available/reserved/settled）、wallet 投影表 + 乐观锁 + CHECK 约束——见三.1，留到有真实并发对账需求时。现有 `status` 单桶 + reservation 表 + advisory-lock 事务对"有预扣/结算"的大多数场景够用。 |

---

## 二、小补丁（通用，但只是补字段/换实现，别当大改造）

这些方向通用且应做，但宿主骨架已在，工作量是补字段或换实现，不要重写。

### 处理进度（2026-06-17）

| 条目 | 状态 | 说明 |
|---|---|---|
| 2.1 审计补字段 | 已处理（通用字段） | `_audit` envelope 已补 `actorKind`、`decision`、`ipHash`、`userAgentHash`、`beforeHash`、`afterHash`，审计 metadata 已对 `ip/ua/userAgent/before/after` 等敏感字段脱敏，并新增 integrity 校验测试；同步 fail-closed vs 异步 outbox 属于每类 action 的风险策略，不在宿主层无差别硬编码。 |
| 2.2 API Key 补 rotating / environment | 已处理 | key 存储走 SHA-256 hash + 唯一索引；runtime store/迁移/host capability/SDK 已补 `environmentId`、`createdBy`、per-key `rateLimit` 和 `rotating` 状态，verify/list 按 environment 分域并兼容历史 null 环境 key；`rotate()` 已改为新 key 新记录、旧 key 进入 `rotating` grace window，`revoke()` 会撤销同一 rotation family。 |
| 2.3 限流换持久实现 | 已处理 | 已新增 `module_rate_limit_events` 表、Postgres advisory-lock sliding-window limiter、schema/index audit 和 host security 可插拔 limiter；宿主启动时若 runtime store 有 Postgres database 会自动切到共享 sliding-window limiter，memory 仅作为无 Postgres 的本地/dev fallback。token-bucket 属于后续算法优化，不阻塞当前生产闭环。 |
| 2.4 计量接入网关 | 已处理（通用接线） | `services.invoke` 已接入 `createModuleCapabilityMeter` 并为出站服务调用写入通用 `egress.call` usage（含服务/操作/状态/响应尺寸/latency 摘要）；`reserve→转发→confirm` 扣费编排与更细的产品计量规则属于模块/商业策略层，不作为宿主通用强制。 |
| 2.5 退款安全冲正原语 | 已处理 | `ModuleCreditsApi` 已新增 `refundRevoke`，可按 `grantLedgerId` 或 source/sourceId 针对 grant 批次撤回额度；底层复用 `consumeCreditLedger` 的 advisory-lock/余额不变负约束，按 idempotency key 重放，记录 `relatedLedgerIds` 并返回 `unrecovered` 缺口给产品层风控处理。 |
| 2.6 webhook 验签按 connection 路由 | 已处理（通用层） | runtime-store webhook gateway 已有 receipt、签名 provider、重复收件和 outbox；secretResolver 支持 provider/connection/environment 输入，host route 支持 connection slug，密钥候选按 env/provider/connection 维度解析，Postgres store 支持时 receive + enqueue 在同一 transaction。Paddle/LemonSqueezy 等 provider-specific header/timestamp 规则应在真实接入对应 provider 时以 adapter 扩展，不作为当前宿主通用缺口。 |

### 2.1 审计补字段（骨架已是一等 schema）

| 项 | 说明 |
|---|---|
| 现状 | `RuntimeStoreAuditRecord.integrity` 已有 schemaVersion/category/risk/resource/correlationId/哈希链。 |
| 补什么 | `actor_kind / ip / ua`、`decision`(allow/deny/success/failure)、`before_hash/after_hash`；写入策略分同步 fail-closed（高风险）vs 异步 outbox（高频 success）；PII 脱敏白名单（email→sha256） |
| 不属于宿主的 | 具体哪些 action 枚举值、哪些字段需要脱敏——产品层按需注册 |

### 2.2 API Key 补 rotating / environment

| 项 | 说明 |
|---|---|
| 现状 | `findApiKeyByHash` 已走 SHA-256 hash + prefix lookup；API key 记录已按 product/environment/workspace/module 分域。 |
| 补什么 | 已补 `rotating`、`environment_id`、`created_by`、per-key `rate_limit` JSONB；`rotate()` 采用新 key 新记录、旧 key grace window，撤销按 rotation family 一起失效。 |
| 不属于宿主的 | 具体 scope/permissions 枚举值是产品定义 |

### 2.3 限流换持久实现（接口不变）

| 项 | 说明 |
|---|---|
| 现状 | 限流是注入式能力接口 `ModuleRateLimitApi`，架构无需改；host security 也支持注入 runtime limiter。 |
| 改什么 | 已提供 Postgres advisory-lock sliding-window 共享实现，并在宿主启动时对 durable Postgres runtime store 自动启用；memory limiter 只保留给无 Postgres 的本地/dev。token-bucket 可作为后续算法优化。 |
| 不属于宿主的 | 具体哪些 endpoint 限多少 rps 是产品配置 |

### 2.4 计量接入网关（meter 上线）

| 项 | 说明 |
|---|---|
| 现状 | `createModuleCapabilityMeter` 已接入 `services.invoke`，出站服务调用会写通用 `egress.call` usage。 |
| 改什么 | 通用接线已完成；`reserve→转发→confirm` 扣费编排、AI 真 token 估算和版本化计量规则归模块/商业策略层，不在宿主层硬编码。 |
| 不属于宿主的 | 计量规则 13 种 method、版本化规则表、cost estimation 函数——产品配置/模块逻辑 |

### 2.5 退款安全冲正原语（refund_revoke）

| 项 | 说明 |
|---|---|
| 通用性 | 任何接支付退款并需要撤回已发放额度的产品都能复用。通用原语。 |
| 改什么 | 针对具体 grant 批次的反向冲正；在 advisory-lock 下复核余额（套用现有 redeem 的 advisory-lock 套路）；钳在 available 不变负（`GREATEST(available, 0)`）；按 `(wallet, refund_revoke, idempotency_key)` 幂等；记 `related_ledger_id` + 来源引用；返回"未追回缺口"给上层做风控 |
| 依赖 | 依赖 1.2 幂等表。可与计量上线同期做。 |
| 不属于宿主的 | 冲正后的业务处理（如冻结 License、通知用户）是产品层编排 |

### 2.6 webhook 验签按 connection 路由（按需）

| 项 | 说明 |
|---|---|
| 通用性 | 任何接入第三方 webhook 的产品都需要按连接定位密钥。通用，但触发点是"真接第三方"。 |
| 改什么 | 已将 `secretResolver` 签名扩展为 `{provider, connectionSlug, environmentId}`，支持 connection slug 路由和 env/provider/connection 维度密钥候选；内置 provider 覆盖 Stripe/GitHub/通用 HMAC-SHA256；receive + enqueue 在支持 transaction 的 store 下原子执行。Paddle/LemonSqueezy 等专有签名头留到真实接入时以 provider adapter 增补。 |
| 不属于宿主的 | 具体接哪些支付商、event_type 映射规则、provisioning 逻辑——全部是产品层 |

---

## 三、等触发点再做（现在做 = 提前优化）

这些通用，但当前产品范围不要求；在需求出现前内建会把策略固化进地基，违反本清单自己的原则。

### 核实结论（2026-06-17）

| 条目 | 状态 | 说明 |
|---|---|---|
| 3.1 复式分桶账本全量重做 | 暂不处理（分析成立） | 本轮已完成金额整数化、预扣过期释放与 `refundRevoke` 缺口返回；现有 ledger + reservation + advisory-lock 覆盖当前用例，尚无必须引入三桶 wallet 投影和 `balance_after` 快照的并发对账触发点。 |
| 3.2 整套认证 / 凭据 / 身份模型 | 暂不处理（分析成立） | 宿主已有 `ModuleHostSessionResolver`、host user/session/reset 等产品壳能力，但没有把 password/OAuth/OTP/magic-link/匿名升级做成通用模块凭据 broker 的当前需求；继续保持接口注入。 |
| 3.3 签名密钥托管的非对称部分 | 暂不处理（分析成立） | 当前只补了 webhook secret resolver 的 environment/provider/connection 输入；`ctx.secrets` 仍是接口/静态实现，尚未出现对外 JWT/JWKS/非对称私钥托管的触发点。 |
| 3.4 设备表骨架 + 原子名额扣减 | 暂不处理（分析成立） | 代码中未见通用 device/seat 一等模型；per-device 授权仍应由具体模块用 data runtime + 条件更新实现，宿主暂不押注该产品形态。 |
| 3.5 RBAC 扩档 + platform_user 分离 | 暂不处理（分析成立） | 当前 `ModuleWorkspaceRole`/权限矩阵已有基础角色和 capability guard；尚无平台运营者与终端用户彻底分表的需求证据，暂不新增 `platform_user`。 |
| 3.6 risk.check 自动门禁 + risk_block 生命周期 | 暂不处理（分析成立） | `recordRiskEvent`/`upsertRiskBlock`/`ctx.risk.check` 已存在；尚未把风险命中自动嵌入 access/charge/redeem，也未补 active block partial unique/lifecycle 字段，等实时封禁需求出现再做。 |

### 3.1 复式分桶账本全量重做

| 项 | 说明 |
|---|---|
| 触发点 | 出现真实的高并发权威记账 / 对账需求时。 |
| 为什么不现在做 | 现有 `status` 单桶 + reservation 表 + advisory-lock 事务，对"有预扣/结算"的大多数场景够用。三桶（available/reserved/settled）+ wallet 投影 + 乐观锁 + CHECK 是更严谨，但属于"重写记账核心"，在没有并发对账压力时是过度工程。金额精度与预扣回收已在 1.3 单独前置处理。 |
| 届时做什么 | 账本改分桶复式（有符号 delta、`txn_group_id` 成对、固定 reason taxonomy、`related_ledger_id` 冲正链、`balance_after` 审计快照）；缓存 `wallet` 投影表（三桶 + version 乐观锁 + CHECK(available>=0)，同事务写入） |
| 不属于宿主的 | 多钱包优先级扣减引擎；钱包 `owner_type` 多态枚举值由产品定义 |

### 3.2 整套认证 / 凭据 / 身份模型（原 1.3 + 1.4 + 1.5）

| 项 | 说明 |
|---|---|
| 触发点 | 第二阶段"用户自助登录 / 多登录方式绑定 / 匿名→正式升级"成为产品需求时。 |
| 为什么不现在做 | 与"第三方 Key 自助录入"同款判断：**第一阶段产品范围（应用/模型/输入/引擎/输出/试跑/版本/调用/记录）不要求用户自助登录**。宿主已有 `ModuleHostSessionResolver` 注入点——宿主只需定义"会话长什么样、怎么解析"的接口，具体登录方式归产品/模块。把整套 IAM（auth_session、JWT、refresh 轮转、Argon2id、OAuth PKCE、OTP、magic-link、匿名升级）内建进宿主，是在产品没要求时把策略固化进地基。 |
| 届时做什么 | `auth_session` 表 + 短 JWT（依赖签名密钥）+ 不透明 refresh（SHA-256 存储 + 轮转 + family 撤销 RFC 9700）；`credential.verify(provider, input)` 调度接口 + 内置 password/oauth/otp/magic-link provider；`hosted_user` + `user_identity` 一对多凭据表 + 匿名升级单事务 |
| 前置 | 签发对外 JWT 时才需要 1.2 的**非对称密钥生成/轮换/JWKS 分发**部分（见下） |

### 3.3 签名密钥托管的非对称部分（原 1.2 后半）

| 项 | 说明 |
|---|---|
| 触发点 | 真要签发对外 JWT / 签名请求 / 验证 webhook 时（即与 3.2 同期）。 |
| 现在做什么 | 仅把静态 secrets map 抽象为 `SecretBackend` 接口（对接 KMS / Workers Secrets / Vault / 加密文件），保持只读；secrets 写入/轮转留到第二阶段"第三方服务自助接入"时补。 |
| 届时做什么 | 非对称密钥对（EdDSA/ES256）生成/轮换/私钥隔离；JWKS 式公钥分发 |
| 不属于宿主的 | 具体用哪个 KMS 厂商是部署配置，宿主只定义接口 |

### 3.4 设备表骨架 + 原子名额扣减

| 项 | 说明 |
|---|---|
| 触发点 | 出现真正按 per-device/per-seat 授权的产品时。 |
| 为什么不现在做 | 清单第四节已承认指纹引擎/冷却规则不进宿主。剩下的"device 表 + 原子名额扣减"本质是"一张表 + 一个条件 UPDATE"，用现有 data runtime + 条件更新套路在模块层即可实现。做成宿主一等表是在赌"很多产品按设备授权"，无数据支撑。 |
| 届时做什么 | `device` 表 + N 态状态机框架；原子名额扣减 `UPDATE … SET device_count=device_count+1 WHERE device_count < :limit RETURNING`；把 `device` 加入 `ctx.risk` 的 subject_kind |
| 不属于宿主的 | 指纹相似度算法/权重；解绑冷却天数/换机配额；状态枚举值；离线宽限 token 签发 |

### 3.5 RBAC 扩档 + platform_user 分离

| 项 | 说明 |
|---|---|
| 触发点 | 出现"平台运营者 vs 终端用户"分离的真实运营需求时。 |
| 届时做什么 | `ModuleWorkspaceRole` 加 `developer`/`support`，权限矩阵扩展；新增 `platform_user` 表（与 hosted_user 分离），session `authKind` 加 operator；"support 写 → 必 audit"由宿主强制 |
| 不属于宿主的 | 具体角色能做哪些业务操作是产品权限矩阵的值 |

### 3.6 risk.check 自动门禁 + risk_block 生命周期

| 项 | 说明 |
|---|---|
| 触发点 | 需要实时封禁进入 access 闸门时（已有 `recordRiskEvent`/`upsertRiskBlock` 存储原语，差"自动嵌入门禁 + 生命周期约束"）。 |
| 届时做什么 | `risk.check` 自动嵌入 access.check/charge/redeem（命中活跃 block → deny + reason_code）；`risk_block` 加 partial unique（WHERE released_at IS NULL）+ imposed_by/released_by；`risk_event` 加 status 生命周期 + resolved_by |
| 不属于宿主的 | risk_type taxonomy 是产品策略配置 |

---

## 四、明确不进宿主的（留产品层/模块/Go 核心）

### 核实结论（2026-06-17）

| 能力 | 状态 | 说明 |
|---|---|---|
| 设备指纹相似度引擎（加权多信号模糊匹配） | 不处理（归属正确） | 属于特定反共享/风控产品算法，不应进入通用宿主。 |
| 解绑冷却天数 / 月换机配额规则 | 不处理（归属正确） | 是产品策略；宿主只需在需要时提供可组合时间戳/数据原语。 |
| License 8 种类型状态机 | 不处理（归属正确） | 可骑 `entitlements`/商业原语由具体模块编排，宿主不固化许可证 taxonomy。 |
| 离线宽限 token 签发 | 不处理（归属正确） | 仅本地客户端/离线授权产品需要，依赖客户端 SDK 与签名策略。 |
| 多钱包优先级扣减引擎 | 不处理（归属正确） | 当前已补 `refundRevoke` 等账本原语；复杂扣减优先级留模块组合。 |
| RFC 8628 Device Code 流程 | 不处理（归属正确） | CLI/设备登录产品专用，不属于当前宿主通用地基。 |
| billing_event 9 态处理机 | 不处理（归属正确） | 支付事件映射和 provisioning 是产品编排；宿主保留订单/发票/退款原语。 |
| metering_rule 13 种 method | 不处理（归属正确） | 本轮只接通 `egress.call` 通用 usage；具体计量 rule 表留模块配置。 |
| payment_mapping 配置 | 不处理（归属正确） | 支付商 SKU/权益映射属于产品策略配置。 |
| 反向隧道 / Agent / Cloud Relay 数据面 | 不处理（归属正确） | 长连接/数据面不适合塞进 Next.js 宿主，应留 Go 核心或专用服务。 |

| 能力 | 为什么不是通用宿主能力 | 应该放哪 |
|---|---|---|
| 设备指纹相似度引擎（加权多信号模糊匹配） | 只有反共享场景需要，算法是竞争壁垒 | ToolDock 模块/Go 核心 |
| 解绑冷却天数 / 月换机配额规则 | 产品策略参数 | 模块配置，宿主只提供 cooldown timestamp 字段 |
| License 8 种类型状态机 | 特有商业模型 | ToolDock 模块（骑 entitlement 基底） |
| 离线宽限 token 签发 | 只有本地客户端产品需要 | ToolDock 模块 + 客户端 SDK |
| 多钱包优先级扣减引擎 | 复杂场景专用，多数产品单钱包足够 | ToolDock 模块逻辑（调宿主账本原语组合） |
| RFC 8628 Device Code 流程 | 只有 CLI 产品需要 | ToolDock 模块 |
| billing_event 9 态处理机 | 支付编排逻辑 | ToolDock 模块 |
| metering_rule 13 种 method | 计量规则 | 模块配置表 |
| payment_mapping 配置 | 产品策略 | 模块配置表 |
| 反向隧道 / Agent / Cloud Relay 数据面 | 长连接，Next.js 不擅长 | Go 核心 |

---

## 五、落地顺序

```
现在做（真地基，阻断后续）
  1.1 environment 轴
  1.2 幂等表
  1.3 额度账本两件硬化（金额类型 + 预扣超时回收）

小补丁（顺手做，补字段/换实现）
  2.1 审计补字段
  2.2 API Key 补 rotating / environment
  2.3 限流换持久实现
  2.4 计量接入网关
  2.5 退款冲正原语（依赖 1.2）
  2.6 webhook 按 connection 验签（接第三方时）

等触发点再做（现在做 = 提前优化）
  3.1 复式三桶账本     ← 真实并发对账需求
  3.2 整套认证/凭据/身份 ← 第二阶段自助登录
  3.3 非对称签名密钥    ← 与 3.2 同期
  3.4 设备表           ← 真正 per-seat 产品
  3.5 RBAC + platform_user ← 运营者/终端用户分离需求
  3.6 risk 自动门禁     ← 实时封禁需求
```

每阶段完成后跑 ploykit gates 验证：`modules:check` / `module:doctor` / `test:commercial-*` / `test:runtime-stores`。

---

## 六、一句话总结

清单方法论正确（接口归宿主、策略归产品、前置依赖驱动），但原版把宿主成熟度估低、范围铺大。**真正"必须现在加的通用能力"只有 environment 轴和幂等表两项是地基级**；额度账本只需两件低成本硬化；其余要么是补字段/换实现的小补丁，要么是该等产品需求再做的策略——不该现在固化进宿主。
