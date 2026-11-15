# Video Studio v2.0 文档 × 303c010 代码 细致审计

- **日期**：2026-11-15
- **对象**：`docs/plan-agent-video-studio-architecture-2026-11-14.md` v2.0（21 节重写版）↔ master @ 303c010 实施代码
- **方法**：五路并行审计（对账/事务/capx/安全/生命周期+门槛），全部断言以实跑命令与 file:line 为证
- **性质**：工作记录（`delivery-audit-` 前缀，中文豁免于 docs 语言守卫）

---

## 1. 总裁决

**v2.0 文档的设计修订清单（§0.2 P0/P1）基本全部成立——文档作者对"该改什么"的判断是对的；但其"代码现状"陈述（§0.3/§0.4/§17）是对着集成前的旧快照写的，8 组断言 5 组 REFUTED。而审计在文档之外又挖出两个文档完全没发现的 P0（preview 播放器拿不到 IR、video REST 全量 403）。**

| 维度 | 结论 |
|---|---|
| 文档的代码现状断言（§0.3/§0.4/§17） | 8 组：5 REFUTED / 2 PARTIAL / 1 CONFIRMED——多为集成前陈旧快照 |
| 文档的设计修订要求（§0.2 P0/P1） | 逐条对照代码：**绝大多数 CONFIRMED 为真实缺陷** |
| 文档未覆盖的新 P0 | 2 个（projector IR 数据块、wsMW 缺失），均比文档点名的问题更早挡住功能 |
| §16 合入门槛复跑 | 全部可跑项 PASS（check_api 172/172、框架 86 包、verify-ui 974、tsc、contract test）；test-db 由 303c010 提交记录覆盖；`-race` Windows cgo 环境阻断 |

---

## 2. 已驳回的文档断言（HEAD 实测）

| # | 文档断言 | 实测 | 
|---|---|---|
| R1 | check_api 172/161 漂移，11 条 spec-only | **172/172 零漂移 exit 0** |
| R2 | main.go 未装配（路由/MCP/WS 未注册） | 全部在位：videohttp.Mount main.go:1245、videomcp.RegisterTools :1278、wswire.RegisterScope :973、hub.Authorize :977-986、capx.New :1219、独立 river client :1261、videoRunner :1697 |
| R3 | capx 奇数尺寸测试失败 | 18 测试全 PASS——夹具**刻意用 2×2 规避**（encode_test.go:35-37 注释自认）；奇数必败是真实的潜在缺口但不是测试红灯 |
| R4 | verify/verify-ui/test-db 未运行 | HEAD 复跑全绿（86 包 ok + slider 4/4 + 974 全量） |
| R5 | UI 仍有 Slider/ScopePrefix TODO | 三类 TODO 全部 0 残留 |
| R6 | §17-F2「未形成闭环」/F4「后端未接通」 | 两条均 REFUTED：契约零漂移+装配齐全；前端 WS/乐观锁/轮询兜底逐项确认在位 |

PARTIAL：§17-F3「未实现生产 worker」（worker+capx 管线是真实现，但生产级三缺口成立，见 §4）；example 独立 module 的表述为真但属命令用法错误。

---

## 3. 文档完全没发现的两个新 P0（本轮审计新挖出）

### N1. preview 播放器根本拿不到 IR（静默全坏）`[P0]`
`projector.go:183` 把 `escapeJSONBlock(irJSON)` 作为普通 string 传入 html/template，插值位置在 `<script type="application/json">` 内——html/template 对 script 上下文的 string 按 **JS 表达式**转义，实测输出为整体带引号的字符串字面量。`JSON.parse(textContent)` 不抛错但返回**字符串而非对象** → `IR.meta` undefined → 播放器空转。XSS 反而被双重挡住，但功能全坏，且无任何测试能抓（现有 projector 测试只断言哈希与转义字符）。**修复**：数据块插值改 text/template 或手工拼装，保留 `\u003c`+`</` 双转义，补 `</script>`/U+2028 注入测试。

### N2. video REST 缺 wsMW → 非平台管理员全量 403 `[P0]`
session/PAT principal 不携带 `WorkspaceID`（identity pats.go/sessions.go 不填）——该字段由 `workspacehttp.WorkspaceHeaderCtx`（wsMW）从 `X-Workspace-Id` 头填入。task/schedule/billing 全部经 wsMW 包裹，**videohttp.Mount 没有**。后果：`p.WorkspaceID=""` → membership 查空 → 一律 403；platform-admin 直通后 `WHERE workspace_id=''` → 404。**按当前装配，video REST 对所有人不可用**（fail-closed 纯属巧合）。单测通过是因为测试手工构造了带 WorkspaceID 的 principal。同根问题：**authz 三键（video:read/write/render）注册了但零消费**——video:render 对 member 未授予却照样能提交渲染，授权矩阵不成立。

---

## 4. 文档设计要求逐条裁决（全部为代码真缺陷）

### P0 级（v2.0 §0.2 前七行 + 新发现）

| # | 缺陷 | 证据 | 修复要点 |
|---|---|---|---|
| P1 | **river 生命周期三参数全缺省**：JobTimeout 默认 **1min**（>60s 渲染必被取消→重试循环→discarded，长渲染结构性不可能成功）；MaxAttempts 注释称 2 实际**默认 25**；SoftStopTimeout 未设 → drain 时 work ctx 继承 start ctx 被立即硬取消，45s 窗口不存在 | main.go:1261-1265 只设 Queues+Workers；worker.go:32-34 注释失实；river client.go:53,1219-1224 | 设 JobTimeout 15min / SoftStopTimeout 15min / MaxAttempts 2；修注释；部署 termination grace ≥ SoftStop |
| P2 | **配额消费在事务外**：ConsumeWith 先提交、render 行后插——中间 crash = 扣费落库无 render 行，无补偿 | service.go:711（消费）vs :722 BeginTx | quota 包加 ConsumeWithTx/ReleaseTx（框架面扩展，v2.0 D9），消费+INSERT+InsertTx 同一短事务 |
| P3 | **终态释放既不同事务也无幂等**：fail() 里 transition 与 release 两个独立 Exec；Release 是 `GREATEST(0,used-n)` 纯递减，river 重试 N 次释放 N 次，会吃掉同 workspace 其他渲染的合法支出 | worker.go:203-215；quota.go:152-158 | 按渲染释放一次（released_at 列或 idem），释放与终态同事务 |
| P4 | **中断路径补偿全部写在已取消的 ctx 上**：ctx.Err()≠nil 后 transition/release/push 用同一个死 ctx → pgx 立即 Canceled，`_=` 吞掉 → 行停留 running、配额停留已扣 | worker.go:174-181 | 补偿写入改 `context.WithoutCancel` 派生 ctx |
| P5 | **errSilentFail 不是 river 不可重试错误**：普通 error → 照常重试，叠加 P3 = 每次重试再释放一次；且 loadRender/update 无状态守卫 → failed 可被翻回 running | worker.go:41-43,183；store.go:35-40 无 WHERE status | 包 `rivertype.JobCancel`；终态 UPDATE 加 `WHERE status IN ('queued','running')` + affected rows 检查 |
| P6 | **TTS/Aligner 在 FOR UPDATE 行锁内**：SetScript 把 deriveWords（60s 外部调用+Store.Put 网络 I/O）放在 Mutate 闭包内，锁被放大到 ~60s+ | service.go:182-251（事务范围）、:442（闭包内调用）、:460/:489 | 两阶段：外部调用移出事务，短事务重取+重验版本再写（v2.0 §6.3） |
| P7 | **无客户端提交幂等键**：renderID 服务端 NewV7 → 同一 Agent 网络重试 = 两行 render+两次扣费；quota idemKey 传 renderID 永不冲突，幂等层对本场景完全失效 | service.go:707,711；routes.go:169-177 不读 Idempotency-Key | REST 读 Idempotency-Key / MCP 加 request_id；video_render 加 (workspace_id, submission_key) 唯一索引；命中返回既有行 |
| P8 | **durationFrames 四口径**：service 截断(meta) / worker 截断(meta) / pipeline 截断(voice扩展) / JS round(voice扩展)——入库 frames_total 与真实捕获不一致，进度条错位 | service.go:735；worker.go:157；render_pipeline.go:76-81；timeline-builder.js:34 | 单一函数 `ceil(max(meta,voice)×fps)` 在 service 落库，worker/pipeline 读行值，JS 改 ceil |
| P9 | **capx 池无上限 + 实例复用失效**（同一根因）：acquire 取不到空闲实例就无条件 launch（无 semaphore）——实跑 PoolSize=1 六并发出 **12 个浏览器**；且 inst.ctx 指向无 Browser 的 allocator ctx → 每个渲染偷起新 Chrome、warm 实例 20s 被 launch timeout 杀死 | capx.go:171-184；browser.go:42-54；chromedp NewContext 语义 | semaphore 硬上限（chan struct{} 容量 PoolSize）；launch 的 cdpCtx（持 Browser）存入实例，launch 超时只包首次 Run；渲染 tab 从实例 ctx 派生；Close 追踪在途 |
| P10 | **奇数尺寸编码必败且无防护**：无 scaler/pad，实跑 1×1/3×3/1081×1921 全 FAIL（`width not divisible by 2`）；Validate 不拒奇数；测试靠 2×2 夹具回避 | encode.go:67-85；renderer.go:71-81 | Validate fail closed 拒奇数 + 管线兜底 `scale=trunc(iw/2)*2:trunc(ih/2)*2`（修复命令已实测有效）+ 补奇数用例 |
| P11 | **IR 无 schemaVersion 且内嵌行 version（双真值）**；1005 冗余 script 列 service 不维护（更新 ir.script 不同步列） | ir.go:146-155；1005 迁移 :7,9 | IR 加 schemaVersion、删 IR.Version、删冗余 script 列（或 Mutate 同步维护） |
| P12 | **MCP 未强制 PAT-only**：requireToolScope 对 session 直通，叠加 /mcp 在 CSRF 豁免前缀（main.go:1353）= 同站 XSS 可带 cookie 调工具 | tools.go:317-326 | 非 SourcePAT 统一拒绝 + session 被拒测试（v2.0 D6，兼容成本≈0） |

### P1 级

| # | 缺陷 | 证据 |
|---|---|---|
| Q1 | 资产无登记/引用表：key 前缀授权 = workspace 成员全量可读、删除项目对象永久残留可读、撤销无效（`immutable, max-age=31536000` 一年缓存） | routes.go:236-302,281 |
| Q2 | 锚点 {text,occurrence}+静默自动 nearest（无 repair 门/unresolved 状态）；词身份=数组下标 | ir.go:73-76,486-525 |
| Q3 | 资源失败双层吞：builder `decode().catch(()=>{})` 空 catch（timeline-builder.js:146）+ capx 不读 `__player.error`（通道不存在）→ 缺图照常出片"成功" | renderer.go:209-229 |
| Q4 | worker 终态无 `WHERE status` 守卫 + river rescue 与 SweepOrphans 冲突（sweep 判死的行可被重投递覆盖回 running）+ sweep 不释放配额 | worker.go:234-250；store.go:35-40 |
| Q5 | 审计缺口：Delete 零审计、render.interrupted 零审计、mutation_failed/access_denied/quota_exceeded 未实现 | service.go:412-429；worker.go:168-177 |
| Q6 | MixAV 偏离规范：缺 `normalize=0`（默认会压人声）、duration=first 非 longest、无 apad/atrim/aresample、BGM 不 loop | encode.go:161 |
| Q7 | render 路径字体未内嵌 data URI（系统字体栈，跨机确定性与缺字风险） | projector.go:279-281 |
| Q8 | 上传无内容嗅探/解码验证/像素上限；REST「大文件走 REST」名不副实（实际 700KB=MCP，BodyLimitExcept 未用） | service.go:864-871；routes.go:207 |
| Q9 | 截图参数未钉满（缺 clip/scale=1/captureBeyondViewport 显式）；setBlockedURLs 前无 network.Enable；data: URI 阻断下加载无测试 | renderer.go:152-158,189-192 |
| Q10 | CSP 缺 base-uri/form-action；InlineScriptHash 失败时 CSP 头静默跳过（应 500） | routes.go:161-164 |

### 文档 CONFIRMED 且代码核实属实的欠账（无争议清单）

无 heartbeat 列、无提交幂等键、无资产登记表、无 render recipe（schemaVersion/projectVersion/irSha256/renderer 版本/字体清单/assets 清单/quotaPeriod）、无 reconciler、无取消端点（§11.5 的 DELETE active-render 409 也未实现：删除级联删 render 行，在途 job 下次 loadRender ErrNoRows 静默 return）。

---

## 5. 验证为正确/扎实的部分（不需要动）

- river job 与 render 行同事务、审计 RecordTx 同事务、WS 推送 defer 到 commit 后（service.go:722-760）
- REST PUT expected_version 强制（routes.go:119-122）；MCP 与 REST 同一 Mutate 路径
- 帧时钟无累计误差（每帧独立 `i/FPS`，非累加）；双 rAF；双轮 SHA-256 确定性测试真跑 PASS
- ffmpeg stdin 治理/ctx 取消 kill/stderr 尾部进 err/临时文件 defer 清理
- quota fail-closed 与 1008 同批交付 = 文档声明的预期设计（含旧库自愈 UPDATE）；1008 down 精确移除键
- preview XSS 面：textContent 全程、无 innerHTML、storagex ValidKey 拒 javascript:/data: src、哈希 CSP 字节级锁定
- 前端：WS scope/帧处理/轮询兜底（仅 active render 时 1s）/乐观锁 toast/bridgeWsToQuery 全部在位且行为正确

---

## 6. 修复批次建议（依赖排序）

| 批次 | 内容 | 说明 |
|---|---|---|
| **批1（解锁功能）** | N1 projector 数据块、N2 wsMW+authz.Guard 接入 | 不修这两个，端到端任何人都跑不通；改动小、无框架面扩展 |
| **批2（渲染可用性）** | P1 river 三参数、P4 死 ctx、P5 JobCancel+状态守卫 | 同一圈 worker.go/main.go 改动，做完长渲染才可能成功 |
| **批3（配额正确性）** | P2 ConsumeWithTx、P3+Q4 释放幂等/同事务/quotaPeriod 列、P7 提交幂等键 | 需 quota 框架面加 Tx 变体（v2.0 D9 预案）+ 迁移 1009（submission_key、quota_period、released_at、heartbeat/attempt 可捎带） |
| **批4（capx 治理）** | P9 池 semaphore+实例复用、P10 奇数尺寸、P11 前半、Q3 资源失败、Q9/Q10 小项 | capx 单包内，随批1之后做互不阻塞 |
| **批5（契约与体验）** | P6 TTS 出锁、P8 帧数公式、P12 PAT-only、Q1 资产表+缓存降级、Q2 wordId、Q5-Q8 | wordId 迁移成本中等（存量惰性升级），最后做 |

批次 1-2 建议先行合入（纯代码、无迁移、无框架面变更）；批 3 涉及 quota 包公共 API 需谨慎评审；批 5 的 wordId/re-架构项可按 v2.0 §20 阻断清单节奏推进。

---

## 7. 审计覆盖说明

- 五路 agent 全部以实跑为证（check_api、go test 根+example、vitest 974、tsc、capx 真浏览器/真 ffmpeg 编码、PoolSize 压力探针、chromedp 源码语义核对、river v0.49 默认值源码核对、html/template 转义实测）
- test-db 门禁未在本次复跑（本机无 5437 实例），以 303c010 提交前实跑记录为准；`-race` 因 Windows cgo 环境阻断，列入待办
- 文档 §17-F0 判「迁移需修订」已过时（迁移存在且集成过），但 F0 行对「授权/原子性需修订」的判断被本轮 CONFIRMED
