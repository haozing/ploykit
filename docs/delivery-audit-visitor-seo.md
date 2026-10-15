# Delivery Audit · 访客统计/SEO 观察走查（A/B/C/D + canonical）

- 审计对象：工作区未提交批次（21 修改 + 4 新增；基线 origin/master@86e7e4b）
- 需求基线：本会话已批准的 A/B/C/D 四项决定 + AGENTS.md 硬约束（§1，冻结）
- 方法：条目化（12 需求 + 6 硬约束）→ 多源取证 → 三路独立只读复审（Go 框架 / example+文档 / 前端，agent 级，零改动）+ 自查与探针复核 → 四态判定
- 判定汇总：**✅ 14 / 🟡 4 / ❌ 0 / ⚪ 0**（审计轮）；取证覆盖率 18/18 = 100%
- 质量缺陷：21 项（中 5 / 低 16，§3）——**修复轮已全部处置**（19 修复关闭 / 2 文档化·立项维持，§7 逐条复测证据）；闭合后矩阵 ✅ 33 / 🟡 0
- 环境记录：§5（含共享库误触核查结论）

## 1. 可追溯矩阵

### 需求（会话内批准，冻结）

| ID | 需求 | 判定 | 证据 | 缺口 |
|---|---|---|---|---|
| A1 | example 挂 `/sitemap.xml`（PUBLIC_BASE_URL 驱动，绝不错 origin） | ✅ | example/cmd/app/renderx.go:100-104；e2e `:8039/sitemap.xml` 200 绝对 loc×3；TestSitemapGolden | Filter 不适用（blog 无草稿态） |
| A2 | `/robots.txt` 服务（Disallow+Sitemap 指针） | ✅ | platform/renderx/seo.go `RobotsHandler`；TestRobotsHandler×3；e2e tier=robots | — |
| A3 | 发布 hook 推 IndexNow | 🟡 | 能力在位（seo.go `IndexNow`）；rendering.md:439 声明未接线+触发条件 | 预批准二选一之"标注"选项；触发=产品出现发布端点 |
| A4 | prerender SEO 体检（缺 title 硬失败；desc/canonical 告警） | ✅ | example/cmd/render/main.go `auditSEOFiles`；audit_test.go；构建日志"SEO 体检通过" | — |
| B1 | 服务端流量计数（bot×tier×status）进 platform/metrics | ✅ | platform/metrics/traffic.go；traffic_test.go（5 用例）；e2e /metrics 落桶逐条核对 | — |
| B2 | tier 响应头（缓存命中维度） | ✅ | platform/renderx/handler.go `HeaderTier`/`Tier*`；tier 测试×3；e2e embed/render/cache/spa/sitemap/robots | — |
| B3 | 边界声明（UA 启发式非安全设施；前置 CDN 漏计） | 🟡 | UA 侧已声明（traffic.go 注释、platform-api-index.md:339、visitor-analytics.md:25） | 前置 CDN/缓存漏计边界缺（Q5） |
| C1 | 第三方分析接入 recipe（Umami/Plausible + CSP 注意） | 🟡 | docs/visitor-analytics.md recipe 两路线在位 | 含 3 处事实错误 + CSP 方向写反（Q5） |
| C2 | ROADMAP 触发项（条件+预决方案） | ✅ | docs/ROADMAP.md:29 | — |
| D1 | 渲染边界文档（说给引擎听 vs 听引擎反馈；Search Console 属产品侧） | ✅ | docs/rendering.md:443 | — |
| S1 | canonical 单例修复（实现中发现的缺口） | ✅ | packages/runtime/src/browser.ts；两包测试（独立复现：旧实现下必失败）；useSEO.canonical；e2e SSR `<link href="/blog/hello-renderx" rel="canonical">` | 残留语义待定（Q15/16/17） |
| V1 | 守门与验证 | ✅ | check_api 150/150；check_docs_language OK；root 71 包 + example 6 包 + 前端四包 737 测试全绿；e2e 三态（§5） | — |

### 硬约束（AGENTS.md）

| ID | 约束 | 判定 | 证据 |
|---|---|---|---|
| H1 | 依赖单向 / arch 边界 | ✅ | internal/arch 全绿；零新第三方依赖（仅 stdlib） |
| H2 | wiring discipline（新能力带 example 接线） | ✅ | 四项能力均带接线；无零接线新品合入 |
| H3 | 边界条款（未消费路径边界声明） | 🟡 | IndexNow 已声明、Traffic UA 已声明 | sitemap 降级行为未声明（Q2）；CDN 漏计（Q5） |
| H4 | 英文面 | ✅ | check_docs_language OK（26 docs + 64 platform files）；新增英文面人工抽查 |
| H5 | 契约同步 | ✅ | check_api 150/150；routes_contract_test.go 镜像同步（含新 method-less 挂载） |
| H6 | 反重复条款 | ✅ | 独立复审全仓检索：example 无手写 robots/sitemap/UA 分类等价物 |

## 2. 覆盖率报告

- 条目 18/18 取证（100%）；证据强度：强 12 / 中 6；🟡 4 条各附具体缺口。
- ❌ 缺失 0；⚪ 无法验证 0（所有判定均有 file:line 或可复跑命令）。
- Top 缺口顺序（🟡）：A3（有意推迟，触发条件已声明）> B3/H3（同一缺口：CDN 边界一句）> C1（recipe 修正批）。

## 3. 质量缺陷清单（修复轮输入）

### 中（5）

1. **Q1 · robots SitemapURL 是唯一未校验选项——换行可注入任意行**：`platform/renderx/seo.go` `renderRobots` 对 Disallow/Extra 有换行校验并 panic，SitemapURL 仅 TrimSpace 直写；注释承诺 "malformed options panic … never serving a silently wrong file" 在此破口。探针实测注入 `\nUser-agent: EvilBot\nDisallow: /` 成功。来源可为 example 的 `PUBLIC_BASE_URL` 环境值。次：Disallow 对 `#`/空白静默截断。→ 修：SitemapURL 换行+绝对 URL 校验 + panic 用例。
2. **Q2 · 降级模式（无 ssr-bundle）sitemap 静默缺席、robots 指针悬空**：`example/cmd/app/renderx.go` robots 先挂（:56-65），bundle 缺失提前返回（:71-73），sitemap 挂载块（:100-104）永不执行——但 robots 仍带 `Sitemap:` 行，该 URL 落到 frontendHandler 的 404 分支。文档（rendering.md:441 / README）把 baseURL 说成唯一条件，未言明还依赖 renderx 启用。→ 修：SitemapURL 注入推迟到确认渲染可用之后 + 降级分支补 Warn + 文档一句。
3. **Q3 · GetOrLoadHit 内层复查命中报 hit=false（与注释语义矛盾）**：outer Get 未中、singleflight 闭包内层 `c.Get` 命中（并发 Put 落进窗口，invalidate/Refresh 或并发请求完成即可触发）时统一返回 false，调用方 handler 据此误标 `TierRender`（应 cache）。探针复现（竞态循环第 143 轮）。→ 修：闭包携带 hit 返回 + 独立单测（含单飞等待者语义）。
4. **Q5 · docs/visitor-analytics.md 修正批**：(a) Umami 是 **MIT** 许可（非 AGPL；Plausible CE 才是 AGPL-3.0）；(b) 端点自相矛盾——Route 1 写 Umami `/api/collect`、Route 2 写 `/api/send`（v2 真值），Plausible 实为 `/js/script.js` + `/api/event`；(c) CSP 指引方向写反——同源反代**无需**扩 CSP（`default-src 'self'` 已覆盖），跨源部署才需要；(d) 缺"前置 CDN/缓存漏计"边界声明（B3/H3 的缺口句）。
5. **Q7 · CHANGELOG 声明与本批矛盾**：`CHANGELOG.md:42` "[0.7.1] — (unreleased; Go only — npm packages unchanged)"，而本批改了 `@ploykit/runtime` + `@ploykit/hooks` 源码（canonical 单例 + useSEO.canonical）。发布前必须处置（并入 0.7.1 或另立 JS 条目）。

### 低（16）

6. **Q4 · rendering.md:439 "All three carry X-Renderx-Tier"**：三个对象含 `IndexNow`（出站推送、无响应头），应改为 "Both handlers carry…"。
7. **Q6 · platform-api-index.md:208 "Same Options shape as SitemapHandler"**：`SitemapOptions{Filter, Registry}` 与 `RobotsOptions{SitemapURL, Disallow, Extra}` 字段零重叠，措辞应改为"成对使用"。
8. **Q8 · PUBLIC_BASE_URL 未校验绝对源**：漏 scheme（`example.com`）静默产出非绝对 `<loc>` 与 robots 行。→ `url.Parse` 校验 scheme+host，不合格按未设处理。
9. **Q9 · Traffic 计数非 defer**：`traffic.go:84-89` 在 next 返回后自增，panic 请求完全不计数（Renderx 面 panic 会被上层 Recover 成 500，统计永远看不到）；Mount.Middleware 用的是 defer，口径不一致。
10. **Q10 · trafficWriter 不透传 Flusher**：当前挂载面无影响（整页缓冲、SSE 走别路由），但 Traffic 文档邀请包在公共渲染面，建议补 Flush 透传或在文档声明。
11. **Q11 · ClassifyUA 漏判批**：`Yeti`（Naver）、`ImagesiftBot`、`Omgili`、`Barkrowler` 落 human；`uptime-kuma`、`Checkly`、`reqwest`、`PostmanRuntime`、`insomnia`、`HTTPie`、`GuzzleHttp`、`libwww-perl` 落 human（与 BotTool 注释"uptime monitors"自相矛盾）。常见正例（Chrome/Edge/Safari/Firefox/curl/Googlebot 族/bingbot/GPTBot/ClaudeBot/facebookexternalhit/空 UA/CUBOT）逐条核对无误。→ 按需补 token 或写进注释作已知边界。
12. **Q12 · SitemapHandler 405 缺 Allow 头**（RobotsHandler 同分支已带，RFC 9110 要求）。
13. **Q13 · SitemapHandler 空/相对 baseURL 不校验**：`("", …)` 产出相对 `<loc>`；与同包"构造期校验"风格不一致。
14. **Q14 · spaTier 启发式**：末段含点即资产，`/blog/v1.2` 类页面壳记入 asset 桶（仅观测分桶影响；与 frontendHandler 的 404 判定同口径，建议注释点明）。
15. **Q15 · canonical 残留语义未定**：导航到未声明 canonical 的页面后旧值留存（useSEO 假值不发指令；与 title/meta 同模式）。→ 二选一：文档声明"同文档内 sticky"，或支持 `canonical: null` 移除语义。
16. **Q16 · SSR 端无 canonical 查重**：两处 emit（布局+页面）会使服务端 head 双份 canonical，客户端只修第一份；文档未写"一页一个 canonical"的产品侧硬规则。低成本闭环：cmd/render 体检加重复告警。
17. **Q17 · rel 匹配口径不对称**：浏览器端整串小写精确匹配（不 trim），Go 端 `AuditSEO` 为 `TrimSpace`+`EqualFold`；`rel:' canonical '` 会两边判定不一。→ 浏览器端入口加 trim（一行）。
18. **Q18 · rendering.md 漂移批**：§6 已改为 `@ploykit/hooks`，但 §4.2 示例片段（:107）与架构图（:64）仍写 `@ploykit/ui`（ui 包现无 useSEO 导出，照抄无法编译；系 hooks 拆包遗留，本批使同文件自相矛盾）；:349 浏览器分支注释未提 canonical 单例；G7 行未注例外面；G8 行未提 robots/体检。
19. **Q19 · README 文档表缺 `docs/visitor-analytics.md` 行**（新文档可发现性）。
20. **Q20 · 测试缺口批**：GetOrLoadHit 独立单测（等待者/内层命中/错误路径）；水合"采纳既有 SSR canonical 元素"用例（本修复的核心价值路径）；304 / poison 命中 / 405 的 tier 断言；TrafficConfig.Classify 返回非法值折叠 "other" 用例；SitemapURL 校验用例（Q1 修后）。
21. **Q21 · 行尾形态（存量混合，非本批引入）**：`gofmt -l` 名单（renderx 21 文件、metrics 9 文件、example 多处，含 build.go/dev.go 等本批未触碰文件）经 `diff --strip-trailing-cr` 逐一判定 = **纯行尾差异，无格式内容差异**；根因是长期 Windows 工作树的 CRLF/LF 混合（core.autocrlf=true、无 .gitattributes）。本批新文件（traffic.go/audit_test.go）均为 LF 干净；本批编辑文件沿袭各自原有形态。→ 建议单独立项收敛行尾策略，不在本批处理。

## 4. 已核对且干净（摘要）

- tier 头覆盖：renderx 全部响应路径（embed/cache/render/stale/SPA 壳/资产/错误/404/304/405、非 GET/HEAD、SPA==nil 分支）逐一验证设置；9 个常量与文档一一对应。
- GetOrLoad 包装保持原语义（与 HEAD 逐行比对）；ClassifyUA 常见正例全对；sanitizeLabel 对恶意值（大写/超长/路径/NUL）收敛到有限标签。
- canonical 修复正确且必要（旧实现下"水合必双份"隐患已消除）；测试真正锁住修复（独立复现旧实现必挂）；无消费方依赖旧"异 href 追加"行为。
- 契约/语言/架构门禁全绿；example 无手写等价物；IndexNow 未接线有文档声明（预批准路径）。

## 5. 环境与意外记录

- **5437 共享库误触核查（结论：无残留）**：首轮 example 启动误用 5437（shuijing 产品共享库），迁移在 `1007_rls_demo.up.sql` 失败退出（`relation "task" does not exist`）。核查：`schema_migrations` 最新记录 1006@2026-10-15T13:11:24Z（早于本次启动 13:15:38Z 约 4 分钟，非本会话产物）；1007 无记录；1007 文件无 `-- migrate:no-transaction` 标记 → pgmigrate 以 `BEGIN;…COMMIT;` 执行、失败 ROLLBACK → **本次误触未新增迁移行、无部分 DDL 残留**。该库处于既有 1xxx 共享污染态（1001–1006 号段被占、example 的 `task` 缺失），与项目记忆中的已知问题一致。教训：example 联调必须用独立库/容器（后续已改用一次性容器）。
- **8030 端口**：由同机运行的 shuijing 产品实例占用（curl 误读其 robots/sitemap 一次，未做任何写入）；本批 e2e 改用 8039/8040。
- **e2e 环境**：一次性 PostgreSQL 容器（`ploykit-e2e-pg:5438`）+ 本批构建的 app.exe；三态验证（有/无 PUBLIC_BASE_URL、无 ssr-bundle 降级）后容器与进程均已删除，工作区除本报告外无新增文件。

## 6. 方法学备注

- 需求清单由会话内已批准的 A/B/C/D 范围直接冻结（未另行走 Phase-0 用户确认；清单即本报告 §1，可核可改）。
- 三路独立复审 agent 全程只读（`git status` 与开工一致）；关键结论（Q1/Q2/Q3、canonical 回归面、gofmt 归属）均经自查探针/字节级命令二次确认。
- 本轮未修复任何条目；修复轮按纪律逐条处置并在本矩阵上标记（✅/🟡/⏸ + 复测证据）。

## 7. 修复轮记录（2026-10-15 晚，用户指令"修吧"后执行）

21 项全部处置，其中 19 项修复关闭、1 项降级为"文档化边界"、1 项（Q21）保持立项结论。复测证据逐条如下（复验全量：root 71 包 + example 6 包测试全绿、前端 620 测试全绿、check_api 150/150、check_docs_language OK、ESM smoke 通过、arch 测试通过）。

| ID | 处置 | 复测证据 |
|---|---|---|
| Q1 | ✅ 修 | `renderRobots`：SitemapURL 换行 panic + `validateAbsoluteOrigin`（scheme/host/query 校验）；Disallow 增 `#` 拒绝。`TestRobotsHandlerRejectsMalformedOptions` 扩 7 例（含注入探针原样）。 |
| Q2 | ✅ 修 | `renderxHandler` 重构：robots 挂载抽为 `mountRobots(sitemapURL)`；降级分支 `mountRobots("")` + 专属 Warn。e2e 态3 实测：无 Sitemap 指针、sitemap 404、警告可见。 |
| Q3 | ✅ 修 | 闭包改回 `cacheLoadResult{ent,hit}`，内层复查命中报 hit=true；`loadOrReplay` 抽为可测函数。新增 4 个单测（cold/warm、replay 命中、waiter 共享、错误路径）。 |
| Q4 | ✅ 修 | rendering.md:439 改为 "Both handlers carry…"、IndexNow 显式声明在计数之外。 |
| Q5 | ✅ 修 | visitor-analytics.md：Umami=MIT / Plausible CE=AGPL-3.0；端点按工具分列（Umami v1 `/api/collect` vs v2 `/api/send`，Plausible `/js/script.js`+`/api/event`）；CSP 指引反转为"同源反代无需扩 CSP，跨源才需要"；新增"计数看不到前置 CDN 吸收的重复流量"边界段。 |
| Q6 | ✅ 修 | platform-api-index.md:208 改为"`SitemapURL` normally points at your SitemapHandler route — use them as a pair"。 |
| Q7 | ✅ 修（发版轮定稿） | CHANGELOG：v0.7.1 条目补记 released（Go-only tag 已发布、npm 按跳过语义停在 0.7.0，正文保留预录内容）；走查 + #16 内容独立成 [0.7.2] 段随 v0.7.2 发版。 |
| Q8 | ✅ 修 | example `validatedBaseURL`（url.Parse scheme+host 校验，非法按未设处理+专属 Warn）；`TestValidatedBaseURL` 10 例。e2e 态4 实测：`blog.example.com` → 警告 + 无 sitemap 行。 |
| Q9 | ✅ 修 | Traffic 计数改 defer；未写响应的 panic 归类 5xx 后原样上抛。`TestTrafficCountsPanicAs5xx`（断言 Panics + 计数已落）。 |
| Q10 | ✅ 修 | trafficWriter 增 Flush 透传（委托下游 Flusher）。`TestTrafficWriterFlushesThrough`。 |
| Q11 | ✅ 修 | 补 token：imagesiftbot/meta-externalagent 家族补齐、yeti/omgili/barkrowler→search、uptime-kuma/checkly/reqwest/postmanruntime/insomnia/httpie/guzzlehttp/libwww-perl/dart/dalvik→tool。`TestClassifyUA` 扩 15 例（复审漏判清单原样）。 |
| Q12 | ✅ 修 | SitemapHandler 405 补 `Allow: GET, HEAD`；测试断言。 |
| Q13 | ✅ 修 | SitemapHandler 构造期 `validateAbsoluteOrigin` panic；`TestSitemapHandlerRejectsBadBaseURL` 4 反例 + 尾斜杠正例。 |
| Q14 | ⏸ 文档化边界 | spaTier 注释点明启发式边界（兜底契约与 frontendHandler 404 规则同源）；不改行为（观测分桶，收紧需产品真实路由形状）。 |
| Q15 | ✅ 修（文档化语义） | 采用"sticky 语义 + 文档声明"路径（非 null 移除）：browser.ts `upsertCanonical` 注释 + useSEO 字段注释 + rendering.md §6 产品侧规则；不加移除分支（与 title/meta 既有模式一致）。 |
| Q16 | ✅ 修 | `SEOSignals.CanonicalCount` + cmd/render 体检新增重复 canonical 告警（日志 + 计数）；`TestAuditSEOFiles` 增 dup 用例；prerender 实测 `duplicate_canonical=0`。 |
| Q17 | ✅ 修 | browser.ts 两处 rel 匹配加 trim（与 Go 端 `AuditSEO` 的 TrimSpace+EqualFold 口径一致）；新增 trim 用例。 |
| Q18 | ✅ 修 | rendering.md §4.2 示例改 `@ploykit/hooks` + canonical 行；架构图 `@ploykit/ui`→`@ploykit/hooks`；:349 注 canonical 单例；G7 注明例外面；G8 扩为 robots/体检/条件挂载全量。 |
| Q19 | ✅ 修 | README 文档表加 visitor-analytics.md 行 + rendering.md 行尾补 SEO。 |
| Q20 | ✅ 修 | 新增：GetOrLoadHit×4、水合采纳 SSR 元素、trim 口径、304/非 GET tier、poison 命中 tier、panic 5xx、Flush、非法 Classify 折叠、validatedBaseURL、重复 canonical 体检、SitemapURL 校验。 |
| Q21 | ⏸ 维持立项结论 | 修复轮再次确认：gofmt -l 名单全部为纯行尾差异（`diff --strip-trailing-cr` 逐文件判定，含本批新增 seo_test/cache_test 的存量 CRLF）；无混合行尾引入（`tr -cd '\r'` 逐文件核验：全 CRLF 或全 LF）。行尾策略收敛仍建议单独立项。 |

最终矩阵：**✅ 33 / 🟡 0 / ❌ 0**（18 需求含 4 条原🟡全部闭合 + 21 质量项中 19 修复关闭、2 条文档化/立项维持），0 阻断项。工作区最终：30 文件（24 改 + 6 新，含审计报告）。
