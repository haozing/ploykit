# Video Studio 案例库测试第 5 批实测记录（Round 5）

- **日期**：2026-11-15
- **代码基线**：起点 HEAD `fa1de7c`（round-4）；本轮含 P0-1/P0-2/T-12 业务实现 + ADR 0017
- **对照文档**：[round4 实测记录](./delivery-audit-video-studio-round4-2026-11-15.md) §7 第 5 批入口
- **执行方式**：五路并行（L3 正式化 / P0-1 时间窗 / 文字变色+P0-2 / 六案降级 IR / ADR 0017）——批5-2 超时但代码完整落地（endFrame 边界语义由并行窗口期自然收敛），主会话收尾核验 app 包全绿

---

## 0. 本批总判定：**M2 硬骨头全部清零**

| 入口项（round4 §7） | 结果 |
|---|---|
| 1. L3 冒烟正式化 | ✅ `l3_smoke_test.go`——自起真实服务进程 + 全链 HTTP + DB 直查断言；**真跑两连绿（30.9s/29.96s）**；无 DB 干净 skip |
| 2. P0-1 元素时间窗 | ✅ `Element.StartFrame/EndFrame`（指针型/全局帧时钟/≤DurationFrames 校验）→ builder `tl.set(visibility)` 正交设计；像素级验证在位 |
| 3. highlight 文字变色（T-12 完整形态） | ✅ text 元素词窗口文字变色，三分断言全过（原色→高亮色→回落，深浅双极性）；元素粒度 vs 逐词 span 边界记录 |
| 4. P0-2 opacity 动画 | ✅ fadeIn/fadeOut 白名单 + fromTo autoAlpha；正交轴协同学法注释（时间窗拥 VISIBILITY、opacity 动画拥 OPACITY） |
| 5. 六案降级 IR | ✅ 12 文件全过 Validate（含锚点 exact-only 强门槛）；执行中途检测到 P0-1/P0-2 落地，原地升级——80 个元素窗口按各案文档原值采用 |
| 6. ADR 0017 | ✅ `docs/adr/0017-agent-video-studio.md`（68 行英文，7 项决策 + Implementation and testing lessons 特色节；语言守卫 OK，33 docs 入册） |

---

## 1. L3 冒烟正式化（F3 教训的制度化）

`l3_smoke_test.go`：测试内 `go build -tags capx` 自起真实服务进程（空闲端口 + 轮询 /healthz + 失败时服务日志尾部嵌入消息）→ DB 清理幂等（42P01 视为无可清）→ CSRF 轮换全链 HTTP（随机 email 注册→登录→建项目→PUT IR→幂等键提交+重放断言→轮询终态）→ DB 直查断言（status/quota_period/released_at/submission_key/配额 used=1/审计恰 2 条）。

**真跑证据**：`--- PASS: TestL3Smoke (30.93s)` + `(29.96s)` 两连绿（含构建+真实渲染）；无 TEST_DATABASE_URL 时干净 skip。从此装配缺口（F3 类）会被 CI 常规车道抓住，不再依赖人肉冒烟。

## 2. P0-1 + P0-2 + T-12（M2 硬骨头三连清）

- **P0-1 时间窗**：`Element.StartFrame/EndFrame`（指针型区分未设置与 0；全局帧时钟 ≤DurationFrames）→ builder `tl.set(node, {visibility}, t)` 正交设计——**时间窗拥 VISIBILITY、opacity 动画拥 OPACITY**，按 GSAP 时间轴位置自然组合（协同规则已注释）。像素级验证在位（timewindow 测试）。
- **P0-2 opacity**：fadeIn/fadeOut 白名单 + `tl.fromTo(autoAlpha)`；大小写变体拒绝等校验测试独立文件（避开并行写冲突）。
- **T-12 文字变色**：text 元素 highlight 升级为**词窗口文字变色**（窗口=词锚 start→词 end；词 end≤start 回退 flash 节奏）；shape/overlay 保留 flash（X-4/L2 基线兼容）。三分断言（原色→#FFD166→回落）深浅双极性全过，背景零泄漏。
- **边界记录**（供 §5.12 回填）：元素粒度变色 ≠ 逐词变色（单文本节点不拆 span）——C01 验收语义成立（三个高亮各挂独立元素），真正逐词 span 是 T-01/P1 级。
- **确定性与回归**：L5 100× 逐帧哈希全等复跑通过（461s）；X4/counter/L1 三案/L2 编码全绿。

## 3. 六案降级 IR（执行中途的能力升级红利）

C02/C03/C05/C07/C08/C09 十二文件全过 Validate（含"全部锚点 reason=exact"强门槛）。**执行中途检测到 P0-1/P0-2/T-12 落地**，按规则原地升级：80 个元素窗口按各案文档原值采用（C02 场景切换 200/261/262、C03 光谱六条错峰、C07 右栏五段、C08 券面 90/130/210、C09 菜单/面板 360/599/600）；15 个 effect 全保留元素级目标（"counter 堆画布左上"类问题清零）；C03/C05 三个 text 高亮升级词窗口着色。P0-2 六案零消费者（文档动画表均无 fadeIn/fadeOut——如实记录）。三条文档矛盾不静默修正（C05 脉冲作用于隐藏节点等，frames.json 逐条标注）。

## 4. ADR 0017

`docs/adr/0017-agent-video-studio.md`：7 项决策映射架构 D1-D12；特色节 **Implementation and testing lessons**（F3 装配缺口只有端到端能抓、DOM 探针盲区、text-template 转义陷阱、GSAP pause suppressEvents、frag MP4 无 nb_frames、MCP gate 耦合）——全部指向四份 round 记录。68 行精炼，语言守卫 OK。

---

## 5. 全量门禁（本轮收口实测）

```
go build/vet ./... (root)                    PASS
go test ./platform/capx ./internal/arch       ok（16.1s / 4.8s）
example 两模式 build/vet                      PASS
go test ./internal/video/app/                 全绿（含 P0-1 边界、fade 校验、kinsoku）
check_api 172:172                             OK
docs language guard                           OK: 33 docs（ADR 0017 入册）
TestL3Smoke 两连绿                            30.9s / 29.96s
```

## 6. 产物清单

```
docs/adr/0017-agent-video-studio.md          # 正式 ADR（新）
docs/delivery-audit-video-studio-round5-2026-11-15.md  # 本文档
example/internal/video/app/ir.go             # Element 时间窗 + fadeIn/fadeOut 白名单
example/internal/video/app/timeline-builder.js  # 时间窗 set + 文字变色 + fade builders
example/internal/video/app/subtitle_kinsoku_test.go / ir_animation_fade_test.go  # 新测试
example/internal/video/adapters/mcp/tools.go # animate_element 类型白名单同步
example/internal/video/testdata/
├── l3_smoke_test.go                          # L3 正式化（两连绿）
├── fade_highlight_test.go / timewindow 测试  # 像素级验证
├── ir/c02|c03|c05|c07|c08|c09.degraded.json + frames.json ×6  # 六案 12 文件
├── ir/six-cases-report.json                  # 六案对照 + M2 readiness
└── golden_sanity_test.go（tripwire 重审定：X-4 修复后 F90/F250 全帧均匀 #FFD166 为新签名）
```

## 7. M2 剩余差距（第 6 批入口）

1. **六案 L1 渲染**：降级 IR 已就绪，按 c04_rerun 模式批量渲染 + 修正帧表断言（估算 6×2-4 分钟）；
2. **golden 重审**：X-4/counter 修复改变了基线画面语义（F90/F250 全帧 #FFD166 是新正确签名）——C01 基线已重审定，C04/C06 同样需要按新签名复审；
3. **L2 六案短片段**（§7.3 每案一段）；
4. **九案 L1/L2 全绿判定** = M2 达成宣告；
5. race 环境 / L3-L5 全量 / 分享链接等维持挂账。

---

## 附：五批累计轨迹

| 批 | 提交 | 核心成果 |
|---|---|---|
| 1 | 823e181 | M1 达成；D-01/F-DB-1/F-G3-1 发掘 |
| 2 | f1b6cf4 | D-01 三层修复；C04/C06 渲染；soft 缺口确认 |
| 3 | 36ccf03 | soft 落地；CJK 修复；口径统一；100× 确定性 |
| 4 | fa1de7c | L3 全链 succeeded（F3 装配缺口）；元素级化 |
| 5 | e174a3e | M2 硬骨头清零；L3 正式化；六案 IR；ADR 0017 |
