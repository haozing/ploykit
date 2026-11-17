# Video Studio IR v2 契约 Spec

> 日期：2026-11-17
> 状态：契约定稿稿（展开 `docs/plan-video-studio-ir-v2-2026-11-17.md` §3.1 / §3.2 / §3.5 的源纲；该文是"为什么重构"，本文是"契约长什么样"）
> 前缀说明：`plan-` 前缀过程文档；v2 落地实现时，本文的字段表应升格为正式契约文档并同步 `example/internal/video/app/ir.schema.json`（plan doc §3.1 第 9 条）。
> 证据基准：本文所有 v1 行为描述均先读代码再落笔，逐条给出 `file:line`。读证基准（工作树现状，含未提交的 `MaxElements=128` 热修）：
> - `example/internal/video/app/ir.go`（v1 契约与校验全函数）
> - `example/internal/video/app/timeline-builder.js`（v1 渲染语义唯一实现）
> - `example/internal/video/app/projector.go`（播放器文档模板与 CSS）
> - `example/internal/video/app/service.go`（`DurationFrames` 单源、TTS 装配、`MaxRenderDurationSec`）
> - `example/internal/video/render/render_pipeline.go`、`platform/capx/encode.go`（混音链）
> - `example/internal/video/app/scriptgen/`（`compose.go` / `window.go`）、`example/internal/video/app/template/template.go`（组装层）
> - `docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md` §7.0（时钟裁定）与 §5.16（窗口语义）
> - 三个存量消费者实况核查（见 §4.3）

---

## 1. 定位与红线

### 1.1 定位

IR v2 是 Video Studio 中间表示（`video_project.ir` 文档）的 **schemaVersion 2** 一次性迁移：

- **不做 v1/v2 双读**。`schemaVersion != 2` 的文档在读路径即拒绝（v1 的 `normalizeSchema`「盖戳兼容」语义，`ir.go:201-204`，随 v1 删除）。存量三个消费者（9 案例 fixture、shuijing promo、tool-site pilot ir.json）一次性迁移，动作清单见 §4.3。
- **语义从代码注释升为机器可读契约**（本次重构的灵魂，plan doc §3.1 第 9 条）：每个字段的坐标空间、单位、时钟、窗口语义落进 `example/internal/video/app/ir.schema.json` 的 description，随 openapi 引用。v1 里「真相住在 timeline-builder.js 注释与案例库考古文档」的状态（plan doc R2）是本迁移要消灭的头号对象。
- **builder 变笨**：一切时轴推断上移到组装期（scriptgen）或写时校验（Validate）；渲染端只读显式值。

### 1.2 红线（不动的部分）

| 红线 | v1 证据 | v2 处置 |
|---|---|---|
| player 自包含 + fail-closed：零网络、资源失败必须中止渲染 | projector §4.4.5 零网络（字体 data URI 内联，`projector.go:117-122`）；图片 `decode()` 失败写 `__player.error` 且 `ready` 不翻转（`timeline-builder.js:433-446`） | 不变。v2 新增字段全部走既有投影路径（data block + 哈希 CSP），不引入任何取网络的能力 |
| IR 内不开放任意 JS/HTML | IR data block 为非执行 `<script type="application/json">`，`escapeJSONBlock` 封死早闭合（`projector.go:236-242`） | 不变。`scene` 元素的 `params.timeline` 是**数据**不是代码，绘制委托给产品预注册的渲染器模块（§2.11），不破坏此红线 |
| 时钟语义：`frame = ceil(t × fps)`，三消费者同源 | 案例库 §7.0 裁定（`F = max(1, ceil(max(meta.durationSec, voice.durationSec) × fps))`，`service.go:1388-1401` 单源；JS `Math.ceil`，`timeline-builder.js:43`） | **不变**。§2.1 逐条钉死 |
| 元素窗口语义：可见帧 `[startFrame+1, endFrame]`（含尾） | 案例库 §5.16/§7.0：visible set 在 `tStart + 1/(2fps)`、hide set 在 `tEnd + 1/(2fps)`（`timeline-builder.js:409-432`；VS-TW run 20261116-205029 边界探针实证） | **不变**。v2 新增的 `at` 时钟、`scene`、音频轨全部复用同一时钟与同一窗口语义 |
| 写时严格 / 读时宽容的分工 | `Validate` 硬 400（`ir.go:253-254`）；未知**动画**类型读时跳过告警（`timeline-builder.js:449-452`）、未知**特效**类型同（`timeline-builder.js:462-463`）。注意：未知**元素**类型的跳过只有注释声明（`ir.go:28-29`、`timeline-builder.js:386-387`），代码实况是落进 shape else 分支渲染为空 div（见 §5 开放问题-2b） | 保持分工。但「无锚动画」从读时宽容（静默 t=0）**改为写时硬错误**（§2.8）——这是有意收紧，不是破坏分工 |

### 1.3 明确不做（与 plan doc §5 对齐）

- 不做 origin/坐标系开关参数：move 语义只有「绝对中心坐标」一种（§2.8）。
- 不做 IR v1/v2 双读兼容层。
- 不在 player 开放任意 JS/HTML。
- 不预建远程渲染/分布式 bake。

---

## 2. 逐字段契约（v1 → v2 对照）

> 表列约定：**坐标空间** = 数值参照的原点与轴；**单位**；**时钟** = 数值落在哪条时间轴上（全局帧钟 `frame = ceil(t × fps)` 简记「全局帧钟」）；**窗口语义** = 与元素时间窗 `[startFrame+1, endFrame]` 的关系；**必填** = v2 写时校验口径。

### 2.0 顶层结构

| 字段 | v1 | v2 | 说明 |
|---|---|---|---|
| `schemaVersion` | 常量 `IRSchemaVersion = 1`（`ir.go:180`）；`normalizeSchema` 每次读/写盖戳并剥离遗留行级 `version` 键（`ir.go:201-204`） | **`2`**。读路径见非 2 即拒绝，`normalizeSchema` 兼容逻辑删除 | 与 `video_project.version`（乐观锁行版本）是两个数，永不可混（`ir.go:173-179` 注释，v2 延续） |
| `meta` / `script` / `words` / `effects` / `elements` / `audio` | 见 §2.1–§2.10 | 见各节 | `audio` 从 `*Audio{voice,bgm}` 改为 `{tracks: [...]}`（§2.10） |
| JSON Schema 落盘 | 无（契约在 Go struct 注释 + builder 注释） | `example/internal/video/app/ir.schema.json`，每字段 description 写坐标空间/单位/时钟/窗口语义，随 openapi 引用 | plan doc §3.1 第 9 条 |

### 2.1 meta（时钟与画幅——红线，全不变）

| 字段 | v1 | v2 | 坐标空间/单位 | 时钟/窗口语义 | 必填 |
|---|---|---|---|---|---|
| `meta.fps` | 白名单 `{24,25,30,50,60}`（`ir.go:219`），`0` 缺省补 30（`ir.go:348-350`） | **不变** | 无量纲 | 全局帧钟的基频 | 是（可省略→30） |
| `meta.width` / `meta.height` | 360–2160 整数（`ir.go:354-359`） | **不变** | 画布像素（`#stage` 尺寸，`projector.go:321-328`） | — | 是 |
| `meta.durationSec` | `> 0` 且 `<= MaxRenderDurationSec = 600`（`ir.go:361-369`；`service.go:185`） | **不变** | 秒（float64） | 帧数公式 `F = max(1, ceil(max(meta.durationSec, voice时长) × fps))` 的输入之一 | 是 |
| 帧数 `DurationFrames` | 单源 `service.go:1388-1401`；JS/worker/管道同源派生（案例库 §7.0 三消费者条款） | **公式不变**。唯一开放点：v1 的「voice 扩展」输入是 `audio.voice.durationSec`；v2 改为 tracks 后该输入如何派生（取 `kind=voice` 轨的 max `outSec`？）见 §5 开放问题-7 | 帧 | 合法帧 `[0, F-1]`；seek 网格 `t = frame / fps`（`timeline-builder.js:103,500-504`） | — |
| 词锚帧换算 | `frame = ceil(word.start × fps)`（案例库 §7.0 裁定条款；浮点表示按 IEEE-754 double 实际值取整，如 `9.2×25=229.999…→230`，不引入 ε 修正） | **不变**。v2 显式 `at:{frame}` 由组装期按同一算式生成 | 帧 | 全局帧钟 | — |

### 2.2 words（回归字幕/脚本本义；为 wordId 锚新增 id）

| 字段 | v1 | v2 | 必填 |
|---|---|---|---|
| `words[].index/text/start/end/source` | `ir.go:62-69`；`source ∈ tts|aligner|manual|estimated`（`ir.go:38-43`）；写时校验单调递增不重叠（`ir.go:268-282`） | **不变**。words 回归本义：字幕与脚本对齐；**manual words 不再承担动画时锚职责**（plan doc §3.1 第 1 条）——pilot 的 33 个假锚词 hack 路径就此消灭 | 同 v1 |
| `words[].id` | **不存在**（`ir.go:62-69`；案例库 §5.16 P2-4 提案字段） | **新增**：`at:{wordId}` 的引用目标。id 由 TTS/对齐摄取时生成，文档内唯一 | v2 新增；存量词表由迁移器按 `w<index>` 规则补 id（§4.2） |

> 说明：v1 的 `Anchor{text, occurrence}`（`ir.go:71-76`）+ 四步解析 `ResolveAnchors`（exact > same_text > nearest > missing，`ir.go:604-649`）与 `resolvedFrom` 审计（`ir.go:80-83`）**不再进入 v2 文档契约**（见 §2.8/§2.9）；文本锚降级为作者侧写时工具（§3.3）。其去留细节与 `resolvedFrom` 审计视图的归宿见 §5 开放问题-5。

### 2.3 element 公共字段（几何与图层——除注明外全不变）

| 字段 | v1 | v2 | 坐标空间/单位 | 时钟/窗口语义 | 必填 |
|---|---|---|---|---|---|
| `elements[].id` | 必填非空（`ir.go:425-427`）；模板域命名 `tpl_<role>_<idx>_<name>`（`template/template.go:14-16`） | **不变**；另作为 `effect.targetElementId` 与 `at` 无关的引用目标 | — | — | 是 |
| `elements[].type` | `image|text|shape`（`ir.go:29-34`）；「未知类型读时跳过」仅见于注释——builder 实况是非 image/text 一律落 shape 分支（空 div），见 §5 开放问题-2b | **`image|text|shape|scene`**（新增 scene，§2.11） | — | — | 是 |
| `elements[].x / y` | 画布左上角为原点的**元素框左上角**坐标；builder 直写 `style.left/top`（`timeline-builder.js:68-69`）；写时只查有限性（`ir.go:478-480`） | **不变（角点原点保留）**。move 端点改中心坐标是 animation 自己的语义，见 §2.8 与 §5 开放问题-3 | 画布像素，`#canvas`（与 `#stage` 同 inset:0）坐标系 | 静态布局值，无窗口交互 | 是 |
| `elements[].w / h` | `>= 0` 且有限（`ir.go:481-483`）；builder 直写 `style.width/height` | **不变** | 像素 | — | 是 |
| `elements[].z` | 整数；渲染 `zIndex = 1 + el.z`（`timeline-builder.js:72`）；模板域分层 0/10/20（`template/template.go:28-32`）；counter host 固定 9999、X-4 overlay 固定 10000（`timeline-builder.js:221,587`） | **不变** | 画布栈序 | — | 是（缺省 0） |
| `elements[].startFrame / endFrame` | 指针字段区分缺省与 0（`ir.go:150-155`）；校验非负、start ≤ end、以 `DurationFrames` 封顶且 `endFrame == F` 合法（`ir.go:490-515`） | **不变**。窗口语义是红线（§1.2） | 帧 | 可见帧 **`[startFrame+1, endFrame]`（含尾）**：visible set `tStart + 1/(2fps)`、hide set `tEnd + 1/(2fps)`、折叠窗（start==end）hide set `tStart + 1/fps`（`timeline-builder.js:409-432`）；`startFrame=0` 的元素保持常挂载（GSAP seek(0) 不应用恰在 t=0 的零时长 set，`timeline-builder.js:82-94`） | 否（双缺省=全程可见） |
| `elements[].src`（image） | 必填；仅接受 `video/<workspace>/` storage key，拒 URL/data:（`ir.go:431-442`，SSRF 收口） | **不变** | — | — | image 必填 |
| `elements[].animations[]` | 见 §2.8 | 见 §2.8 | — | — | 否 |

### 2.4 element 静态变换（v2 新增——位姿不再烘进 PNG）

| 字段 | v1 | v2 | 坐标空间/单位 | 时钟/窗口语义 | 必填 |
|---|---|---|---|---|---|
| `elements[].rotation` | 无（旋转只能经 `rotate` 动画表达，且是补间不是静态位姿） | **新增**：静态旋转角。数值文法与 GSAP `rotation` 对齐（度）；渲染在元素 transform 链上应用 | 度（deg），正=顺时针；绕 `transformOrigin` | 静态值；与窗口正交（窗口管 visibility，变换管 transform——v1 既定正交设计，`timeline-builder.js:74-81` 注释） | 否（缺省 0） |
| `elements[].flipX` | 无（pilot 的镜像贴纸只能预烘进 PNG） | **新增**：水平镜像布尔。渲染实现=CSS `scaleX(-1)` 复合进 transform 链（与 rotation、动画 scale/rotate 的复合顺序在实现时钉进 schema description） | 布尔 | 同上 | 否（缺省 false） |
| `elements[].opacity` | 无（元素级透明只能走 fadeIn/fadeOut 动画） | **新增**：静态不透明度 | 无量纲，`[0,1]`；缺省 1 | 静态值；fadeIn/fadeOut 动画在此基础上补间 | 否（缺省 1） |
| `elements[].transformOrigin` | 无字段；**行为固定 50% 50%**——`scaleIn`/`rotate` 动画的 builder 硬编码（`timeline-builder.js:317,323`） | **新增**：元素变换原点。缺省 `50% 50%`（保持 v1 行为零漂移）；值文法（百分比/关键词/px 的接受子集）见 §5 开放问题-11 | 相对元素框的百分比（缺省文法） | 静态值；scaleIn/rotate/rotation 共用 | 否（缺省 50% 50%） |

> 迁移注意：v1 未带这些字段的元素加缺省值后渲染像素不变（rotation=0、flipX=false、opacity=1、origin=50%50%），9 案例/shuijing/pilot 无需为存量字段做数值换算（§4.2）。

### 2.5 image 元素（object-fit 语义写明）

| 项 | v1 | v2 |
|---|---|---|
| 渲染节点 | `<img>`，`object-fit: contain` 硬编码于样式表 `.el img, img.el`（`projector.go:331`） | **语义写进 schema description：图片按 contain 装入元素框 `w×h`**——框内容比与图片原始比不一致时留白（案例库 §6「contain 留白为近似」行的正式化） |
| 是否暴露 objectFit 字段 | 无（P2-7 提案里有 `objectFit` 复合键，未实现） | **v2 不加开关**（对齐 plan doc §5「不做坐标系/origin 开关」的同一立场：单一语义，消灭 A5 类「语义在实现不在契约」事故）。若未来内容逼出需求，按 append-only 注册表走新版本，不在本文预支。见 §5 开放问题-13 的记录 |
| decode fail-closed | `timeline-builder.js:433-446` | 不变（红线） |

### 2.6 text 元素（v2 新增排版四件套 + 字体资产）

| 字段 | v1 | v2 | 单位/缺省 | 必填 |
|---|---|---|---|---|
| `elements[].text / color / fontSize` | `textContent`、`style.color`、`style.fontSize`（`timeline-builder.js:56-60`）；样式表缺省 48px / #fff / pre-wrap / line-height 1.35（`projector.go:332-335`） | **不变** | px（fontSize）；CSS 颜色文法（color） | text 元素：text 必填，余否 |
| `elements[].letterSpacing` | 无 | **新增**：字间距 | px（缺省 0，渲染零漂移） | 否 |
| `elements[].lineHeight` | 无字段；样式表固定 1.35 | **新增**：行高倍数。**缺省 1.35**（= v1 样式表值，迁移零漂移） | 倍数（无单位比值，与 CSS line-height 数值文法一致） | 否 |
| `elements[].stroke` | 无（Baloo 类字效只能预烘 PNG，plan doc A11） | **新增**：文字描边。子结构 `{color, width}`（建议稿，文法=CSS 颜色 + px）；渲染实现优先 `-webkit-text-stroke`（Chrome 管线确定性等同既有字体路径） | px / 颜色 | 否 |
| `elements[].shadow` | 无 | **新增**：文字阴影。子结构 `{color, offsetX, offsetY, blur}`（建议稿，文法=CSS text-shadow 数值序）；缺省无阴影 | px / 颜色 | 否 |
| `elements[].font` | 无；字体族硬编码 `"Noto Sans SC Sub", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`（`projector.go:333`），唯一内联字体是 vendored Noto Sans SC 可变子集（wght 100–900 data URI @font-face，`projector.go:117-122`） | **新增** `font: {assetKey, weight}`：字体作为资产（上传 woff2 → 内容寻址 → player 内联 @font-face，资源门 `document.fonts.ready` 已有扩展即可，plan doc §3.3 第 1 条）。`weight` 无量纲（400–900，可变轴）；`assetKey` 写时校验登记行（对称 image src，§2.14）。**缺省缺省行为 = 现行硬编码字体族**（存量文本零漂移）；硬编码链保留为缺省回退 | weight 整数 | 否 |

> Baloo 类装饰字效的「字体文件即资产」路径由本节 + §2.14 写时校验承接；`font.assetKey` 的存储域（是否复用 `video/<workspace>/` 还是独立 `font/` 前缀）见 §5 开放问题-14。

### 2.7 shape 元素

| 项 | v1 | v2 |
|---|---|---|
| 渲染 | `<div class="el-shape">`，`color` 直写 `background`，样式表固定 `border-radius: 8px`（`timeline-builder.js:61-64`；`projector.go:337`） | **不变**（本文不含 shape 形状枚举扩展；案例库 P2-8 的图形复合键走后续提案） |

### 2.8 element.animation（v2 收紧的核心）

#### 2.8.1 `at`（新增，必填）

| 项 | v1 | v2 |
|---|---|---|
| 锚字段 | `startAnchor *Anchor{text, occurrence}`（可选，`ir.go:114`）；解析结果 `resolvedFrom` 回写（`ir.go:117`） | **`at: {frame: N} | {wordId: string}`，必填**。无锚 = `Validate` 硬 400（`E_VIDEO_IR_INVALID` + `details.field`），**不是静默 t=0** |
| v1 缺锚实况 | 动画分发 `at = resolvedFrom.wordIndex >= 0 ? words[wordIndex].start : 0`（`timeline-builder.js:453`）——锚 miss **静默落到 0 帧**（案例库 §7.0 第 4 条照实登记，F-ANC-01）；fade 另有窗口回退（§2.8.4） | 删除两条静默路径：t=0 回退与 fade 窗口回退。计划 doc A6 的「靠文档考古避开」类事故就此封死 |
| `{frame: N}` | — | 整数帧号，全局帧钟，合法域 `[0, F-1]`；写时校验越界 400 |
| `{wordId}` | — | 引用 `words[].id`（§2.2）；解析时刻 `t = words[i].start`，帧值 = `ceil(t × fps)`（§7.0 算式不变）。**二值性说明**：`{wordId}` 在写时校验后是否落盘为词引用（保持脚本编辑存活）还是规范化为显式帧，见 §5 开放问题-4 |
| `durationFrames` | `> 0`（`ir.go:456-458`）；时长按帧计不换算秒，从锚帧起顺序消耗（案例库 §7.0 第 3 条） | **不变** |
| `easing` | 白名单 `linear|power1.out|power2.out|power3.out|back.out|expo.out`（`ir.go:233-236`），缺省按动画类型各异（§2.8.2/2.8.3） | **不变**；各类型 v1 缺省 easing 在 v2 schema description 里写成显式缺省值 |

#### 2.8.2 `move`（语义改定：绝对中心坐标）

| 项 | v1（代码实况） | v2 |
|---|---|---|
| `from` / `to` 语义 | **绝对左上角坐标**：builder 取元素布局位置 `style.left/top`，把 from/to 换算成 GSAP 平移量 `from.x - left`（`timeline-builder.js:306-313`）。plan doc A5：试点 30 件贴纸因误读为「中心坐标」全体右下偏移半幅 | **绝对中心坐标**：from/to 是元素框**中心点**在画布坐标系的目标位置。二选一，无 origin 开关（plan doc §5） |
| `from` 缺省 | 缺省 = 元素当前 `left/top`（`timeline-builder.js:307`） | `from` 可省略，缺省 = 元素静态几何（`x + w/2, y + h/2`，即当前中心）；`to` 必填（v1 `to` 缺省=from 静止，v2 收紧为必填，防「写了 move 却没动」的哑动画） |
| 单位/坐标空间 | 画布像素 | 不变（画布像素），仅原点参照从框角点改框中心 |
| 换算公式（迁移用） | — | `v2_point = v1_point + (w/2, h/2)`（from/to 各加；元素框 `w×h` 全程不变，故为常量平移，插值路径等距平移，换算精确）。该公式与 rotation/flipX/opacity 无耦合：GSAP 平移叠加在布局位置上，旋转/缩放不改变平移量的合成（`timeline-builder.js:309-312` 的 x/y 即纯平移） |
| `path`（新增，可选） | 无（折线只能拆成 N 条 move，受每元素 16 动画上限约束，案例库 §5.17） | **`path: [{x,y},...]`**：与 `to` 二选一（同写 = 400）。折线点为绝对中心坐标；末点闭合语义（首点是否隐含 from）写进 schema description。曲线插值走 vendored GSAP + MotionPathPlugin（plan doc §3.1 第 4 条）；二次贝塞尔段用 `{x, y, cx, cy}` 控制点表达。点数上限随资源预算条款（§2.12），单设上限不做正确性约束 |
| 缺省 easing | `power2.out`（`timeline-builder.js:312`） | 显式化进 schema description，行为不变 |

#### 2.8.3 `scaleIn` / `rotate`

| 项 | v1 | v2 |
|---|---|---|
| `scaleIn` | `fromValue` 缺省 0 → `toValue` 缺省 1；`transformOrigin` 硬编码 `50% 50%`；缺省 easing `back.out`（`timeline-builder.js:314-319`） | 数值语义不变；`transformOrigin` 改读元素级静态字段（§2.4，缺省 50% 50% 保持零漂移）；`at` 必填 |
| `rotate` | `fromValue` 缺省 0 → `toValue` 缺省 360；`transformOrigin` 硬编码 50% 50%；缺省 easing `linear`（`timeline-builder.js:320-325`） | 同上。单位=度 |
| 参数校验 | `fromValue/toValue` 必须有限（`ir.go:472-476` 只查 From/To 点；标量未单独查——v2 补上标量有限性校验，属收紧不属语义变更） | 补齐 |

#### 2.8.4 `fadeIn` / `fadeOut`（窗口回退锚定删除，v2 全显式）

| 项 | v1（代码实况） | v2 |
|---|---|---|
| 补间 | autoAlpha fromTo、`immediateRender: false`、缺省 easing `power2.out`（`timeline-builder.js:364-375`） | **不变**（autoAlpha 的 visibility 副作用与 immediateRender:false 的确定性语义是实测教训的结晶，案例库 batch-6，原样保留） |
| 锚定 | **三级推断树** `fadeAnchorTime`（`timeline-builder.js:188-201`）：① 有词锚 → 词 start；② 无词锚 + 元素有窗 → fadeIn 锚窗口开帧、fadeOut **结束**在窗口关帧（`t = endFrame/fps − duration`，截到 ≥0）；③ 无词锚无窗 → 分发缺省 0 | **推断树整体删除**。`at` 必填（§2.8.1）；fadeIn/fadeOut 与其他动画同一条锚规则，builder 不再读所属元素窗口来猜意图 |
| scriptgen 契约变化 | `windowFades`（`scriptgen/window.go:241-257`）生成**无 startAnchor** 的 fade，靠 builder 窗口回退对位；首卡（窗口起 0）不发 fadeIn（锚 0 的 fromTo 会把 F0 压黑，`compose_test.go:52-53`） | `windowFades` 改为生成**显式帧值**：fadeIn `at={frame: sf}`；fadeOut `at={frame: ef − durationFrames}`（保持「结束在窗口关帧」的 v1 视觉语义）；首卡不发 fadeIn 的特判**保留**（F0 压黑病灶与锚无关，是 fromTo progress-0 语义）；折叠窗（ef−sf ≤ 1）双向不发**保留**（§3.2） |
| 与窗口 set 的正交 | 窗口管 visibility、fade 管 opacity，两轴正交（`timeline-builder.js:342-363`） | **不变**（红线级设计约束，写进 schema description） |

### 2.9 effect（五特效保留，`at` 语义同 §2.8.1）

| 项 | v1 | v2 |
|---|---|---|
| 类型集 | `pulse|counter|highlight|shake|fade`（`ir.go:20-26,221-224`）；新特效 = builder 函数 + 白名单 + params 校验三个扩展点 | **五特效保留**；扩展点机制不变（append-only 注册表） |
| 锚 | `anchor Anchor{text, occurrence}` **必填**（`ir.go:294-299`）；解析 reason=missing 时整条 skip（`timeline-builder.js:466`） | **`at: {frame}|{wordId}` 必填**，语义同 §2.8.1；无锚 = 写时 400。missing-skip 路径随文本锚退出文档契约而删除 |
| `targetElementId` | 可选；写时校验必须引用存在的元素 id（`ir.go:306-319`）；作用域：counter → host（固定 96px/700/z9999，target 命中时贴 bbox，`timeline-builder.js:579-599`）；highlight/fade 无 target → z10000 全画布 overlay（`timeline-builder.js:210-226,476-490`）；pulse/shake 无 target → `#canvas` 整层（X-4 裁定，`timeline-builder.js:120-139`） | **不变**（作用域语义是 X-4 实测裁定，非推断树，原样保留并写进 schema description） |
| `params` | 类型化校验（`validateEffectParams`，`ir.go:373-421`）：pulse.scale、counter.from/to/suffix/color、highlight.color、shake.intensity、fade.opacity，已知键 + 数值/字符串严格分型 | **不变**；schema 化后各特效 params 进 `ir.schema.json` 的 per-type 子 schema |
| highlight 词窗语义 | 文本 target 的着色窗口 = **词窗口**（词 start 起色 0.25s，词 end 前 0.6s 回落，`timeline-builder.js:264-281`；T-12/C01 验收语义） | `at={wordId}` 时**保留**（词 id 同时携带 start/end）；`at={frame}` 时窗口退化——处置见 §5 开放问题-6 |
| counter 补间 | `duration = min(1.2, max(0.3, durationSec − at))`，power1.out，round+suffix（`timeline-builder.js:237-246`） | 不变 |

### 2.10 audio.tracks[]（v1 voice/bgm 并入）

#### 2.10.1 v2 契约

```
ir.audio = { tracks: [ {
  assetKey:  string           // 必填，video/<workspace>/ storage key，写时校验登记行（对称 image src）
  kind:      "voice" | "bgm" | "sfx"   // 必填
  inSec:     number           // 必填（缺省 0）：轨内素材入点（秒，素材本地时钟）
  outSec:    number           // 必填（> inSec）：轨内素材出点（秒）
  volume:    number           // 必填显式（0-1）；不做隐式缺省（v1 缺省链教训见 §5 开放问题-8）
  fadeInSec: number           // 缺省 0；轨内音量淡入时长（秒）
  fadeOutSec:number           // 缺省 0；轨内音量淡出时长（秒）
} ] }
```

- **轨内事件帧锚定**：SFX 类触发点用 `at: {frame}`（全局帧钟）表达「与贴纸落点同帧」（plan doc §3.2）；事件锚的具体挂载形状（轨级 `at` vs 轨内 `events[]`）见 §5 开放问题-9。
- **混音链**：`MuxAV` 滤镜链按轨数生成 `amix=inputs=N:duration=first:normalize=0,apad` + `-shortest`（现实现 `platform/capx/encode.go:159-206` 为双输入硬编码；N 轨泛化是 P1-1 落地项）；响度链不变（normalize=0 保声明增益）。
- **写时校验**：每个 `assetKey` 必须有登记行（fail-closed 对称 image src 的 validateAssetRefs；v1 音频侧已有同型门——MCP `video_set_audio` 挂载前查登记，`adapters/mcp/tools.go:331-334`）。

#### 2.10.2 v1 → tracks 迁移规则

| v1 字段 | v1 实况 | 迁移到 tracks |
|---|---|---|
| `audio.voice.{key,durationSec,volume}` | `AudioTrack`（`ir.go:160-165`）；校验 key 必须 `video/` 前缀非 URL、volume 0–1（`ir.go:519-542`）；voice 时长必须覆盖末词 end（audit C5，`ir.go:328-336`） | `{assetKey: key, kind: "voice", inSec: 0, outSec: durationSec, volume: <显式>, fadeInSec: 0, fadeOutSec: 0}` |
| `audio.bgm.{key,volume}` | 同上；渲染端 bgmVolume 缺省 1.0 但被 IR 值无条件覆盖（`render_pipeline.go:153-156`） | `{assetKey: key, kind: "bgm", ...}` 同构 |
| `audio.voice/bgm` 双轨上限 | `amix=inputs=2` 硬编码（`encode.go:173`） | tracks 无轨数上限（受 §2.12 IR 字节预算约束）；混音链 N 轨化 |
| voice 时长护轨 | `voice.durationSec >= 末词 end`（`ir.go:328-336`） | 迁移为 `kind=voice` 轨上的同一规则（输入从 `audio.voice.durationSec` 改为该轨 `outSec`）；`DurationFrames` 的 voice 扩展输入同步（§5 开放问题-7） |

### 2.11 scene 元素类型（§3.5 引擎即渲染器）

| 项 | 契约 |
|---|---|
| 形状 | `elements[]` 新增 `type: "scene"`：`{id, type, x?, y?, w, h, z, params: {renderer: string, timeline: object}}`。`renderer` 是**版本化字符串**（如 `"toolsite-editor@<version>"`，plan doc §3.5 第 1 条）；`timeline` 是**产品自有 schema** 的 JSON 对象——框架不解释其内容 |
| 注册回调 | 渲染器是**产品注册的回调模块**（tool-site 的引擎打包成单文件玩家 + 暴露 `seek(t)`，plan doc §3.5 第 2 条）；框架只持契约：播放器外壳把该元素的绘制委托给注册表中 `renderer` 串命中的模块；未注册 = fail-closed（渲染中止，根因写 `__player.error`，与图片 decode 同型）。**注册发生在产品侧，不进 example**（引擎代码不进框架，plan doc §3.5 第 6 条——落地前提是视频域移植 tool-site） |
| seek 纯函数约束 | **scene 状态由 t 唯一确定；禁 wall-clock / rAF 驱动画面**。约束写进 schema description 与渲染器注册协议：渲染器模块必须实现 `seek(t)` 且在任意 seek 序下逐帧可复现（旧管线 `__renderFrame(t)` 已符合——约束是确认现状，plan doc §3.5 第 3 条）。违例检出方式=探针环双 seek 对比（§3.4 Probe），非运行时沙箱 |
| 分层合成 | 引擎 canvas（z0，scene 元素）+ IR v2 声明层（字效/字幕/计数徽章，z10+）：一个 IR、一个时钟、一套音频混音；声明层与引擎层互不越界（plan doc §3.5 第 4 条） |
| 时钟 | scene 的 `t` 与全局帧钟同源：`t = frame / fps`（seek 网格，`timeline-builder.js:500-504` 同款）；scene 不引入第二条时间轴 |
| 版本溯源 | 渲染器版本进 recipe：引擎代码 hash 入 provenance；引擎变更 → goldens 重录（plan doc §3.5 第 5 条） |
| 与元素窗口的关系 | scene 元素同样受 `startFrame/endFrame` 窗口约束（visibility 轴由窗口 set 持有，正交设计不变）；`timeline` 内部时轴是产品自有语义，由渲染器自行映射到 `seek(t)` |
| 校验 | 写时：`params.renderer` 非空字符串；`params.timeline` 必须是 JSON object。**产品自有 schema 的深校验**（timeline 内容合法性）走产品注册的校验回调——缝的具体设计见 §5 开放问题-10 |

### 2.12 资源预算（正确性约束与性能建议值分离）

| 预算 | v1 | v2 |
|---|---|---|
| IR 总字节 | `MaxIRBytes = 256KiB`，marshal 后实检（`ir.go:216,337-343`） | **不变（正确性约束保留）** |
| 元素计数 | `MaxElements`：v1=64 → 工作树未提交热修 **128**（`ir.go:211-214`，注明「真正的资源闸门是 IR 总量与单图尺寸上限，元素数只是粗代理」）；超限 400（`ir.go:304-306`） | **废除计数闸门（正确性约束）**。该常量与校验分支随 v2 删除；热修值 128 是过渡措施不进 v2 契约。保留 **256 作为性能建议值**写进 schema description（`suggestedMaxElements: 256`），文档标注**非正确性约束**——超它不报错，只应在创作工具里提示 |
| 解码资产总字节预算 | 无 | **新增**：全部 image src 解码后字节总和 ≤ 预算值（写时无法精确得解码尺寸，首版按**编码字节总和**近似 + 渲染端 fail-closed 兜底；精确像素预算见下行）。**数值未定**（plan doc 未给数），见 §5 开放问题-11 |
| 像素预算 | 无 | **新增**：`Σ (w_i × h_i)`（元素框面积和）或解码像素总量 ≤ 预算值，约束单帧合成层面积。**数值未定**，见 §5 开放问题-11 |
| 其余计数上限 | `MaxScriptChars 5000 / MaxWords 2000 / MaxEffects 128 / MaxAnimationsPerElement 16`（`ir.go:206-217`） | **保留不变**（这些不是「资源代理」而是域语义上限；case library §5.17 复杂度分级的预算表随 64→∞ 修订元素行） |
| 时长上限 | `MaxRenderDurationSec = 600`（`service.go:185`） | 不变 |

### 2.13 blend（元素级混合模式）

| 项 | v1 | v2 |
|---|---|---|
| 元素级 | 无（调色/颗粒/光晕只能烘死在底图，plan doc §3.1 第 6 条） | **新增 `elements[].mixBlendMode`**：CSS 原生值；缺省 `normal`（存量零漂移）。取值白名单 vs 全量透传见 §5 开放问题-12 |
| 画布隔离 | `#canvas { position: absolute; inset: 0; }` 无隔离（`projector.go:329`）——元素若用混合模式会与画布外背景（`#stage` 的 #000）发生非预期混合 | **`#canvas` 加 `isolation: isolate`**：把混合限制在画布内（plan doc §3.1 第 6 条）。Chrome 渲染确定性与既有管线等同 |
| 与 z/overlay 的关系 | counter 9999 / X-4 overlay 10000 的栈序语义 | 不变；blend 只改混合不改栈序 |

### 2.14 v2 写时校验变更汇总（相对 v1 `Validate`）

| # | 变更 | 类型 |
|---|---|---|
| 1 | `schemaVersion != 2` → 400；`normalizeSchema` 删除 | 破坏性（有意） |
| 2 | 每个 `element.animations[].at` 与 `effects[].at` 必填；`{frame}` 域 `[0, F-1]`；`{wordId}` 必须命中 `words[].id` | 收紧（v1 静默 t=0 / missing-skill 变硬错误） |
| 3 | `move`：`to` 或 `path` 二选一必填 | 收紧 |
| 4 | 元素计数上限删除；`suggestedMaxElements=256` 移入 schema description（非约束） | 放松 |
| 5 | `audio.tracks[]`：每轨 assetKey 登记行校验 + kind 白名单 + `outSec > inSec` + volume 显式 0–1 + fadeIn/fadeOutSec ≥ 0；voice 护轨与 `DurationFrames` voice 扩展改 tracks 派生 | 收紧 + 重构 |
| 6 | 新增字段校验：`rotation` 有限、`flipX` 布尔、`opacity ∈ [0,1]`、`mixBlendMode` 取值域、`lineHeight > 0`、`letterSpacing ≥ 0`（有限）、`font.assetKey` 登记行、`font.weight ∈ [100,900]`（可变轴范围，`projector.go:117-122`） | 新增 |
| 7 | `scene`：`params.renderer` 非空 + `params.timeline` 是 object + renderer 在注册表（产品侧回调；example 内缺省拒绝，见 §5 开放问题-10） | 新增 |
| 8 | `scaleIn`/`rotate` 的 `fromValue/toValue` 有限性校验补齐 | 补漏 |
| 9 | 保留：fps 白名单、画幅 360–2160、时长 (0,600]、words 单调不重叠、script 5000 rune、effects 128、animations 16/元素、IR ≤256KiB、src storage-key 规则、窗口三规则（非负/有序/封顶）、effect targetElementId 引用、params 严格分型 | 不变 |

---

## 3. builder 简化清单（推断上移）

### 3.1 删除项（timeline-builder.js）

| 函数/路径 | 位置 | v1 行为 | v2 处置 |
|---|---|---|---|
| `fadeAnchorTime` 三级推断树 | `timeline-builder.js:188-201` | 词锚 → 窗口回退（fadeIn 锚窗开帧 / fadeOut 结束在窗关帧）→ 分发缺省 0 | **整体删除**。fadeIn/fadeOut 直读 `at`，与其他动画同一分发路径 |
| 动画分发的静默 t=0 回退 | `timeline-builder.js:453`（`resolvedFrom.wordIndex >= 0 ? anchorTime(...) : 0`） | 无 `resolvedFrom` 即锚 0 | **删除**。`at` 是必填字段，缺省即写时 400，分发层无需回退 |
| `elementRecordOf` 的 fade 专用消费 | `timeline-builder.js:171-177`（供 `fadeAnchorTime` 读所属元素窗口） | 窗口回退的数据源 | 随 `fadeAnchorTime` 删除（窗口仍由 window set 消费，属 `build()` 主循环，不受影响） |
| `anchorTime`/`wordEndTime` 的推断角色 | `timeline-builder.js:106-118` | `resolvedFrom.wordIndex → words[i].start`（miss 返 0） | `wordEndTime`（highlight 词窗）保留；`anchorTime` 退化为 `{wordId} → words[i].start` 的**显式查表**（契约查询，不是推断），miss 不可能（写时已校验） |

### 3.2 scriptgen 改写（推断上移的落点：组装时已知卡片窗口）

| 函数 | 位置 | v1 行为 | v2 改写 |
|---|---|---|---|
| `computeWindows` | `scriptgen/window.go:29-88` | 算出每卡 `[startFrame, endFrame]`（含首含尾、相邻共享交界帧、`minCardSeconds=1.5` 保底），写入元素窗口 | **保持不变**——它本来就是「组装时已知窗口」的那个组件；v2 只是让动画锚也从它的输出取值，不再把对位责任留给 builder |
| `windowFades` | `scriptgen/window.go:241-257` | 生成无 `startAnchor` 的 fadeIn/fadeOut（`fadeFrames=12`），靠 builder 窗口回退对位；首卡不发 fadeIn；折叠窗双向不发 | **生成显式帧值**：fadeIn `at={frame: sf}`；fadeOut `at={frame: ef − fadeFrames}`（保持「结束在窗关帧」）；首卡不发 fadeIn 与折叠窗不发两个特判**保留**（病灶与锚机制无关：F0 压黑是 fromTo progress-0 语义，`compose_test.go:52-53,171-173`） |
| `Compose` 的 keywords 高亮 | `scriptgen/compose.go:104-113` | `Effect{Anchor: ka.Anchor, TargetElementID: ...}` + 收尾 `ResolveAll` 落 `resolvedFrom`（`compose.go:114`） | 锚在组装期解析为 `at`（词表在手，`frame = ceil(word.start × fps)`）；`ResolveAll` 从组装收尾链删除（或降级为作者工具，见 §3.3） |
| `durationFramesOf` | `scriptgen/compose.go:124-132` | 与 `DurationFrames` 同口径的本地 ceil | 不变（组装期显式帧值的生成基数） |

### 3.3 写时工具化（ir.go / service.go）

| 函数 | 位置 | v1 行为 | v2 处置 |
|---|---|---|---|
| `ResolveAnchors` / `anchorCandidates` | `ir.go:566-649` | 文本锚四步解析（exact > same_text > nearest > missing），供 `ResolveAll` 落 `resolvedFrom` | **降级为作者侧写时工具**：作者（agent/MCP）提交 `text+occurrence` 意图时，服务端解析并 lower 成显式 `at` 后落盘；解析失败（missing）= 拒绝写入（v1 是照实标注不判 fail——v2 收紧为 400，与「无锚=校验错误」同一条红线）。是否保留运行时解析面（`ResolveAll` 导出与 inspect 漂移视图）见 §5 开放问题-5 |
| `ResolvedFrom` / `PrevWordIndexes` | `ir.go:80-83,706-724` | 锚解析审计回写 | 随文档契约退出；作者工具的解析结果只存在于工具响应，不持久化进 IR（除非开放问题-5 裁定保留审计字段） |
| `Validate` 新增项 | — | 见 §2.14 清单 | 「无锚=400」的实现落点 |

### 3.4 builder 保持不变的（防误删清单）

- 窗口 set 的半帧 ε（visible `tStart+1/(2fps)`、hide `tEnd+1/(2fps)`、折叠窗 `tStart+1/fps`）与 `startFrame=0` 常挂载特判（`timeline-builder.js:409-432`）——红线。
- autoAlpha + `immediateRender:false`（`timeline-builder.js:364-375`）——实测教训。
- X-4 目标分发（counter host / highlight·fade overlay / pulse·shake → #canvas）与 z 9999/10000（`timeline-builder.js:457-494,579-599`）——实测裁定，非推断。
- 图片 decode fail-closed 与 ready 门（`timeline-builder.js:433-446,519-525`）——红线。
- `frameTime`、seek 网格 `f/fps`、`Math.ceil` 帧数（`timeline-builder.js:43,103,500-504`）——红线时钟。

---

## 4. v1 → v2 迁移

### 4.1 逐字段迁移表

| v1 字段 | v2 字段 | 换算规则 | 备注 |
|---|---|---|---|
| `schemaVersion: 1` | `schemaVersion: 2` | 直改 | 读路径拒 1 |
| `meta.*` | 同名 | 无换算 | 时钟公式不变 |
| `words[]`（无 id） | `words[]` + `id` | 迁移器按 `w<index>` 补 id | 仅当文档里存在 `{wordId}` 锚时严格必要；全显式帧迁移可暂缓 id 化（§4.2 按消费者区分） |
| `effects[].anchor{text,occurrence}` + `resolvedFrom` | `effects[].at` | 用已落盘的 `resolvedFrom.wordIndex` 取 `words[i].start`，`at={frame: ceil(start×fps)}`（或 `at={wordId}` 若该词 id 化） | `resolvedFrom` 缺失的 effect（未跑过 ResolveAll 的手写 IR）：迁移器现场跑一次文本锚解析；missing → 迁移失败人工介入 |
| `effects[].targetElementId/params/type/id` | 同名 | 无换算 | X-4 作用域语义不变 |
| `elements[].x/y/w/h/z` | 同名 | 无换算 | 角点原点保留（开放问题-3） |
| `elements[].startFrame/endFrame` | 同名 | 无换算 | 含尾语义不变 |
| `elements[].animations[].startAnchor` + `resolvedFrom` | `animations[].at` | 同 effect 行 | pilot 的 63 个已锚动画由此换算 |
| 无锚 `fadeIn`（等窗回退） | `at={frame: startFrame}` | 读所属元素窗口 | pilot 33 个 fadeIn |
| 无锚 `fadeOut`（等窗回退） | `at={frame: endFrame − durationFrames}` | 读所属元素窗口；结果 <0 时夹 0 并告警（v1 `fadeAnchorTime` 同款夹取，`timeline-builder.js:199-200`） | pilot 7 个 fadeOut |
| `move.from/to`（绝对左上角） | `move.from/to`（绝对中心） | `+ (w/2, h/2)`（§2.8.2 换算公式，精确） | pilot 30 个 move 全部带 from+to（实测统计） |
| `scaleIn/rotate.fromValue/toValue/easing/durationFrames` | 同名 | 无换算 | pilot 32 scaleIn + 1 rotate |
| `audio.voice` | `tracks[kind=voice]` | §2.10.2 映射 | volume 必须显式化（v1 缺省链不一致，见开放问题-8；迁移器对 `volume` 缺失的轨**不猜**，报错列出待人工确认——或按消费者情况定缺省，见 §4.3 各行动作） |
| `audio.bgm` | `tracks[kind=bgm]` | §2.10.2 映射 | 同上 |
| （新增，无 v1 对应） | `rotation/flipX/opacity/transformOrigin/mixBlendMode/font/stroke/shadow/letterSpacing/lineHeight` | 缺省值补齐即零漂移（§2.4/2.6/2.13） | 迁移器可全部省略（schema 缺省=缺字段），不必写出 |
| （新增，无 v1 对应） | `type:"scene"` | — | 三存量消费者均无 scene |

### 4.2 存量消费者迁移动作

| # | 消费者 | 实况（本次核查） | 迁移动作 |
|---|---|---|---|
| 1 | **9 案例 fixture**：`example/internal/video/testdata/ir/c01–c09.degraded.json`（c01 词表内嵌于 `testdata/l1_render_test.go`）+ 配套 `.frames.json` 帧表 + `testdata/golden/c01–c09` golden 帧；消费方 `l1/l2/l3/golden/consistency` 各 `*_test.go`（capx tag） | c03 抽查：audio voice(45s, vol 1.0)+bgm(46s, vol 0.18) 双轨齐全；15 元素 13 个带窗口；动画 scaleIn×10 + move×2（11/12 有词锚） | ① 写一次性迁移器（§4.1 规则，建议放 `testdata/` 随迁移提交后删除）转换 9 份 fixture；② 帧表**不重推**——时钟与窗口语义是红线，词锚推导帧按 §7.0 算式不变；③ golden 是否重录取决于迁移后 L1 像素比对（§7.0 阈值 MAE ≤ 2/255）：若 fade `at` 换算与 move 中心换算精确，预期逐像素相等、golden 保留；实测若有帧级漂移按阈值裁定重录并记录根因；④ C01 的「all anims from t=0」降级夹具（案例库 §3.1.5 口径）迁为显式 `at={frame:0}` |
| 2 | **shuijing promo**：`testdata/shuijing-gen.go`（`go:build ignore` 生成器，手算圆周布局 + 显式 StartFrame/EndFrame）+ `testdata/shuijing_l3_test.go` | 30s 1080×1920@30（900 帧）；珠子=透明 webp image 元素；生成器自带 IR struct（不走 videoapp struct） | 生成器改输出 v2 字段（at 显式、tracks、move 若有则中心化）后 `go run` 重生成；L3 断言随迁。生成器的独立 IR struct 正好说明 v1 契约未自描述——v2 后建议生成器直接消费 `videoapp` 类型 + schema |
| 3 | **tool-site pilot**：`D:\code\tool-site\.runtime\videos\studio-pilot\ir.json`（66 元素全 image、33 manual 词、0 effects、动画 103 个：move×30 全带 from+to、scaleIn×32、rotate×1 有 startAnchor，fadeIn×33 + fadeOut×7 **全部无锚等窗回退**；441 帧）+ `example/internal/video/testdata/toolsite_assembly_test.go`（capx tag；资产缺失即 skip；断言 441 帧 + ResolveAll 无 missing）+ tool-site 侧生成器 `web/scripts/build-studio-ir.mjs` | schemaVersion 1；`words.source` 全 manual（假锚词） | ① `build-studio-ir.mjs` 改输出 v2：33 个假锚词删除、103 个动画全部显式 `at={frame}`（63 个已锚动画按 `ceil(word.start×30)` 换算、40 个 fade 按窗口回退公式显式化）、30 个 move 中心化；② `toolsite_assembly_test.go`：441 帧断言不变；`ResolveAll` 无 missing 断言随文本锚退出而改形（无词表则该断言删除）；③ 该测试按 plan doc §6 改造为 v2 迁移后的**回归基线**（v4-assembly 重跑验收：零假锚词、零手写烘焙） |
| — | **联动改动（非 IR 文档本身）**：MCP `video_set_audio`（`adapters/mcp/tools.go:312-334`）与 compose 类工具的 `voice_key/bgm_key/voice_volume/bgm_volume` 入参 → `tracks[]` 形状；服务层 TTS 装配 `service.go:997`（voice 无 Volume 落盘）；inspect/审计视图的 audio 显示（`tools.go:782-788`） | | 随 P1-1 批次落地；接口形状见 §5 开放问题-15 |

---

## 5. 开放问题（写作中发现，如实记录，未裁决）

以下每条都是「方案文档与代码实况冲突」或「方案未覆盖的决策点」；本文只在契约表里给出**建议稿**并在行内标注，最终裁决在实现评审时做出。

1. **ir.go 自身的窗口语义注释自相矛盾（代码-代码冲突）**：`validateElement` 的边界注释写「window is half-open [startFrame, endFrame) — the hide set lands exactly at endFrame」（`ir.go:503-508`），而 `Element` struct 注释、builder 实现（hide set 落 `tEnd + 1/(2fps)`，`timeline-builder.js:424-426`）、案例库 §7.0 实测口径三者一致为**含尾 `[startFrame+1, endFrame]`**。校验函数注释是陈旧表述（不影响校验行为：`endFrame == F` 合法这条边界两种口径恰好一致）。v2 schema 按含尾口径书写；**实现时需顺手修正 `ir.go:503-508` 注释**（本文不代改代码）。
2. **「坐标投影期钳制」注释与实况不符（注释-代码冲突）**：`ir.go:470-471` 与 `service.go:1211` 两处注释声称「coordinates clamp to the canvas at projection time」，但 `projector.go:elementMap`（`projector.go:246-310`）逐字段透传、builder 无任何钳制、`Validate` 只查有限性——**不存在钳制代码**。实际行为：越界坐标原样渲染，越界部分被 `#stage` 的 `overflow: hidden`（`projector.go:326`）视觉裁切。v2 schema 按「不钳制、overflow hidden 视觉裁切」如实描述；注释修正随实现批处理。
   **2b. 「未知元素类型读时跳过」同样是注释超前于实现**：`ir.go:28-29` 与 `timeline-builder.js:386-387` 都声明 unknown element types 被跳过并告警，但 builder 实况是 `buildClipDOM` 的 else 分支把任何非 image/text 类型当 shape 渲染（空 div，无告警，`timeline-builder.js:50-65`）；真正带告警跳过的是未知动画类型（`timeline-builder.js:449-452`）与未知特效类型（`timeline-builder.js:462-463`）。这对 v2 的 `scene` 类型有直接含义：v2 无双读所以 v1 builder 不会见到 scene，但 v2 落地时「未知类型」的读时行为必须**要么真正实现跳过+告警、要么在 schema 里如实写成「落 shape 分支」**——两处陈旧注释不得原样带进 v2 契约。
3. **move 中心坐标与元素 x/y 角点原点并存**：plan doc §3.1 第 4 条只定了 move 端点为绝对中心；`element.x/y` v1 是框左上角（`timeline-builder.js:68-69`）且本文按「不变」契约化。同一份 IR 里两种原点参照并存，schema description 必须把两者都写死并在 move 字段旁显式标注差异，否则 A5 类事故只是换个字段复发。**未决**：x/y 是否应一并改中心（更彻底但破坏面大——9 案例全部 x/y 都要换算，且模板域 SafeMargin 几何、counter bbox 贴位全在角点语义上）。
4. **`{wordId}` 的落盘形态**：写时校验后 IR 里保留词引用（脚本编辑存活，但渲染端依赖 words 表在场且 id 稳定）还是规范化为显式帧（builder 更笨，但脚本一改全片锚点漂移）？plan doc §3.1 第 1 条「words 回归本义 + 显式帧值」两处表述分别指向两边。**未决**；本文契约表按「二选一待裁」标注。另 `words[].id` 的生成规则（TTS/对齐摄取时生成？id 格式？词表重排后 id 是否稳定？）未定义（案例库 P2-4 只提案了字段名）。
5. **文本锚工具与 `resolvedFrom` 审计的归宿**：`ResolveAnchors` 四步解析（`ir.go:604-649`）v1 是运行时契约的一部分；v2 降级为写时工具后，inspect 的锚漂移视图（`AnchorResolution`/`PrevWordIndexes`，`ir.go:548-556,706-724`）是否保留、`resolvedFrom` 是否作为**只读审计字段**随行（不参与渲染），未决。保留的好处是脚本编辑后漂移可见；代价是文档里存在「渲染不读」的字段（违反「IR 自描述且皆有效」精神）。
6. **highlight 的词窗语义在 `at={frame}` 下退化**：highlight 文本着色窗口 = 词 start→end（T-12/C01 验收语义，`timeline-builder.js:264-281`）；`at={frame}` 只有单点。可选裁决：a) highlight 强制要求 `{wordId}`（类型级约束）；b) `at={frame}` 时退回 0.25s/0.5s flash 节奏。**未决**（倾向 a，与「特效的词本性」一致，但要在 schema 里写成条件必填）。
7. **`DurationFrames` 的 voice 扩展输入在 tracks 模型下的派生**：v1 单源公式吃 `audio.voice.durationSec`（`service.go:1392-1395`）；v2 多轨后取哪个值——`kind=voice` 轨的 max `outSec`？全部轨的 max？**未决**。直接影响窗口封顶校验（`ir.go:500-515`）与 JS 侧对齐（`timeline-builder.js:36-43`），必须与 §2.1 同批裁决。
8. **v1 音频 volume 缺省链不一致（实况冲突记录）→ 【已修 2026-11-17】**：服务层 TTS 装配落盘 voice 时不设 Volume（`service.go:997`，Go 零值 0.0）；渲染端直读 IR 值且无条件覆盖缺省 1.0（`render_pipeline.go:142`）；MCP `video_set_audio` 把未传的 `voice_volume` 原样落盘为 0（`tools.go:323`）而其 schema 文档自称「default 1」（`tools.go:1334`）。照此链路，未显式传 volume 的 voice 轨按 ffmpeg `volume=0` 静音——**确认为在线 bug（P1：静默无声出片）**。
   **v1 修复已落地（2026-11-17，独立于 v2）**：新增 `videoapp.ResolveAudioVolumes` 作为混音侧增益单一真源——`AudioTrack.Volume` 带 `omitempty`，JSON 无法区分「显式 0」与「缺省」，故 0 一律解析为默认 1.0（v1 不支持真静音，与 `tools.go` 的 "default 1" 承诺一致）；`render_pipeline.go` 改调该函数；TTS 写盘路径保持不设 Volume（语义由求值函数兜住，并加注释说明）；MCP 两处 volume 的 schema 描述改为 "omit or 0 = default 1.0; a true mute is not expressible in v1"。回归测试 `ir_audio_volume_test.go`（6 条，含 omitempty 往返钉死该限制）。**v2 仍按 §2.10.1 把 volume 定为必填显式字段**（届时真静音可表达），迁移器仍不猜存量值。
9. **SFX 事件锚的挂载形状**：plan doc §3.2 说「轨内事件可 `at:{frame}` 锚定」，但 tracks[] 的字段表里没有 `at`——是一轨一事件（SFX 轨天然短，`inSec/outSec` 即表达落点+时长，无需 `at`），还是 `tracks[].events[]` 子结构（一轨多事件）？**未决**；本文按「一轨一事件、`at` 不进轨字段」的保守读法写，待 P1-1 批次定稿。
10. **scene 的产品校验回调缝**：`params.timeline` 是产品自有 schema，Go 侧 `Validate` 无法内置其规则。需要定义注册协议里的校验回调位（产品注册 `{renderer, renderModule, validateFunc, schema}` 四元组？），以及 example 内无产品注册时的行为（本 spec 按 fail-closed 拒绝写，§2.14-7）。且 scene 落地前提是视频域移植 tool-site（plan doc §3.5 第 6 条 route (b)），**在 example 里先注册一个引擎渲染器违反产品/框架边界**——scene 字段进 schema 但注册表保持空是预期落地形态，未决点是注册协议的具体接口签名。
11. **资源预算数值未定**：解码资产总字节预算与像素预算 plan doc 未给数（§3.1 第 8 条只有预算项名称）。可参照的实测定标输入：pilot 66 元素全 data URI 内联（`toolsite_assembly_test.go:75` 记录了投影 HTML 字节数）、单图尺寸上限现状（「真正的资源闸门是 IR 总量与单图尺寸上限」，`ir.go:211-214`）。另外「解码字节」写时不可得，预算以编码字节近似还是渲染端 fail-closed 兜底，未决。**同族未决**：`transformOrigin` 的值文法（§2.4）、`mixBlendMode` 白名单 vs 透传（§2.13）——建议都按「缺省零漂移 + 白名单先行」保守落。
12. **flipY 缺席**：v2 只定 `flipX`（plan doc §3.1 第 3 条原文）。`flipY` 可由 `flipX + rotation:180` 推导（复合顺序实现时钉死），是否需要独立字段未决（倾向不设，推导路径写进 schema description）。
13. **objectFit 不设开关的复查点**：本文按 plan doc §5「不做开关」立场把 contain 定为唯一语义（§2.5）；案例库多行「contain 留白为近似」（§6 汇总行）说明内容侧有 cover 诉求的苗头（P2-7 提案含 `objectFit` 键）。若 v4-assembly 重跑验收时再次撞上裁切类降级，此项应重新上会而不是硬扛——记录为知情复查点。
14. **`font.assetKey` 的存储域**：复用 `video/<workspace>/` 前缀还是独立 `font/` 域（影响 storagex 登记行、配额、CSP 无关仅写时校验），未决（plan doc §3.3 第 1 条只写了「上传 woff2 → 内容寻址」）。
15. **MCP/服务层接口形状**：`voice_key/bgm_key` 双布尔槽（`tools.go:322-327`）映射到 `tracks[]` 的工具入参形状（`set_tracks[]` 直通？保留 voice/bgm 快捷槽 lower 成轨？）、compose 类工具的音效入参（plan doc P1-1 的 SFX 帧）、inspect 的 audio 视图（`tools.go:782-788`），随 P1-1 定稿，本文不预支接口。

---

## 6. 与源纲的对照索引（写作完备性自检）

| plan doc 条目 | 本文落点 |
|---|---|
| §3.1-1 时间第一类 / 无锚=校验错误 | §2.8.1、§2.14-2、§3.1 |
| §3.1-2 推断上移 / 窗口语义进 schema | §3 全节、§2.3 窗口行 |
| §3.1-3 静态变换 | §2.4 |
| §3.1-4 move 中心坐标 + path | §2.8.2 |
| §3.1-5 文本样式 + 字体资产 | §2.6、开放问题-14 |
| §3.1-6 blend | §2.13 |
| §3.2 audio.tracks | §2.10、开放问题-7/8/9 |
| §3.1-7/§3.1-8 预算替代计数闸门 | §2.12、开放问题-11 |
| §3.1-9 JSON Schema 落盘 | §2.0、§1.1 |
| §3.5 scene 元素 | §2.11、开放问题-10 |
| §5 不做清单 | §1.3 |
| §6 落地顺序 | 本文是 P0-1 的契约输入；批次划分照抄 plan doc §6 不重复 |
