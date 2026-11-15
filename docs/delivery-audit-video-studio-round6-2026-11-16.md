# Video Studio 案例库测试第 6 批实测记录（Round 6）——M2 收官批

- **日期**：2026-11-15/16
- **代码基线**：起点 HEAD `e174a3e`（round-5）；本轮含 P0-1 边界修复（F0 黑帧）+ 共享 harness 增强（Assets resolver/帧表双形态）
- **对照文档**：案例库 §2.3（M2 门槛：9 案例 L1/L2 全绿 + 人工验收点）+ [round5 记录](./delivery-audit-video-studio-round5-2026-11-15.md) §7
- **执行方式**：五路并行——批6-3（golden 重审）/6-4（L2 六案）/6-5（M2 汇总）完整回报；批6-1（C02/03/05）中途死亡后恢复后台（自包含策略）已交付 C02；批6-2（C07/08/09）死亡后由主会话重建 harness 并亲自跑通三案

---

## 0. M2 判定

**九案 L2：9/9 全绿（达成）。九案 L1：7/9 渲染完成且结构全绿（C01/C04/C06/C07/C08/C09 + C02 五个 fail 均为断言校准非渲染缺陷）；C03/C05 渲染 golden 已落盘但报告 pending（批6a agent 再次中断）。人工验收点 42 条中 5 条已被像素断言代替、8 条部分验证、29 条待真人复核（产物 MP4/PNG 全部就绪）。**

判定：**M2 结构层达成（渲染链路九案全部打通、零渲染结构损坏）；断言校准（C02 五处区域/颜色）与人工复核（29 条）为余项**。诚实结论——不给"全绿"名义，给精确状态。

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
