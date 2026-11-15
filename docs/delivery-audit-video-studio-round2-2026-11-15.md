# Video Studio 案例库测试第 2 批实测记录（Round 2）

- **日期**：2026-11-15
- **代码基线**：起点 HEAD `823e181`（round-1 留存提交）；本轮含 D-01 修复
- **对照文档**：[plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md](./plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md)（round1 修正后）+ [round1 实测记录](./delivery-audit-video-studio-round1-2026-11-15.md) §5 下一批入口
- **执行方式**：五路并行（D-01 修复 / C04+C06 渲染 / 文档 High 修正 / golden 复核 / 字幕链实测）

---

## 0. 本批总判定

| 入口项（round1 §5） | 结果 |
|---|---|
| 1. 修 D-01（counter onUpdate 被抑制） | ✅ **修复且比预期深**——实为三层叠加缺陷，全部关闭；F360 fail→pass（10 ok / 0 fail） |
| 2. 按事实修正案例库文档 4 处 High 差异 | ✅ 9 处 `[修正 2026-11-15 round1]` 标注落地，原文划线存证 |
| 3. C04/C06 进 L1 渲染 | ✅ 两案全帧渲染（1800+2250 帧），0 fail，差异清单进 M2 依据 |
| 4. golden 人工复核升级 A 基线 | ✅ C01 10/10 复核通过 → **A-eligible（降级表达基线）** |
| 5. race 环境修复 | ❌ 未动（msys2 残留，环境问题，不在仓库范围） |

**额外发现**：字幕 soft 模式**整体不存在**（新确认缺口）；counter 遮挡问题的第三层根因（z-index）。

---

## 1. D-01 修复：实为三层叠加缺陷（本轮最重要成果）

第 1 批只看到表层（pause 抑制事件）。修复过程中逐层剥离：

| 层 | 问题 | 修复 |
|---|---|---|
| 1. 事件抑制 | GSAP `tl.pause(t)` 单参默认 suppressEvents=true，onUpdate（counter 写数字的回调）被压制 | capx `seekTimeline` 改 `tl.pause(t, false)`（renderer.go） |
| 2. 对比度 | counter 宿主继承 `.el-text` 白字，奶白底上 1.06:1 | builder 缺省色改 `#2B2118`（C01 主文字色），IR 可用 `params.color` 覆盖（白名单同步补 color 键） |
| 3. **遮挡（新发现）** | counter div 无 z-index（auto），画在全画布 `el_bg`（z-index 1）**之下**——DOM 里数字在，截图里没有 | builder 加 `z-index: 9999` |

**修复效果**（3 次复跑一致）：
- 探针 textContent@t=12：`''` → `"8767 件"`；@13.5s → `"12600 件"`（插值精确）
- golden frame-360：纯底色 → **"8767 件" 深墨字清晰可见**
- F360 断言：fail（dark_ratio 0.0003）→ pass（dark_ratio 0.2303）；整案 **10 ok / 0 fail**
- 确定性测试两轮全绿（参数钉满 + pause 双参下逐帧 SHA-256 一致）

**方法论收获**（写进记忆）：DOM 探针只能证 DOM 态，证不了像素态——data-URL 渲染路径下"DOM 有、截图无"的唯一解释是层叠遮挡。

## 2. C04 / C06 L1 渲染（M2 规划依据）

| | C04（数据可视化） | C06（访谈字幕） |
|---|---|---|
| 渲染 | 1800 帧全循环，3m29.8s（116ms/帧） | 2250 帧全循环，4m2.2s（107.6ms/帧） |
| 判定 | ok=5 / mismatch=5 / **fail=0** / degraded_na=1 | ok=7 / mismatch=4 / **fail=0** / degraded_na=1 |
| D-01 像素实证 | F960 counter 数字可见（修复像素级生效）；但双 counter div 同位叠印、白字浅底不可读两缺陷仍现役 | — |

**M2 关键输入**（期望 vs 实际，全量在 l1-c04/c06-report.json）：
- **T-11 图表生长**：柱是**整柱中心 scaleIn**（非自底部立起）；三柱全可见实际要 F327（帧表写 F216）
- **锚点口径错位**：帧表锚帧与 IR 词锚帧普遍差 9-105 帧（C06 结论句差 105 帧被渲染坐实）——M2 必须统一口径
- **折线全失**：el_line 渲染为 440×300 实心蓝矩形（三点/连线全无）
- **C06 切换实证**：说话人切换 onset=帧 232（文档窗口 230±2 内，in-window ✓）；无动画驱动的镜 4/6/8 画面保持（按帧表口径不计 fail）
- **C04 封面帧 900 不含主图**（环 F909 才入场）——封面锚需改

## 3. 文档修正（4 High 全落地，原文存证）

9 处 `[修正 2026-11-15 round1]` 标注，全部带 round1 文档/spec-audit-report.json 证据指向，原文划线保留（+65/−1 行）：
- 封面帧：两列口径重判（包内函数 ✅ / 端到端管线 ⛔）
- 两案 IR 示范块加 ⚠️ 警告框（指向 testdata/ir/*.degraded.json 降级转换）
- F-C06-01：期望从"自动降级软字幕"改为"渲染失败"（事实修正）
- X-4 作用域：§1.8/§5.12/§4.2.6/§4.4.6 四处按全量 5 类特效重述
- §8.8 新增 round1 实测差异登记节（16 条全量索引）

## 4. golden 复核：C01 升级 A-eligible（10/10）

- D-01 修复导致 3 帧重生成（F360/F396/F449），复核按新像素执行；其余 7 帧哈希确认与修复前逐字节一致（已有结论直接有效）
- **F360 目检确认 "8767 件" 深墨字清晰可见**——D-01 修复的最终人证
- F12 对比度判定：文档 18% 目标过期（隐含"居中大版式"前提），实测 bbox 只占区域 12.5% + 字重降级 400——T-01 落地前用 ≥1% 口径，落地后恢复 18% 并整批重生成
- **caveat 已写入 meta.json**：这是**降级表达基线**——像素级可信、可用于逐像素断言，但基线编码的已知降级（卡堆叠/高亮不可见/CTA 无文字）是 IR 表达力缺口记录，不是验收目标画面
- 新增 `golden_sanity_test.go` tripwire（尺寸/背景色/异常帧/捕获签名固化）

## 5. 字幕链路（T-14）——新确认缺口

| 模式 | 结果 |
|---|---|
| burn | ✅ pass——真机 libass 烧录成功，抽帧目检字幕清晰（cue 带像素变化 49174/19804） |
| **soft** | ❌ **fail——整体不存在**：SRT 写临时文件后无人消费（只 burn 分支读它），defer 删除；capx 全文无 mov_text API。soft 产物与 none 完全相同 |
| none | ✅ pass |

- **CJK 切散实证 5/5**："十五杯"切十|五杯、行首"，"违反禁则、46 rune 单词双行超限——缺陷实证样本（含 SRT 原文）全部入报告
- **ErrNoLibass 结论**：错误链 burn→fail→JobCancel 终态失败不重试；**soft 路径未实现 = 降级目标无处可去**——无 libass 部署机上每个 burn 渲染必失败且无字幕替代
- SRT 时间格式 4 样本全合法（含 >1h 极端）

---

## 6. 全量门禁（本轮收口实测）

```
go build/vet ./... (root)              PASS
go test ./platform/capx ./internal/arch  ok（16.0s / 6.4s）
go -C example vet（默认+capx 两模式）    PASS
go test ./internal/video/...            5 包全 ok
go test -tags capx ./internal/video/testdata  ok 581.6s（C01×3 复跑 + C04 1800帧 + C06 2250帧 + 字幕 e2e + golden sanity 全过）
check_api 172:172 零漂移                OK
docs language guard                     OK
```

## 7. 产物清单（全部留存）

```
docs/plan-...-case-library-...md          # round1 修正 9 处落地
docs/delivery-audit-video-studio-round2-2026-11-15.md  # 本文档
platform/capx/renderer.go                 # D-01 根因修复（pause 双参）
example/internal/video/app/timeline-builder.js  # counter 色缺省+z-index
example/internal/video/app/ir.go          # counter params.color 白名单
example/internal/video/testdata/
├── golden/c01/（3 帧重生成 + meta.json 含 review A-eligible）+ golden_sanity_test.go
├── golden/c04/（11 帧 + meta.json）/ golden/c06/（12 件）
├── c04_c06_render_test.go / l1-c04-report.json / l1-c06-report.json
├── subtitle_l2_test.go / subtitle-report.json / subtitle/（3 MP4 + SRT + 抽帧）
├── l1_render_test.go / probe_dom_test.go / corner_probe.go（D-01 双向探针更新）
└── l1-report.json（C01 修复后刷新，10 ok/0 fail）
```

## 8. 第 3 批入口建议

1. **soft 字幕实现**（mov_text 封装）——本轮确证的完整缺口，实现后 C06 才能走 soft 验收；
2. **ErrNoLibass 降级链**（burn 失败 → soft 兜底）随 1 一起闭环；
3. **BuildCues 词保护兜底**（超限词不再切散 + kinsoku 行首标点）——CJK 实证样本已就绪可直接做回归断言；
4. **锚点口径统一**（帧表 vs 词锚，M2 前置）——文档已在 C06 处留二选一标注；
5. L2 补 counter 元素的合成 IR（D-01 修复后的编码链路验证）；
6. race 环境修复后补 `-race` 车道（msys2 清理，环境项）。
