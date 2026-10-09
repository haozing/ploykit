# authorization — 强授权档

YAML 操作目录（闭集校验 + 确定性哈希）+ 阶段化纯函数评估器
（authentication → scope → membership → role → policy → input，deny 携带阶段与
原因码）+ 三值决策（allow / deny / **challenge**）+ 规则注册表（内置
assurance / recent-auth 两条通用 step-up 规则，产品可注入自有规则与 fact 键）
+ 事务内 Facts Provider。

本包自包含：不 import 框架其他包（含 `authz`）。

## authorization ↔ authz 概念映射（风险 F3 的解）

`authz/`（简单档）与本包（强档）**并列共存，互不依赖**：简单档是单层 RBAC
权限点检查，强档是操作目录驱动的闭集评估。不存在迁移压力——同一产品可以只用
简单档，也可以按操作逐个切换到强档。

### 什么场景用哪档

| 场景 | 用哪档 |
|---|---|
| "角色 → 权限点"够用（单层 workspace，owner/admin/member 式角色映射） | **authz**：`Authorizer.Can(principal, "tasks:write")`，一个中间件 `Require` 搞定路由保护 |
| 需要 step-up（AAL2 / recent-auth / sudo 模式） | **authorization**：challenge 是一等决策，携带目标操作、要求的 assurance、max-age |
| 凭据要绑 scope（细粒度 PAT / 机器凭据，GitHub FG-PAT 形态） | **authorization**：`ScopedTokenPrincipal` / `MachineCredentialPrincipal`，scope 精确匹配不可替换 |
| 需要 deny 可解释（哪个阶段、什么原因码）供审计/反枚举策略 | **authorization**：`Decision{Stage, ReasonCode}` 结构化拒绝 |
| 操作集要可哈希、可对账（目录 ↔ 路由 ↔ 契约比对） | **authorization**：`Catalog.Hash()` 确定性哈希是 C4 contractx 的地基 |
| 嵌套 scope（workspace → project 两层） | 两档都留了形状；强档的 scope 输入类型（`WorkspaceScope` / `ProjectScope`）两层原生 |

### 词汇对应表

| authz（简单档） | authorization（强档） | 对应关系 |
|---|---|---|
| `Permission`（`域:动作`，如 `tasks:write`） | `Operation.OperationID`（产品自定义，如 `op.task.update`） | 权限点 ↔ 目录操作条目；强档每个操作是一条显式声明 |
| `域:*` 通配、`*_own` 后缀 | **不存在**（目录内禁通配；资源属主判定走产品规则注册表或调用方 facts） | 强档闭集确定性优先；两者互斥（重做 §1.7） |
| `RoleOwner/Admin/Member` + `RoleSet` 显式集合 | `roles.workspace` / `roles.project` 词汇表（产品数据）+ 操作的 `allowed_*_roles` | 两档都无角色继承：owner ⊇ admin 靠显式集合，强档靠"交集非空"判定 |
| `Catalog`（Go 代码 Register 权限点） | `Catalog`（YAML 文件 + 严格 schema 校验 + 哈希） | 简单档词汇在代码里；强档词汇是可对账的数据文件 |
| `Authorizer.Can/CanIn(ctx, p, perm) bool` | `Evaluate(Request) Decision` / `Evaluator.Authorize(ctx, opID, ...)` | 两值布尔 ↔ 三值决策（含 challenge） |
| `authz.Require(a, perm)` 中间件 | **无中间件入口**（刻意） | F3 缓解：中间件入口不重复建设。强档消费者直接调 evaluator，传输层路由 resolver（method+path → operation）是产品侧职责 |
| `Provider.PermsFor` + **30s TTL 缓存** | `FactsProvider.Facts(ctx, principal, scope)`，**无缓存** | 一致性权衡差异：强档约定在调用方事务内取事实（撤销即时一致）；接受读旧可自行包装 provider，那是显式选择 |
| 平台管理员旁路 `IsPlatformAdmin → true` | 无旁路（每个操作显式声明，匿名操作用 `auth_method: unauthenticated`） | 强档闭集哲学：没有隐式超级权限 |
| —（无对应） | `Challenge` / `DenialError` / `ErrReauthenticationRequired` | step-up 通道：challenge 投影为 REAUTH 类稳定错误 + hint 载荷，不降级为权限类 |

## 快速上手

```go
// 1. 写 operations.yaml（闭集：角色词汇 + 操作声明，无通配）
// 2. 启动期组装
registry := authorization.NewRegistry()          // 内置 assurance/recent-auth
registry.Register(myLifecycleRule{})             // 产品规则（可选）
registry.RegisterFact("project_lifecycle")       // 产品 fact 键（可选）
catalog, err := authorization.ParseCatalog(raw, registry)
evaluator, err := authorization.NewEvaluator(catalog, registry, myTxProvider)

// 3. 请求路径上（ctx 携带调用方事务）
decision, err := evaluator.Authorize(ctx, "op.task.update", principal,
    authorization.ProjectScope{WorkspaceID: "ws", ProjectID: "pj"}, time.Now())
switch decision.Outcome {
case authorization.OutcomeAllow:    // 放行
case authorization.OutcomeChallenge: // step-up：透出 decision.Challenge（目标操作/assurance/max-age）
    return decision.Err()            // errors.Is(err, ErrReauthenticationRequired)
default:                             // deny：阶段 + 原因码可审计
    return decision.Err()            // errors.Is(err, ErrDenied)
}
```

## 护栏（明确不做）

- 目录内禁 `域:*` 通配（与简单档互斥）；
- 无角色继承魔法（显式集合 / 交集非空）；
- 只做两层 scope 输入形状（workspace → project），不做任意深度；
- 不做 ReBAC / 策略引擎；不内置 TTL 缓存；
- 审批编排、Phase0、具名审批不进（组织纪律留产品）。

## golden 基准

`evaluator_golden_test.go` 锁定评估器的确定性语义（阶段顺序/原因码/challenge 投影）
（`docs/ploykit-m0-golden-subset.md`，12 例：G-1..G-7 两值 + CH-1..CH-5 挑战），
全部在"空产品注册表 + 仅内置规则"下通过——空注册表可过 = 通用。
