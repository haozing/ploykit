# Video Studio 案例库测试第 4 批实测记录（Round 4）

- **日期**：2026-11-15
- **代码基线**：起点 HEAD `36ccf03`（round-3）；本轮落地 counter/X-4 元素级化 + F3/F1 修复，收口提交见文末
- **对照文档**：[round3 实测记录](./delivery-audit-video-studio-round3-2026-11-15.md) §8 第 4 批入口 + 案例库 §7.4（L3）
- **执行方式**：五路并行（L3 冒烟 / C04 修正帧表重跑 / counter 元素级化 / X-4 遮挡 / 状态盘点）——批4-3/4-4 两路超时但代码已完整落地，由主会话收尾核验

---

## 0. 本批总判定

| 入口项（round3 §8） | 结果 |
|---|---|
| 1. L3 端到端冒烟 | ✅（修复 F3 后）**首次真实全链路 succeeded**：150/150 帧、MP4 ftyp 正确、Range 206、幂等键闭环、配额/审计/状态机全部验证 |
| 2. 修正帧表重跑 C04 | ✅ **口径统一后首次全绿**（10 ok / 0 fail / 1 degraded_na），before/after 对照证明修正价值 |
| 3. counter 元素级定位 | ✅ IR 字段 + 校验 + builder 定位 + 像素级证明（in-flight 收尾核验通过） |
| 4. X-4 遮挡元素级化 | ✅ 四 effect target 支持 + overlay 兜底（高亮首次可见）；像素级证明通过 |
| 5. race 环境 | ❌ 未动（环境项） |

**新发掘（高价值）**：L3 冒烟首次运行即失败——**CapxRuntime 装配缺口（F3）**，且配额闭环在失败路径上全部正确工作（失败定位靠的正是 round2 修的状态机与补偿）。

---

## 1. L3 冒烟：发现并修复 F3 装配缺口（本轮最高价值）

### 1.1 首次运行即失败——这正是集成测试的价值

全链路前 6 步全过（DB/构建/启动/注册/登录/建项目），**提交渲染后 97ms 即 failed**：`capx pipeline not compiled in`——尽管二进制是 `-tags capx` 构建的。

**根因（F3，critical）**：`render_pipeline.go:44` 声明 `var CapxRuntime *capx.Runtime`（注释"injected at wiring time"），但 **main.go 的组装变量从未赋值给它**——全库唯一赋值点在测试文件。装配缺口，一行修复。

**失败路径的正确性（修复前就验证了）**：失败定位之所以精准，靠的正是前几轮修好的机制——River job 走 `river.JobCancel` 终态 cancelled（1/2 attempt）、配额失败释放（quota_period=2026-11 固化、released_at 置位、counter 归 0）、审计 created+failed 齐全、幂等键重放返回同一 render_id。

### 1.2 修复与复跑（全链断言全过）

修复：`render.SetCapxRuntime(rt)` tag-portable setter（stub 构建同名 no-op，main.go 无条件调用）。复跑断言全过：

| 断言 | 结果 |
|---|---|
| 提交 → 轮询终态 | **succeeded，150/150 帧**（≈20s 渲染） |
| 幂等键 | 同 `Idempotency-Key` 两次提交返回**同一 render_id**（同一行） |
| MP4 产物 | ftyp 头正确（`isom`）、18.3KB、经 `/api/video/files/` 下载 |
| Range | `Range: bytes=0-99` → **206** |
| DB 终态 | `status=succeeded`、`quota_period=2026-11` 非空、`released_at IS NULL`（成功不释放）、`quota_counter.used=1` |
| 审计 | `video.render.created` + `video.render.completed` 齐全 |

产物：`testdata/l3/smoke.mp4` + `server.log`；冒烟报告 `l3-smoke-report.json`（第 1 批 agent 产出，含失败的完整取证）。

### 1.3 顺带修复 F1（契约漂移）

openapi 的 renders POST 把参数写成平铺字段，实现要 `{"params":{...}}` 嵌套（冒烟首发即 400，第二个发现）。spec 已修正为嵌套结构 + burn_subtitles 描述更新（round3 降级已实现）。check_api 复跑 172:172 OK。

### 1.4 遗留注记

- capx 能力门挂在 `PLOYKIT_MCP_ENABLED`（复用 gate）——语义正确（缺配置 → 503 不建行不扣额）但值得在 ADR 里记录这个耦合。
- 冒烟中 CSRF 轮换坑：curl 会话要每次从 `/config` 取新 token（`X-CSRF-Token` 头 + cookie jar）。

---

## 2. C04 修正帧表重跑：口径统一后首次全绿

修正帧位断言 **10 ok / 0 fail / 1 degraded_na**（194s 全 1800 帧渲染，107ms/帧）：

| 原→新 | 断言 | 实测 |
|---|---|---|
| 216→**327** | 三柱全可见 | 0.41/0.55/0.76，高度 180:240:330 单调 ✓（**最强证据**：同一次渲染内 F216 仅 1 柱可见，MAE 46.0） |
| 720→**609** | 折线时段 | 蓝色 1.00 落定（实心矩形降级标记） |
| 900→**909** | 环入场 | onset 0 → F939 落定 0.98（封面修正闭环） |
| 960→**957** | counter 窗口 | 数字可见 ink 0.28（**D-01 修复持续成立，无回归**） |
| 1620 | 片尾 | 蓝色 43.3% 与 round2 实测 43.33% 精确一致 |

产物：`testdata/golden/c04-round3/`（25 帧 + meta.json）+ `c04-rerun-report.json`（9 行含每帧推导算式 + 4 组 before/after）。

## 3. counter 元素级定位 + X-4 元素级化（in-flight 收尾核验通过）

两路超时前代码已完整落地，主会话核验：

- **IR**：`Effect.TargetElementID`（omitempty 向后兼容）+ 写时校验（引用存在性，dangling → E_VIDEO_IR_INVALID）
- **builder**：`resolveTarget`（有 target=元素节点，无 target=canvas/overlay）+ counter 定位到目标 bbox + **z-index 9999 保留**（D-01 第三层不回退）+ highlight/fade 无 target 时走 **z-9999 overlay**（高亮首次可见——round1 实测 amber=0 的遮挡根因关闭）
- **MCP 白名单**：effectIn 增加 targetElementId；**openapi**：VideoIR effect schema 同步
- **像素级证明**：`TestCounterL2_TargetElement` PASS（counter 定位到目标元素）；`TestX4Effects` PASS（57.8s，元素级高亮/overlay 路径验证）

## 4. 状态盘点（批4-5）

- 矩阵重判 4 项格变：T-14 字幕 ⚠️/⚠️→**✅/✅**、T-10 counter ⛔→**✅**（in-flight 落地后）、T-12 highlight ⛔→**⚠️/✅（预估）**、T-01 分层改判 ⚠️/⚠️（SRT 层禁则 ✅、DOM 层排版维持 ⚠️）
- **M2 缺口**：P0-1（元素时间窗）/P0-2（元素级 opacity）未动是最后两块硬骨头；六案（C02/03/05/07/08/09）降级 IR 未建；估算 **5-8 批次**到 M2
- **问题台账**：33 条 → fixed 23 / in-flight 3 / open-挂账 7
- 产物：`status-review-round4.json`

---

## 5. 全量门禁（本轮收口实测）

```
go build/vet ./... (root)                       PASS
go test ./platform/capx ./internal/arch          ok
example 两模式 build/vet（含 SetCapxRuntime 注入）PASS
go test ./internal/video/... + cmd/app           6 包全 ok
go test -tags capx -run "TestCounterL2|TestX4"   PASS（21.3s / 20.6s / 57.8s）
check_api 172:172（含 renders 契约修正后）         OK
docs language guard                              OK
L3 冒烟全链（修复后）                              succeeded + 五项断言全过
```

## 6. 产物清单

```
docs/delivery-audit-video-studio-round4-2026-11-15.md  # 本文档
docs/openapi.yaml                        # renders 请求契约修正（F1）
example/cmd/app/main.go                  # SetCapxRuntime 注入（F3）
example/internal/video/render/render_pipeline.go / stub.go  # tag-portable setter
example/internal/video/app/ir.go         # Effect.TargetElementID + 引用校验（批4-3/4-4）
example/internal/video/app/timeline-builder.js  # counter 定位 + X-4 overlay（批4-3/4-4）
example/internal/video/adapters/mcp/tools.go    # effectIn targetElementId
example/internal/video/testdata/
├── l3/smoke.mp4 + server.log            # 首次全链路产物 + 服务日志
├── l3-smoke-report.json                 # L3 冒烟判定表（含失败取证）
├── golden/c04-round3/（25 帧 + meta）+ c04-rerun-report.json
├── counter-l2-report.json / counter_l2_test.go（TargetElement 变体）
├── x4-effects 产物（TestX4Effects）
└── status-review-round4.json            # 矩阵重判 + M2 缺口 + 33 条问题台账
```

## 7. 第 5 批入口建议

1. **L3 正式化**：把冒烟流程固化为可重复的集成测试（`l3_smoke_test.go`，TEST_DATABASE_URL 门控 + 自起服务进程），纳入 make test-db；
2. **P0-1/P0-2 IR 扩展**（元素时间窗 + 元素级 opacity）——M2 最后两块硬骨头；
3. **highlight 文字变色**（T-12 的完整形态，本轮只做了 background flash + 元素级定位）；
4. **六案降级 IR**（C02/03/05/07/08/09）批量构造 + L1 渲染；
5. race 环境（msys2 清理）后补 `-race` 车道；
6. **ADR 0017**：三轮实施+四批测试的证据已足够，正式落英文 ADR。
