# Agent 视频工作室接入 ploykit：兼容性影响评估

- **版本**：v1.2（2026-11-14，两轮审计修订；修订记录见 §7）
- **性质**：工作记录（process doc，中文），对应架构方案见同批讨论；正式决策将另落 `docs/adr/0017-agent-video-studio.md`（英文）
- **回答的问题**：本特性会不会影响既有能力？会不会改变既有接口？老项目（框架消费方 / example 部署）升级有没有影响？

> **状态注记（2026-11-17）**：本文写于 video 域实施之前；video 域现已落地（round9：L0-L3 全量达成、check_api 175:175、26 个 video_* MCP 工具），"零回归、纯增量"总结论经受住了实施检验。但**环境变量唯一口径以 [architecture 文档 §14](./plan-agent-video-studio-architecture-2026-11-14.md) 为准**，与本文表述分叉处一律按 §14 执行。
>
> **(a) 本文与 §14 的环境变量分叉点（逐条）**
> 1. §1.2 / §5 的 `FFMPEG_PATH` → §14 口径为 `CAPX_FFMPEG_PATH`（默认 `ffmpeg`）；
> 2. §1.2 的 `TTS_URL` → 实现契约为 `VIDEO_TTS_URL`（+ 可选 `VIDEO_TTS_KEY` / `VIDEO_TTS_VOICE`）；**§14 已于 2026-11-17 收敛为此口径**（原设计期三段式 `VIDEO_TTS_PROVIDER/ENDPOINT/API_KEY/MODEL` 从未实现，已从 §14 删除）；
> 3. §1.2 的 `ALIGNER_URL` → 实现契约为 `VIDEO_ALIGNER_URL`；**§14 已于 2026-11-17 收敛**（原 `VIDEO_ALIGNER_PROVIDER/ENDPOINT/API_KEY` 已删除）；
> 4. 本文只点名 4 个变量，§14 全表其余各项（`CAPX_ENABLED`、`CAPX_POOL_SIZE`、`CAPX_MAX_RENDER_SECONDS`、`VIDEO_WORKER_ENABLED`、`VIDEO_RENDER_QUEUE`/`MAX_WORKERS`/`JOB_TIMEOUT`/`SHUTDOWN_TIMEOUT`/`MAX_ATTEMPTS`、`VIDEO_MAX_IR_BYTES`、`VIDEO_MAX_UPLOAD_BYTES`、`VIDEO_MAX_ACTIVE_RENDERS_PER_WORKSPACE`、`PLOYKIT_MCP_RATE_LIMIT_PER_USER`）本文未覆盖——配置问题一律查 §14 全表。
> 5. **[2026-11-17 更新] 分叉已闭合，但注意能力边界**：`adapters/tts/tts.go` 与 `adapters/aligner/aligner.go` 的变量名现在与 §14 一致。然而按 ADR 0017 的边界声明，**这两个适配器实现存在但 example 的 `main.go` 从不构造它们**（`Ports.Synth`/`Ports.Aligner` 恒 nil），因此这些变量在 example 部署里配置后**不生效**——`SetScript` 恒降级到 `words_source=estimated`。产品要在自己的组合根接线才会启用。
>
> **(b) v2 将新增/变更的环境变量**（提取自 plan-video-studio-ir-v2 §3.1/§3.3；**变量名与数值以 v2 spec `plan-video-studio-ir-v2-spec-2026-11-17.md` §2.12 资源预算与 §2.6 字体资产为准——spec 已落盘草稿，预算数值留待其 §5 开放问题裁决**）：解码资产总字节预算 + 像素预算（ir-v2 §3.1 第 8 条：元素计数闸门改为资源预算，`VIDEO_MAX_IR_BYTES` 256KiB 保留）；字体资产（ir-v2 §3.3 第 1 条：上传 woff2 → 内容寻址 → player 内联 @font-face + 子集检查，需配套资产预算/子集校验配置）。将随 v2 落地同批更新本文与 §14。
>
> **其他过时陈述（逐条列出；均为"写时正确、实施后漂移"，正文不再逐处修订）**
> 1. §1.1 / §7 "platform 现有 23 个包" → 现 24 个（capx 已落地）；
> 2. §2 / §5 "既有 161 个端点（139 个 path 条目）"与 §7 `expectedRouteCount = 161` → 现 175（`routes_contract_test.go:50`；check_api 175:175）；
> 3. §1.3 `ScopePrefix` 加 `'video'`（"需加入、随下个 minor 发布"）→ 已落地（`packages/client/src/ws.ts:24`）；
> 4. §4.1 "约 10 个 video_* 工具" → 实际 26 个（`example/internal/video/adapters/mcp/tools.go`）；
> 5. §4.6 "素材 ≤1MiB（/api/ 1MiB body limit）" → 资产上传已按本文预留的 BodyLimitExcept 方案落地为 50MiB 豁免（`main.go:1609` `BodyLimitExcept(50<<20, "/api/video/assets")`）；
> 6. 头注 "正式决策将另落 docs/adr/0017" → 已落地（`docs/adr/0017-agent-video-studio.md`）。

---

## 0. TL;DR

| 问题 | 答案 | 一句话依据 |
|---|---|---|
| 影响既有能力吗？ | **不影响** | video 是纯新增产品域（`example/internal/video`，task 域同款解剖）；`platform/*` 既有包零代码改动；框架迁移 001–999 一个不动 |
| 改变既有接口吗？ | **不改** | REST 全部走新命名空间 `/api/video/*`；openapi 只增不改；WS 只加新 scope/新帧类型；MCP 只加新工具；authz/quota/audit 全部走"声明即扩展"的既有机制 |
| 老项目升级有影响吗？ | **框架消费方：零影响**（不引入 capx 就连编译产物都不含它）；**example 部署：纯增量**（新表 + 可选 env + owner 多一个菜单项，均可回滚） | 依赖方向 product→framework 单向；env 门控默认关 |

需要如实告知的**次要可见触碰点**共 10 项（含 3 项契约/安全义务），全部是"加法可见"或"同批维护义务"而非"行为变化"；另有 1 项计费口径开放决策。见 §4。

---

## 1. 影响面清单（逐项盘点）

### 1.1 框架侧（所有产品共享的部分）

| 触碰点 | 性质 | 既有行为变化 | 证据/依据 |
|---|---|---|---|
| `platform/capx/`（无头浏览器帧捕获 + ffmpeg 管道） | **全新包** | 无。platform 现有 23 个包零文件改动；arch 测试（platform 零业务依赖）对新增包同样生效 | 平台包定位同 renderx/storagex；env 门控默认关（metrics/mcpx 契约，mcpx.go:7-9 同款） |
| `go.mod` 增加 `chromedp` | **新增依赖** | 无行为变化。chromedp 是纯 Go CDP 客户端（无 cgo）；不 import capx 的产品**不会把它链接进二进制**（Go 只编译被 import 的包），仅 go.mod/go.sum 模块图变化 | 依赖入框架模块需 ADR 记录——ADR 0014 为 mcpx 接受 MCP Go SDK 是直接先例（0014:34-40） |
| `packages/ui` 新增 `slider.tsx` + index.ts 一行导出 | **新增组件** | 无。不触碰任何现有组件文件；semver minor（2.x 加法导出，`^2` 消费方自动兼容） | 当前 ui 无 Slider（全目录 grep 零命中，已核实）；studio scrub 条需要 |
| 框架迁移 `migrations/001–999` | **零触碰** | 无 | video 表走 example 产品迁移 1xxx（`example/cmd/app/main.go:118-119` 自有 embed）；"共享库 1xxx 污染坑"（shuijing 教训）因此不触发 |
| mcpx / wsx / storagex / quota / events / renderx | **零代码改动** | 无 | 自定义 WS scope 用既有 `wswire.RegisterScope`（wswire.go:65，本就是为产品扩展设计的）；Range 下载在域内自建 handler（storagex.ServeUploads 的 http.go:28 注释预判了这一分工）；渲染队列用既有 river（schedule/fireworker.go:24 自有 client 先例） |

### 1.2 example 产品侧（只有 example 部署能看到）

| 触碰点 | 性质 | 既有行为变化 |
|---|---|---|
| `example/internal/video/` 新域 + `main.go` 装配段（域 Mount、MCP 注册回调、river client、quota/audit 注入） | 新增代码 + 组合根加法式追加 | 无。中间件链表达式一行不改（§4.6 的 body-limit 是新端点自己的设计约束，不是链改动） |
| `example/cmd/app/migrations/1xxx_video_*.sql`（video_project / video_render + plan.limits 追加 video 键） | 产品迁移，boot 时 pgmigrate.Up 自动跑 | 新表对既有查询零影响（无跨域 FK 指向它们，workspace_id FK 指向既有 workspace 属正常引用） |
| `example/web`：routes-table / shell.tsx（侧栏项 `permKey:'video:read'`）/ providers / VideoStudioPage | 新页面 + 新导航项 | owner 恒为全量 catalog（workspace/app/roleconfig.go:75-78），所以 example owner 升级后会看到新菜单项；member 角色未授权则不可见（permKeyVisible 语义） |
| `example/cmd/app/routes_contract_test.go` | **契约义务式修改（非回归）** | 该测试把生产路由面钉成 `expectedRouteCount = 161` 并镜像 main.go 的 Mount 列表（注释明说"新增/删除路由须同批更新该常量"）；新增 video 端点必须同批更新两者，漏做直接红 |
| 新 env：`CAPX_CHROME_PATH` / `FFMPEG_PATH` / `TTS_URL` / `ALIGNER_URL` | 可选，全部默认关 | 未配置时：预览/编辑/IR 全功能可用，仅 `video_render` 返回结构化 `E_NOT_CONFIGURED`（ADR 0014"降级可诊断、绝不静默空"）；`PLOYKIT_MCP_ENABLED` 语义不变，开着就多出 video_* 工具，关着则整块不存在 |

### 1.3 前端 packages（client / hooks / runtime）

**一处类型加法。** WS 客户端复用现有 `WsClient`/`useWsFrame`/`useWsScope`，帧协议格式不变；但 `ScopePrefix` 联合类型（`packages/client/src/ws.ts:24`，当前为 `'workspace'|'user'|'task'|'chat'`）需加入 `'video'`——纯类型层加法、向后兼容，随 client 下个 minor 发布；hooks / runtime 零触碰。`video.ir.updated` / `video.render.updated` 只是新的帧 type 字符串。

---

## 2. 共享契约面逐一核对（"不改接口"的证明）

| 契约面 | 既有部分的 delta | 机制说明 |
|---|---|---|
| **REST / openapi.yaml** | **零修改，纯新增 path**（/api/video/* 若干条） | `tools/check_api.py` 对比两侧 (method,path) 集合，只罚"单侧存在"（check_api.py:118）；双侧同步新增即绿。既有 161 个端点（139 个 path 条目）的定义、schema、鉴权标记一字不动 |
| **WebSocket 协议** | 帧格式 `Frame{Type,Payload,EventID}` 不变；新增 scope `video`、帧类型 `video.*` | scope 注册表本就开放（`wswire.RegisterScope`，[a-z0-9_]≤32）；既有 workspace/user scope 与既有帧（task.created 等）零影响；只有显式 subscribe video scope 的连接会收到新帧 |
| **MCP 工具面 /mcp** | 既有 devx 六工具 + provision_dev_tenant 原样；追加 `video_*` 前缀工具 | 同一 server 追加（main.go:837-842 注册回调处加一行）；工具名无命名空间机制，故 video_ 前缀防碰撞；scope 检查在工具 handler 内（devx tools.go:157 requireToolScope 模式），不影响既有工具的 scope 语义 |
| **authz 权限目录** | 既有键零变化；新增 `video:read/write/render` 三键 | Catalog.Register 是既有扩展点（authz.go:13-41，example main.go:498-503 先例）；已存的 role_perms 行不含新键则相关角色不可见该功能——**默认关**，授权是显式动作 |
| **quota / plan.limits** | 既有键（workspaces/tasks_monthly/...）零变化；追加 `video_renders_monthly` | 配额键是数据声明（plan.limits JSONB，quota.go:93-95 读法）；注意 quota **fail-closed**：plan 没给键的 workspace 调 render 会被拒（consume.go:119-144）——这是刻意的功能门控，不是回归；example 迁移同批给 free/pro 落键，部署顺序硬约束进 ADR |
| **audit 事件流** | 既有 action 零变化；新增 `video.render.created/completed` 等 action 名 | audit_event 是 append-only 泛型表（audit.go:54-80）；按 action 过滤的既有消费方不受影响，全量消费方会看到新 action 字符串（加法） |
| **WS capabilities 握手** | connected 帧的 capabilities 列表多一项 `"video"` | `hub.Capabilities = wsx.Capabilities()`（main.go:966）读取全局注册表；装配顺序注意：RegisterScope 必须发生在该行之前（§4.7） |

---

## 3. 两类"老项目"的升级路径

### 3.1 框架消费方（aiblog / risk-engine / orkome / shuijing / aifengkong 等真实产品）

`go get ploykit@<新版本>` 之后发生的事，逐步：

1. **代码**：什么都不变。capx 不 import 就不存在（Go 按需编译）；Slider 不用就还在 ui 包里躺着。
2. **数据库**：零新框架迁移（001–999 未动，下一号仍是 054）。`pgmigrate.Up` no-op。
3. **接口**：所有既有端点行为、openapi、WS、MCP、配额、权限、审计——逐字不变（§2）。
4. **env**：无新增必需 env。
5. **回归**：他们的 `make verify` / 测试套件不受影响；CI 无新增必装系统依赖（chromedp/ffmpeg 只在 capx 被使用时才需要，且 capx 自己做 env 探测 + 结构化报错）。

结论：**不主动接 video 能力的产品，升级等于无事发生**。想接的产品按 example 的接线抄（域 Mount + MCP 注册 + river client + quota 键 + 角色授予），全是产品侧自己的代码。

### 3.2 example 部署（含用 example 做起点的产品）

1. 拉新版 → boot 自动跑 1xxx 产品迁移（建 video_project/video_render、给 plan 落 video 配额键）。
2. owner 登录看到侧栏新增"视频工作室"（member/admin 角色按授予情况）；不授予即隐藏。
3. 不配 Chrome/ffmpeg env：编辑/预览可用，点渲染得到明确的 `E_NOT_CONFIGURED`（正文点名缺什么）。
4. **回滚**：跑 1xxx down 迁移（删两表 + 移除 plan 键；配额计数行随 CASCADE/清理），侧栏项随角色收回；框架侧回滚 = 删 capx 包 + Slider 导出行。无任何不可逆状态（渲染产物只是 storagex 里的文件）。

---

## 4. 次要可见触碰点（如实清单，均为加法）

1. **/mcp 工具清单变长**（仅 `PLOYKIT_MCP_ENABLED=1` 时）：agent 的 tools/list 多出约 10 个 video_* 工具，可能增加 agent 工具选择噪声。既有工具语义不变。
2. **WS capabilities 广播多一个 scope 名**：前端若有 capabilities 白名单逻辑需知晓（example 现无此逻辑）。
3. **审计流出现新 action 名**：全量拉取审计的面板会渲染 `video.*` 条目（example 审计页是泛型渲染，天然兼容）。
4. **example owner 升级后多一个菜单项**：这是产品迭代预期行为，但确实是"升级后界面有变化"，提前知会。
5. **ui 包 minor 发版的 two-phase 纪律**：Slider 随下个 ui minor（2.x→2.x+1）发布；同周期内 example 若从 registry tarball 构建则拿不到新导出（v0.8.0 坑册：框架发版先行、example 采纳下一周期，或本地 workspace 直连开发）。Go 侧 capx 同理随下个 Go minor。同批还有 `packages/client` 的 `ScopePrefix` 加 `'video'`（类型加法，client minor）。
6. **新端点继承 /api/ 的 1MiB body limit**（main.go:1337 pathGate）：v1 约束素材 ≤1MiB（MCP base64 通道实际 ~700KB）；若后续要传大音频，须用 `BodyLimitExcept` 变体为**该新前缀**放宽——注意 AGENTS.md 五坑 #2：不得再叠一层 pathGate 的 BodyLimit（会嵌套 MaxBytesReaders 使放宽无效）。这是新路由自己的设计决策，**不修改既有中间件链对老路由的行为**。
7. **装配顺序注记**：`wswire.RegisterScope("video")` 必须在 main.go:966 `hub.Capabilities = wsx.Capabilities()` 之前执行（video 域 Mount 自然在前，写装配时留意即可；接错的表现是 capabilities 少报，不影响鉴权与既有 scope）。
8. **契约测试同批维护**：新增 video 端点必须同批更新 `example/cmd/app/routes_contract_test.go`（`expectedRouteCount` 常量 + `mountProductionRoutes` 镜像列表）——这是既有测试的义务式修改，不是回归；漏做会红（routes_contract_test.go:44-52 注释原文即"when a route is added or removed, update this constant in the same change"）。
9. **视频文件下发必须自建授权（不得复制匿名先例）**：example 现有 `GET /uploads/` 是**匿名路由**（main.go:1138 直接挂 `storagex.ServeUploads`），storagex 包注释明说"鉴权与上传策略是产品责任"（platform/storagex/http.go:1-7）。video 成片/素材若复制该先例，跨租户可按 key 猜下载。新文件路由须在 handler 内做 workspace 归属校验 + Range 支持（Local 后端用 `http.ServeContent`）。
10. **WS `video` scope 订阅需接授权回调**：自定义 scope 的 `subscribe` 走 hub.Authorize 回调，且 **Authorize 为 nil 时 fail-closed 直接拒绝**（hub.go:437 `if h.Authorize == nil || !h.Authorize(...)` → rejected）——即不接回调的后果是 **video scope 订阅全部被拒、预览推送不可用**（功能性破坏），而**不是**安全裸奔；真正的泄露面只存在于"接了回调但校验写错"。装配时仍必须接 `hub.Authorize` 并在其中校验 `video:<projectID>` 的项目归属当前工作区。接回调是新增装配行，不改 hub 代码、不影响既有 workspace/user scope 行为。
11. **计费口径开放决策**：`video_renders_monthly` 只做配额门控；若产品要对渲染超量出账，须追加 billing 所有的 `metered_video_renders` 键（plan.limits 中 `price_`/`metered_` 前缀归 billing、quota 过滤掉，quota.go:33-38）。按当前"小规模高质量出片"定位建议先 quota-only，出账待触发（挂 ROADMAP）。

---

## 5. 验证清单（升级无回归的可执行证明）

```bash
# 1. 框架面全绿（make verify = check_api + build/vet/test，含 arch 测试；docs 语言守卫不在其中，见第 5 条）
make verify

# 2. 前端包
make verify-ui

# 3. DB 集成层（video 域 + 既有域全部）
make -C example db-up && make test-db

# 4. openapi 增量两侧同步（只应报新增，不应有任何单侧漂移）
python tools/check_api.py

# 5. 语言守卫（本文件是 plan- 前缀工作记录，中文豁免；ADR 0017 必须英文；CI verify.yml:81-82 会跑）
python tools/check_docs_language.py

# 6. 降级路径：不设 CAPX_CHROME_PATH/FFMPEG_PATH 跑 example → 渲染报 E_NOT_CONFIGURED，其余功能全通
```

另外两条针对性回归用例（进 video 域测试）：
- **既有域零影响断言**：1xxx 迁移 up→down→up 幂等，且 up 后既有域集成测试（task/schedule/notify）全绿。
- **契约面快照**：openapi 中既有 161 个端点（139 个 path 条目）的定义块 diff 为空（CI 里 check_api 已覆盖集合层，此处额外钉"零修改"）。

---

## 6. 结论

架构把"影响半径"作为一等设计约束：**业务语义全部隔离在产品域（example/internal/video），框架只新增一个零依赖平台包（capx）和一个 UI 组件（Slider），共享契约面全部通过"声明即扩展"的既有机制（RegisterScope / Catalog.Register / plan.limits / openapi 增量 / audit 泛型表）接入**。因此：既有能力不受影响，既有接口零修改；框架消费方升级无感，example 部署获得纯增量能力且可完整回滚。所有诚实触碰点（§4 共 10 项）都是加法可见或同批维护义务，无一改变既有行为。

---

## 7. 审计修订记录（v1.1，2026-11-14）

本节记录对 v1.0 的逐条事实核对结果（方法：把文档中每条可证伪断言与代码/CI 配置对账；纯设计意图类断言不在审计范围）。

### 已修正

| # | v1.0 表述 | 实际 | 证据 |
|---|---|---|---|
| A1 | "platform 现有 22 个包" | **23 个** | `ls platform` 输出 23 个目录（cronx…wsx）；本特性仍零改动 |
| A2 | "正式决策另落 docs/adr/0016-…" | **0016 已被占用**（`0016-personal-workspace-provisioning.md`）→ 改为 `0017` | `ls docs/adr` |
| A3 | "既有 74 个 path" | **161 个端点（139 个 path 条目）** | `python tools/check_api.py` 输出 `spec routes: 161  code routes: 161`；routes_contract_test.go:52 `expectedRouteCount = 161` |
| A4 | "make verify 含 docs 语言守卫" | **不含**。make verify = check-api + build/vet/test；语言守卫在 CI `verify.yml:81-82` 单独跑 | Makefile:6-7；`.github/workflows/verify.yml` |
| A5 | （遗漏）"既有测试不受影响" | 须同批改 `example/cmd/app/routes_contract_test.go`：`expectedRouteCount` 常量 + `mountProductionRoutes` 镜像列表 | routes_contract_test.go:44-52（注释原文"update this constant in the same change"） |

### 新增的触碰点（v1.0 未覆盖，已补入 §4.8–4.11）

| # | 触碰点 | 性质 |
|---|---|---|
| B1 | `routes_contract_test.go` 契约义务式修改 | 既有测试同批维护，非回归 |
| B2 | 视频文件下发必须自建 workspace 授权（example 既有 `/uploads/` 是匿名路由，storagex 包注释明说鉴权是产品责任） | 新路由安全约束，禁止复制匿名先例 |
| B3 | WS `video` scope 订阅需接 `hub.Authorize` 项目归属校验 | 新 scope 装配义务（hub 对 nil Authorize fail-closed，见 v1.2 修正 C1） |
| B4 | 计费口径开放点：quota-only vs billing `metered_` 键 | 产品决策，建议先 quota-only |
| B5 | `packages/client` `ScopePrefix` 联合类型需加 `'video'`（ws.ts:24 当前 `'workspace'|'user'|'task'|'chat'`） | 类型层加法，随 client minor；hooks/runtime 仍零触碰 |

### 第二轮审计（v1.2，针对架构文档的断言，2026-11-14）

对 [plan-agent-video-studio-architecture-2026-11-14.md](./plan-agent-video-studio-architecture-2026-11-14.md) 的可证伪断言做了同一方法的对账，其中影响本文档结论的修正如下（其余见架构文档 §12 审计记录）：

| # | v1.1 表述 | 实际 | 证据 |
|---|---|---|---|
| C1 | B3 表述"不接 hub.Authorize 回调则任意已登录用户可订阅任意项目的 IR 推送" | **方向性错误**。hub 对自定义 scope 的 subscribe 在 `Authorize == nil` 时直接 rejected（fail-closed）：不接回调的后果是 **video scope 订阅全部被拒、功能不可用**，不是安全裸奔。安全义务不变（必须接回调并校验归属），但风险定性从"跨租户泄露"改为"装配缺失 = 功能性 fail-closed + 接错校验才有泄露面" | hub.go:437 `if h.Authorize == nil \|\| !h.Authorize(...)` → `rejected:subscribe`；Authorize 回调类型 hub.go:57 |
| C2 | 未提及 | `E_QUOTA_EXCEEDED` 是 HTTP 402 语义（`NewQuotaExceeded` → 402 / respond.go:123），MCP 工具侧复用该错误时 Agent 看到的是 error text 而非 402；文档表述已对齐 | apperr.go:35、respond.go:123 |
| C3 | 未提及 | gsap 现为 100% 免费商用（Webflow 收购后全员免费，含原 Club 插件）；vendored 分发前仍应过一遍 Terms of Use | gsap.com/pricing（2026-11-14 查证） |

### 核对通过（抽样，无需修改）

- `main.go:1337` 1MiB pathGate 覆盖 `/api/` `/auth/` `/dev/` `/mcp` ✓（grep 确认）
- `main.go:966` `hub.Capabilities = wsx.Capabilities()` ✓；`main.go:118-119` 产品迁移 embed ✓；`main.go:837-844` MCP 注册回调 ✓
- `wswire.go:65` `RegisterScope` ✓；`mcpx.go:7-9` env 门控默认关 ✓
- quota fail-closed：`limit := limits[key]`（consume.go:44）+ 条件 INSERT 不满足即拒绝（consume.go:115-146）+ `webx.NewQuotaExceeded`（consume.go:137）✓
- owner 全量 catalog：`EffectivePerms` owner 分支（workspace/app/roleconfig.go:75-78）✓
- `check_api.py:118` 单侧漂移即 exit 1 ✓；storagex "Range requests are not implemented — media streaming products should front this with their own handler" ✓
- ui 无 Slider（`grep -ri slider packages/ui/src` 零命中、无 slider.tsx 文件）✓；ui 当前 2.9.0（minor 加法导出 `^2` 兼容）✓
- 框架迁移最大编号 053（本特性不动 001–999，下一号仍 054）✓
- 本文件以 `plan-` 前缀豁免中文（check_docs_language.py `PROCESS_DOC_PREFIXES = ('delivery-audit-', 'plan-')`）✓
- `webx.BodyLimitExcept` 存在（platform/webx/bodylimit.go:30），§4.6 的放宽方案有真实 API 支撑 ✓
