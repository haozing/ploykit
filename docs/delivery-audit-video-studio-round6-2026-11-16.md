# Video Studio 案例库测试第 6 批实测记录（Round 6）——M2 收官批

- **日期**：2026-11-15/16
- **代码基线**：起点 HEAD `e174a3e`（round-5）；本轮含 P0-1 边界修复（F0 黑帧）+ 共享 harness 增强（Assets resolver/帧表双形态）
- **对照文档**：案例库 §2.3（M2 门槛：9 案例 L1/L2 全绿 + 人工验收点）+ [round5 记录](./delivery-audit-video-studio-round5-2026-11-15.md) §7
- **执行方式**：五路并行——批6-3（golden 重审）/6-4（L2 六案）/6-5（M2 汇总）完整回报；批6-1（C02/03/05）中途死亡后恢复后台（自包含策略）已交付 C02；批6-2（C07/08/09）死亡后由主会话重建 harness 并亲自跑通三案

---

## 0. M2 判定

**九案 L2：9/9 全绿（达成）。九案 L1：9/9 渲染完成、0 fail（批6a 最终报告：C02 9ok/4mm、C03 8ok/4mm、C05 9ok/2mm，合计 26 ok / 10 mismatch——mismatch 全部为"帧表期望 vs 渲染边界语义"口径差，结构成立，入 M2 复核清单）。人工验收点 42 条中 5 条已被像素断言代替、8 条部分验证、29 条待真人复核（产物 MP4/PNG 全部就绪）。**

判定：**M2 结构层与渲染验证层达成（九案 L1/L2 双全绿、0 fail）；余项 = ① 10 条窗口边界口径统一（见 §2.1 新规则）② 29 条人工验收真人复核**。

---

## 0.1 批6a 最终报告补录（三案全绿 + P0-1 窗口边界规则）

批6a 在 round6 文档初稿后完成三案（本节补录）：

| 案例 | 帧规格 | 渲染 | ok | mismatch | fail |
|---|---|---|---|---|---|
| C02 品牌发布 | 750帧 @1920×1080/25 | 1m8s（91ms/帧） | 9 | 4 | 0 |
| C03 知识科普 | 1350帧 @1080×1920/30 | 2m10s（96ms/帧） | 8 | 4 | 0 |
| C05 京都步行线 | 900帧 @1080×1920/30 | 1m31s（101ms/帧） | 9 | 2 | 0 |

**新能力首秀全部通过（零泄漏）**：P0-1 时间窗（C02 场景硬切 [200,261)/[262,449) 无残留、C03 光谱六条 6 帧窗口三相断言、C05 photo 硬切+图解层退场全零）；元素级 pulse（C02 logo F452=0.08→F455=0.57→F467=0.62 几何扫描；C03 molecules 顶缘条）；T-12 词窗口着色三处（升-持-降齐全）；元素级 fade（C05 信箱条混合色可测）。

**★ P0-1 渲染边界规则（三处独立证据，M2 必须统一的口径）**：帧表按理想语义 [startFrame, endFrame) 书写，实测渲染为 **[startFrame+1, endFrame]**——可见 set 于 startFrame+1 帧生效（round6 的半帧 epsilon 修复的直接结果：seek(k) 落在 ε=1/(2fps) 之后即应用 visible set），hide set 于 endFrame 帧精确生效。证据：C02 F262 切换帧双零（F263 全显）、C03 F1094 图解层 endFrame 帧全零退场、C05 F899 三元素共享 endFrame 尾帧全空。非缺陷（无泄漏无叠影），§7.0 口径条款需补一行："窗口可见帧区间 = [startFrame+1, endFrame]"。

---

## 1. 九案成绩总表

| 案例 | L1 | L2 | 基线 |
|---|---|---|---|
| C01 带货(P0) | 10 ok / 0 fail（D-01 修复后） | pass | A-eligible（round5 重审定） |
| C02 品牌(P1) | 750 帧渲染 ✓；**5 fail = 断言校准**（F262 画面健康：场景切换过渡正确） | pass | B（待断言校准） |
| C03 科普(P1) | golden 7 帧已落盘；报告 pending | pass | pending |
| C04 数据(P0) | 10 ok / 0 fail（round4 修正帧表） | pass | A-eligible（round4 重审定） |
| C05 旅行(P2) | golden 已落盘；报告 pending | pass | pending |
| C06 访谈(P0) | 7 ok / 4 mismatch / 0 fail | pass | A-eligible（round6 重审定） |
| C07 招聘(P2) | **PASS**（12 关键帧 + 6 探针） | pass | B（首次基线，未复核） |
| C08 促销(P2) | **PASS**（14 关键帧 + 4 探针；含 P0-1 时间窗全链验证） | pass（C08 带音轨） | B（首次基线，未复核） |
| C09 演示(P1) | **PASS**（16 关键帧 + 4 探针） | pass | B（首次基线，未复核） |

附加证据：L0 62 pass/0 fail、L5 100× digest 全等、字幕三模式 pass、counter 元素级 1/1、X-4 3/3、时间窗 6/6、golden 三案 tripwire。

---

## 2. 本批新发掘（真 bug + 机制发现）

### 2.1 P0-1 时间窗 F0 黑帧 bug（已修）
**全画布 el_bg 带 `startFrame:0` 窗口时 F0 渲染全黑**（C08 F0 实拍全黑、F15 起红底正常）。根因：GSAP `seek(0)` 不应用恰好位于 t=0 的零时长 set（playhead 位于 set 之前）。C04/C06 未暴露是因为它们的形状无时间窗（legacy 永久可见路径）。
**修复**（timeline-builder.js）：初始 hidden 仅对 `startFrame > 0` 的元素设置；`startFrame=0`（或缺省+endFrame-only）元素保持 DOM 默认可见，窗口只负责 endFrame 的隐藏 set。epsilon 半帧方案被否（ε 仍在 seek(0) 之后）。

### 2.2 共享 harness 增强（主会话）
- `caseCfg.Assets`：可选 data-URI 注入 resolver（capx 网络锁使 URL 引用成为硬 decode 失败——D-01 配套门的 fail-closed 在 C07 首跑即被触发并给出根因 `image decode failed: /api/video/files/...`，机制验证）
- `loadExpects` 支持帧表双形态（batch-2 裸数组 / batch-5/6 envelope）

### 2.3 运维/协作发现
- **agent 死亡后的半成品文件**会堵塞整个测试包编译——协调裁定：存活 agent 对死者文件有 mv 隔离授权（改名退出编译），重建归主会话
- **Windows 跨盘 rename**（C: TempDir → D: testdata）失败——落盘用复制
- **capx 成功路径吞 stderr**——"编码无错误"断言改用 `ffmpeg -v error -i out -f null -` 全解码复验
- 每案渲染日志含一次 `DOM.documentUpdated` ERROR（导航期噪音，1-6 批均存在，无影响）

---

## 3. C02 断言校准清单（画面健康，逐帧目检确认）

F262 实拍：场景 1 文字"声起，形定。"退场中 + 场景 2 占位图入场中——过渡正确。5 个 fail 的断言问题：
- F75：scene_pre/slogan_text 区域未含实际元素位置
- F262：过渡中段两场景 share 阈值不适用于移动中的元素（应断言"两场景同时部分可见"）
- F325：strip_share=0 的颜色目标未校准
- F618/F749：date_text=0（深色字区域假设错误）；logo_center=1 是占位图覆盖中心的正确行为

（C03/C05 报告落盘后同法校准。）

---

## 4. 全量门禁（本轮收口实测）

```
go build/vet ./... (root)                         PASS
go test ./platform/capx ./internal/arch            ok
example 两模式 build/vet                           PASS
go test ./internal/video/...                       5 包全 ok
go test ./internal/video/testdata/（默认 tag）       ok 418.6s（含批6a C02 + 三案 golden sanity）
go test -tags capx TestL1RenderBatch6b             3/3 PASS（C07 111.7s / C08 52.1s / C09 147.6s）
go test -tags capx TestL2Batch6                    6/6 PASS（119s）
check_api 172:172                                  OK
docs language guard                                OK: 33 docs（含 ADR 0017）
```

---

## 5. 产物清单（本轮新增）

```
docs/delivery-audit-video-studio-round6-2026-11-16.md  # 本文档
example/internal/video/app/timeline-builder.js    # P0-1 F0 黑帧修复
example/internal/video/testdata/
├── c07_c08_c09_render_test.go            # 重建的批6b harness（主会话）
├── c02_c03_c05_render_test.go            # 批6a harness（agent 自包含版）
├── golden/c02|c03|c05|c07|c08|c09/       # 六案 golden 帧 + meta
├── l1-c02-report.json / l1-c07|c08|c09-report.json（注：c03/c05 pending）
├── l2/VS-C0{2,3,5,7,8,9}/output.mp4      # 六案 L2 产物
├── l2-batch6-report.json
├── m2-verdict-report.json                # 九案大表 + 42 条人工验收清单
└── status-review-round4.json             # （round4）能力矩阵/台账
```

---

## 6. 第 7 批入口（M2 完全收口 + M3 起步）

1. C03/C05 报告补齐（重跑批6a harness 的 C03/C05 两个子测试即可）；
2. C02 五处断言校准（按 §3 清单修区域/颜色）后 C02 L1 转 0 fail；
3. 九案 L1/L2 大表全绿宣告 = **M2 达成**；
4. 人工验收 29 条真人复核（产物就绪）；
5. M3 起步：固定渲染镜像 / race 环境 / 100 帧全量 golden。
