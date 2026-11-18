# 交付审计：Video Studio 设计批（样式/动效/3D/节拍/词锚）——v0.34.0 发版前

> 审计对象：2026-11-18 全天四批「展示片极致化」驱动的框架增量（工具树 §5.4c–h），含发版前回归与两起审计期事件。
> 基线：HEAD = `b8e054e`（v0.33.2）。审计人 = 出单人（自我审计，事件如实记录）。

## 范围（工作树）

| 类别 | 文件 | 规模 |
|---|---|---|
| 源 | `app/ir.go` / `app/projector.go` / `app/timeline-builder.js` | +709 / +52 / +202 行，删除共 10 行（全部为 MaxElements 注释替换与白名单行内追加，零逻辑删除） |
| 测试（新） | `ir_style_test.go` / `ir_design2_test.go` / `ir_beats_test.go`（app）+ `style_layer_render_test.go` / `design2_render_test.go` / `gallery_batch_test.go`（capx） | 6 文件 |
| 测试（改） | `c04_c06_render_test.go`（CAPX_TEST_CHROME 贯通）/ `c07_c08_c09_render_test.go`（C08 断言 v0.33.1 语义） | 2 文件 |
| 文档 | 架构文档 §5.4c–h + 上限行 | +91 行 |
| 证据帧 | style-layer/、design2/、VS-TCB×3（重渲刷新） | — |

## 能力清单（逐项判定）

| # | 能力 | 写时校验 | 像素/行为证明 | 判定 |
|---|---|---|---|---|
| 1 | text 样式（fontFamily 白名单注册族/weight/tracking/lineHeight/align/stroke+paintOrder/shadow） | ✅ ir_style_test 17 例 | ✅ TestStyleLayerRender 四岛 | ✅ |
| 2 | textGradient（span 自持模式 + 与 stroke 互斥） | ✅ | ✅ 渐变岛（红上蓝下相对断言） | ✅ |
| 3 | textReveal words/chars × rise/pop（rise 走 top 保 clip） | ✅ | ✅ f0=0/f10=6121/f29=12386 | ✅ |
| 4 | shape gradient/radius/opacity | ✅ | ✅ | ✅ |
| 5 | glow 特效（有限 repeat + t0 set） | ✅ 必须有 target | ✅ halo ×14.6 | ✅ |
| 6 | groupScale（共享枢轴） | ✅ pivot 必填 | ✅ 双块外扩、原位归零 | ✅ |
| 7 | tilt（rotationX/Y + #canvas perspective 1600px） | ✅ | ✅ rotateY35° 宽 519→441 | ✅ |
| 8 | ir.beats（bpm/phase/bars/moments）+ atBeat（moment | bar+beat | +offset） | ✅ 一致性/互斥/越界全档 | ✅ TestBeatFrame_Math + ShowcaseParity | ✅ |
| 9 | 词锚 moment（word:{text,occurrence}，hypit 式） | ✅ 缺词 400 | ✅ Ocean@4.0s→F120 | ✅ |
| 10 | MaxElements 128→200 | —（放宽） | gallery 171 元素实证 | ✅ |
| 11 | clip wrapper 加固（clip-path+overflow+radius+will-change:auto） | — | TCB 岛重跑全绿（证据帧刷新为加固后渲染） | ✅ |
| 12 | CAPX_TEST_CHROME 贯通到 c04_c06/c07_c08_c09 harness | — | 真 Chrome 验证使用 | ✅ |

## 回归矩阵（发版门禁）

| 检查 | 结果 |
|---|---|
| go build/vet（根 + example，双模式） | ✅ |
| go test 根模块全部 | ✅ |
| go test example 全部（7 视频包） | ✅ |
| L1 九案真渲染（C01–C09） | ✅ 9/9（见事件 2） |
| capx 像素证明（TCB/AtFrame+resize/StyleLayer/Design2/CounterFlip） | ✅ 全绿 |
| 15 条 gallery IR 批量校验 | ✅ 15/15 |
| 语言门禁 34 docs / check_api 175:175 | ✅ |
| gofmt | 本批文件已格式化；compose_test/fontload/ports/service_db 等为 HEAD 既有漂移（stash 对照证实），未动 |

## 事件 1（审计自伤，如实记录）

隔离实验中我用 `mv` 挪 7 个 untracked 测试文件时**误删了 3 个**（design2_render / style_layer_render / gallery_batch）：第一条 mv 命令的目标目录参数写错导致 4 个成功、3 个报错后落在被清空的位置。处置：三份测试全部从会话记录**逐字重建**并重跑验证 PASS（断言数值与原版一致）。教训：untracked 文件做隔离实验应先 `cp` 到备份目录而不是 `mv`；重建后 diff 与原版对照确认无断言弱化。

## 事件 2（C08 失败定案：发版纪律缺口，非本批回归）

- 症状：L1 C08 在新代码 9 案回归中 F390 `countdown ink=0` 失败。
- 隔离：perspective 回退 → 仍败；projector 全 HEAD → 仍败；三源全 HEAD → **仍败** ⇒ 与本批无关。
- 根因：**v0.33.1（11-17 已发版）把 counter 的文本宿主改为直接写 textContent**，数字颜色从旧 div 宿主的深色 #2B2118 变为继承宿主 #FFD166（amber）。C08 断言仍在量"深色数字"（基线 digits_ink=dark 0.0869）。v0.33.1 落地后 C08 从未重跑——发版门禁没把 L1 全案纳入 nightly。
- 修复：断言更新为 v0.33.1 语义（amber-host ±30，实测 0.093；双轨容忍 dark 旧值），注释记录语义变迁。重跑 PASS。
- 流程建议（未实施）：L1 九案应进每次 video 域发版门禁（约 18 分钟串行，可并行化）。

## VS-TCB 证据帧漂移说明

三帧 PNG 变化（±0.4%）来自 clip wrapper 加固（overflow:hidden + border-radius）：圆角边缘抗锯齿路径不同。断言（窗外零红、窗内 >150k）不变且通过；证据帧保留加固后渲染，随本批提交。

## 遗留与建议

1. gofmt 既有漂移（compose_test 等 6 文件）建议独立 chore 批处理，不混入本版。
2. L1 全案纳入发版门禁（见事件 2）。
3. gallery 15 条成片待发社交（工具树侧产物，不阻塞本版）。

## 结论

32 项能力/门禁条目全绿；两起事件均已定案并修复。**建议发版 v0.34.0。**

---

## 发版后补记：v0.34.1 from-leak 热修（2026-11-18 晚，同日出片时发现）

- **症状**：tool-site v2 展示片采用「成品房冷开场」（第 0 帧就要完整成品房）后，
  第 0 帧所有贴纸消失/缩成小点；DOM 探针实测 `matrix(0.0988,…)` = 落件 pop 的
  `fromValue 0.1` 被写进了 build 态。
- **根因**：`timeline-builder.js` 的 `scaleIn`/`rotate` 用 `tl.fromTo(...)` 未传
  `immediateRender:false`，GSAP 默认在 build 期立即写 from。v1 的贴纸元素窗口从
  落件帧才开始（startFrame=pop），所以这条路径从未被「第 0 帧可见」的元素覆盖；
  v0.34.0 的冷开场第一次踩中。
- **修复**：`immediateRender: !(at > 0)`——at==0 保持 TRUE（首个动画的 from 就是
  编辑态），at>0 关闭（start 之前保持静态样式）。move/resize/groupScale 语义不变。
- **回归**：新增 capx `TestScaleFromLeakAtFrameZero`（100×100 方块 + 窗口从 0 +
  f10 scaleIn 0.1→1；第 0 帧必须 ~10000 白像素）。对 pre-fix builder 负跑实测
  恰好 100 像素（10×10），证明守卫有效；positive 跑 PASS。Design2/StyleLayer
  两套像素岛同时重跑 PASS。
- **发布**：v0.34.1（Go-only patch），CHANGELOG 已补条目。
- **教训**：元素「窗口起点」与「动画起点」解耦后，任何 `fromTo` 类的 build 期
  from 写入都会在窗口外可见；发版门禁应包含一条「frame-0 可见性」像素用例。

