# Delivery Audit · Strong-Profile Restart(plan-strong-profile-restart.md)

- 文档:`docs/plan-strong-profile-restart.md`(执行中更新为 accepted & executed 2026-10-11;决策记录 ADR 0013)
- 代码范围:工作区全部未提交变更(24 修改 + 14 新增),基线 origin/master@eca4153
- 判定:30/30 条 ✅(含 1 条审计中修复后复测通过);覆盖 100%,无 🟡/❌/⚪ 存留

## 可追溯矩阵

### Batch 0 — 决策记录(§2)

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| B0-1 | ADR 0013:触发记录 + 范围表 + G2/G5 排除 + 批次序列;取代 0005 的 shelve(0005 保留标记 superseded) | ✅ | docs/adr/0013-strong-profile-restart.md(全文);0005 Status 行与 2026-10-11 Addendum |
| B0-2 | ADR 0005 addendum:重启已执行;验收逐条复核;"哈希对账"判退按 ADR 0012 记录 | ✅ | docs/adr/0005 addendum 末节 1-4 条逐项 |
| B0-3 | ROADMAP 条目指向本计划 | ✅ | docs/ROADMAP.md Security 区首行(标记 Executed 2026-10-11) |

### Batch 1 — 参考接线 + in-tx facts(§3)

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| B1-1 | 产品目录 YAML:两条操作,session/workspace_path/[owner]/显式窗口;闭集 fail-closed | ✅ | example/internal/authorization/catalog.yaml;断言:TestEmbeddedCatalogDeclaresTheNamedPair |
| B1-2 | 路由 resolver:method+path→opID,组合根层(arch A6) | ✅ | example/internal/authorization/resolver.go:37-56;测试 TestResolverResolvesCatalogRoutes |
| B1-3 | 事务内 FactsProvider:读调用方 pgx.Tx(经 pg.Within);TOCTOU 模式 | ✅ | facts.go:70-117(tx(ctx)=db.Tx(ctx));TestStrongTOCTOUInTxRevocation |
| B1-4 | 中间件组合:resolver→transport→Authorize→投影(allow/deny 403 PERMISSION_DENIED 携 stage+reason/challenge 403 E_REAUTH_REQUIRED 携 target_operation+required_assurance+max_age_seconds);粘 confirm-password;ADR 0011 次序 | ✅ | middleware.go:88-152,208-224;TestEvaluateTerminalOrderPinsComposition + e2e TestStrongChallengeConfirmRetry |
| B1-5 | 窗口参数化:逐操作显式必填;RecentAuthWindow 常量删除;golden 同批更新 | ✅ | catalog.go:112,348-358(校验);常量已删(grep 零残留);testdata/golden.yaml 全量声明 |
| B1-6 | 两操作移离 Deps.StepUp;StepUp 保留;README 双路 + 双挂载禁令 | ✅ | workspace/adapters/http/routes.go(destructive + StrongGuard);TestStrongGuardReplacesStepUpOnDestructivePair;example/README + authorization/README |
| B1-T1 | e2e:挑战→确认→重试→放行,重试不再撞回同一拒绝 | ✅ | TestStrongChallengeConfirmRetry(断言 handlerOK==1) |
| B1-T2 | fail-closed:未知路由形状拒绝;未知操作 ID 启动期 Bind 拒绝 | ✅ | TestStrongMiddlewareDenials;TestResolverBindRejectsDrift(a/b 双向) |
| B1-T3 | 组合次序:非属主终态拒绝、无 challenge(测试钉) | ✅ | TestEvaluateTerminalOrderPinsComposition + TestStrongNonOwnerTerminalDenial(e2e) |
| B1-T4 | TOCTOU:同事务撤销成员资格翻转决策 | ✅ | TestStrongTOCTOUInTxRevocation(同 tx UPDATE → 403 membership) |
| B1-T5 | golden 扩展:challenge + 窗口参数化用例 | ✅ | TestGoldenCH1-CH6(CH-6=7200s/900s 逐操作窗口) |

### Batch 2 — G1 MFA/AAL2(§4)

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| B2-1 | 迁移:user_mfa(封存密钥/confirmed_at/备份码 consumed_at)+ session.mfa_confirmed_at | ✅ | migrations/046_mfa_totp.{up,down}.sql(初版 045 与远端 v0.4.1 新增的 045_notification_workspace 撞号,rebase 时改 046);纯净库 -p 1 全量零失败 |
| B2-2 | TOTP 服务:RFC 6238 ±1 步漂移;otpauth URI;sealx 封存 | ✅ | identity/app/totp.go(VerifyTOTP drift ±1;OTPAuthURI);secrets 经 app.Secrets(service_mfa.go:166-176) |
| B2-3 | flows:enroll/enable/disable(step-up)/regenerate(step-up);verify-mfa 盖戳共享尝试限流族 | ✅ | identity/adapters/http/mfa.go(MountMFA + guarded);service_mfa.go:294(limit→tooManyAttempts) |
| B2-4 | webx:Principal.MFAConfirmedAt / SessionCreate.MFAConfirmed / RequireRecentMFA 对称;born-confirmed 扩展 | ✅ | principal.go(MFAConfirmedAt/Within);auth.go(SessionCreate.MFAConfirmed);stepup.go(RequireRecentMFA) |
| B2-5 | authorization 零结构变更;AAL2 facts 与 webx 同列 | ✅ | 框架 authorization/ 无 MFA 改动(git diff 仅窗口参数化);facts.go:66-70 读 s.mfa_confirmed_at |
| B2-6 | example 接线:token.create=password_and_mfa + aal2 | ✅ | catalog.yaml token.create;resolver.go POST /api/tokens;main.go idDeps.PATCreateGuard |
| B2-T1 | RFC 6238 向量 + 漂移窗;备份码 consume-once | ✅ | TestTOTPRFC6238Vectors;TestVerifyTOTPAcceptsDriftWindow;TestMFAEnrollEnableVerifyDisableCycle(二次消费拒) |
| B2-T2 | e2e:enroll→enable→AAL2 op→挑战→verify-mfa→重试→放行 | ✅ | TestStrongMFATokenCreateCycle(真实 DB + sealx) |
| B2-T3 | disable/regenerate 无 step-up 拒绝 | ✅ | TestMFADisableChallengedWithoutRecentAuth |
| B2-T4 | 机器主体(PAT)challenge 操作拿普通 403 | ✅ | TestMFAMachinePrincipalPlainForbidden;TestStrongPATDenied;TestStrongMiddlewareDenials |
| B2-T5 | CreateSession/minter 签名涟漪一次性收口 | ✅(无涟漪) | MFAConfirmed 为结构体新增字段,签名不变;编译器驱动零破坏(go build 全绿) |

### Batch 3 — G4 传输排他(§5)

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| B3-1 | 分类器:none/session-cookie/bearer,严格唯一性;session 与 PAT 解析路径共用 | ✅ | transport.go(ClassifyTransport);auth.go Authenticate switch 消费之 |
| B3-2 | RequireTransportKind 中性种类(不 import authorization/);目录→种类映射五行留组合根 | ✅ | transport.go:100-131;example middleware.go transportKindFor(五行) |
| B3-3 | CSRF 条件化:session 路径保持、干净 bearer 豁免;规则与分类器同置 | ✅ | csrf.go(CSRFConfig.classify→共享 classifyTransport;mixed 落回 CSRF 检查);example main.go SessionCookieName 接线 |
| B3-4 | mixed 拒绝 401 独立码 + 日志行 + 测试 | ✅(审计修复) | E_AUTH_TRANSPORT_CONFLICT;Authenticate/RequireTransportKind 均 slog.Warn(本轮补);TestAuthenticateRejectsMixedTransport |
| B3-T1 | 传输 × 要求全矩阵 | ✅ | TestClassifyTransport(10 例)+ TestRequireTransportKindMatrix |
| B3-T2 | GitLab 形回归:bearer-only 操作遇 session cookie 在传输门被拒(handler 逻辑前) | ✅ | TestRequireTransportKindMatrix(wrong-kind→403)+ TestAuthenticateRejectsMixedTransport(reached=false) |
| B3-T3 | mixed 在 session 操作上被拒并记日志 | ✅ | TestStrongMiddlewareDenials(mixed→401 conflict);middleware.go:118 slog.Warn;webx 两侧日志(本轮补) |
| B3-T4 | CSRF:session 强制 / bearer 豁免,双侧钉死 | ✅ | TestCSRFSessionEnforcedBearerExempt;既有 FT21 保留(ctx 内 PAT principal 装配) |

### Batch 4 — 收尾(§6)

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| B4-1 | ADR 0005 验收逐条复核;agent-native 缺口表关闭 | ✅ | 0005 Addendum 四条;agent-native.md 缺口行改"closed 2026-10-11" |
| B4-2 | authorization/README 重写:两档故事 + 接线指南 + 双挂载禁令扩展 MFA + webx/authorization 分工 | ✅ | authorization/README.md(参考消费者/四步接线/两路三轴禁令/机器主体/golden 13 例) |
| B4-3 | golden/测试套件归并;ROADMAP 勾销;check_docs_language 干净 | ✅ | check_docs_language.py OK(25 docs + 52 platform files);ROADMAP 标 Executed |

### 硬边界(§0/§8)

| ID | 约束 | 判定 | 证据 |
|---|---|---|---|
| H-1 | arch A6:authorization/ 零框架 import;webx 不 import authorization/ | ✅ | go list -deps ./authorization 零模块内依赖;internal/arch 测试全过(go test ./... 零失败) |
| H-2 | 两档互不依赖 | ✅ | 同上(arch 测试含横向 import 守卫) |
| H-3 | 组合次序(权限外层/挑战内层) | ✅ | B1-T3/B1-T4 两侧钉死 |
| H-4 | MFA 范围钉死 TOTP+备份码(无 WebAuthn/SMS) | ✅ | grep 零 WebAuthn/SMS;service_mfa.go 包注释声明范围纪律 |
| H-5 | example 增量封顶:双操作 + 一个 AAL2 操作 | ✅ | catalog 恰 3 操作(TestEmbeddedCatalogDeclaresTheNamedPair 断言 3) |

## 覆盖率报告

- 条目取证:30/30(100%);证据强度:强(可执行测试)22 条、中(行为路径)8 条、弱/注释 0 条
- 审计中发现并修复:B3-4 webx 层缺 mixed 日志行(补 Authenticate + RequireTransportKind 两处 slog.Warn,webx 测试复测全绿)
- ⚪ 无法验证:无

## 方法学备注

- 全量回归:框架 + example 双模块 build/vet/test 零失败;纯净库迁移 16/16(共享 dev 库个别 UpDownUp 失败为历史残留数据,与新库对照排除);check_api 142=142 零漂移;check_docs_language 干净
- verify-ui:319/319 断言通过;36 个文件级失败为预存 @ploykit/hooks 工作区解析问题(stash 基线对照一致,与本次变更无关)
