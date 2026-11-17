# Video Studio IR v2 与烘焙层重构方案——v4-assembly 复刻试点复盘驱动

> 日期：2026-11-17
> 状态：**已批准（2026-11-17）**——本文驱动的文档重构已交付（6 改 3 新文档 + 契约 spec，见 `delivery-audit-video-studio-docs-refactor-2026-11-17.md`）；契约逐字段展开见 `plan-video-studio-ir-v2-spec-2026-11-17.md`。由 tool-site「托盘飞入」旗舰样片复刻试点的一手失败/成功记录驱动（试点报告见 tool-site 会话与 `.runtime/videos/studio-pilot/`）
> 立场：**不做兼容层**。schemaVersion 2 一次性迁移存量（9 个案例 fixture + shuijing + pilot），builder 不保留 v1 推断路径。

---

## 0. 试点一句话结论与本文要回答的问题

复刻成功：66 元素 IR、441 帧@30fps 真渲染出片，30 件贴纸逐件对齐原片。但过程付出了 **6 轮全渲染（每轮 ~3min）+ 5 轮资产重烘 + 3 轮像素算法修正 + 3 轮环境考古**。本文回答：时间耗在哪、哪些是框架的结构性欠账、干净的重构方案是什么。

---

## 1. 事故台账（全部真实发生，按根因归类）

| # | 事故 | 代价 | 根因归类 |
|---|---|---|---|
| A1 | 源码字符串手术三连坏：切片含 `import.meta`、evaluate 包装不调函数、`const page` 遮蔽 | 3 轮小修 | R1 缺烘焙层（自建管线脆弱） |
| A2 | `putImageData` 忘写 → 30 张空 PNG | 1 轮 | R1 + R4 无廉价验证环 |
| A3 | 差分 alpha 鬼影：中对比度像素被赋半透明 | 1 重烘+1 重渲 | R1（matte 手工实现） |
| A4 | 浅色地毯低对比区被抠穿 | 1 轮 | R1 |
| A5 | **move 中心坐标 vs 绝对左上角** → 30 件全体右下偏移半幅 | 1 全渲 + 1 自建 DOM dump | R2 语义在实现不在契约 |
| A6 | 无锚 move/scaleIn 静默塌缩 t=0 | 靠文档考古避开（33 个假词绕行） | R2 |
| A7 | 勾格窗口倒挂 startFrame>endFrame | 验证器拦截，0 渲染代价 | （验证器干得好，非事故） |
| A8 | 托盘页烘焙时刻落在翻页 0.26s 滑动窗口内 → 两页叠印进资产 | 1 重烘+1 重渲 | R3 时态瞬态被烘进资产 |
| A9 | 壳图漂移：模板壳 11-16 被升级成装饰版；`assets/` 与 `web/public/` 双真源；renderer 优先加载 shell-1448 | 3 轮（git 考古 + 双目录手术） | R3 资产无内容寻址/钉版 |
| A10 | MaxElements=64 硬上限，本案 66 必超 | 框架热补丁 | R5 上限当资源闸门 |
| A11 | Baloo 字效、托盘活计数、呼吸光晕、贝塞尔弧线、逐件 SFX 全部无法表达 → 预烘焙或放弃 | 前期设计的主要工作量 | R0 表达面错位 |
| A12 | 每次验证=3min 全渲；go test 对模块外 ir.json 缓存 | ~15min 纯等待 | R4 反馈环缺失 |

**耗时归因（估算）**：前期调研 ~25%、烘焙基建与迭代 ~35%、语义类 debug ~15%、环境/资产考古 ~15%、收尾验证与报告 ~10%。其中约七成消耗可直接归到下面五个结构性根因；约三成是首航固有成本与作者（agent）自身流程问题（先全渲后探针的顺序错误）。

---

## 2. 五个结构性根因

### R0：IR 表达面与内容类型错位（总根因）

Video Studio IR 为「剧本驱动的卡片视频」设计：词锚、6 版式模板、text/shape/image 三元素。旗舰内容是「引擎场景编排」：游戏引擎位姿、程序化托盘、活计数、逐件音效。错位的必然结果——丰富内容必须在系统外预烘焙成像素，IR 退化为「烘焙 PNG 的排序器」。试点 66 元素里 63 个是 image 不是巧合；字效/计数/光晕/弧线/SFX 六类降级全部同源。

### R1：烘焙是每项目一次性手工作坊

试点为提取资产写了 ~500 行脆弱脚本（源码提取、注入导出口、差分洪泛 matting、已知色解阴影）。这些像素操作（差分 matte、洪泛填充、已知色 unmix）是**通用、可单测、可复用**的库级能力，却每次都要重发明。且烘焙消费「活的产品资产」，无契约保证采样时刻是稳态（A8）。

### R2：语义真相在实现代码里，不在契约里

move 的坐标系（绝对左上角）、无锚=t=0、窗口含尾+半帧 epsilon、transform-origin=50%、object-fit=contain——全部住在 timeline-builder.js 注释与案例库考古文档里。IR JSON 不自描述，作者（agent 或人）无法从契约推出行为，每个陷阱的发现成本=一次全渲或一次自建 DOM dump。fadeAnchorTime 的三级推断树（词锚→窗口→t=0）是最集中的体现：**builder 在猜作者意图**。

### R3：资产与环境不可钉

出片复现依赖：模板壳版本（会升级）、布局 JSON（会改）、引擎代码（会动）、资产目录（双真源 + 1448 优先回退链）。无内容寻址 → 复现历史出片=git 考古+目录手术（A9）。BakeJob 没有溯源清单，「这次出片用了哪一版壳」这个问题系统回答不了。

### R4：反馈环缺失

作者环只有「提交→3 分钟全渲→肉眼看」。capx 内部早有 seekTimeline（任意帧秒级），但没有包装成 video 域的一等探针工具（MCP 有 preview_frames，harness 路径没有）；golden 帧断言、DOM 状态 dump、逐元素 transform 校验都是作者临时自建。验证顺序也因此失控（先全渲后探针）。

### R5：元素数上限当资源闸门

64 元素在拼贴类合成第一天就撞墙。真正要守的是字节/像素预算，元素数只是粗代理。

---

## 3. 干净方案：四层重构

总纲一句话：**把试点里手工做的一切变成框架的正式能力——契约层（IR v2）、烘焙层（内容寻址+溯源）、音频层（多轨+事件锚）、反馈层（秒级探针环）。**

### 3.1 IR v2（契约重构，消灭 R2/R5，覆盖 R0 的时轴半边）

**schemaVersion: 2，一次性迁移，不留 v1 双读。**

1. **时间第一类**：每个动画必带 `at`，取值 `{frame: N}` 或 `{wordId}`——同一时钟，无锚=**校验错误**（不是静默 t=0）。消灭 33 个假锚词的 hack 路径；words 回归其本义（字幕/脚本对齐），manual words 仍合法但不再承担动画时锚职责。
2. **推断上移，builder 变笨**：scriptgen 组装时**生成显式帧值**（它知道卡片窗口），builder 不再猜。fadeAnchorTime 三级推断树整体删除；窗口语义（含尾、hide set 在 endFrame+0.5/fps）写进 schema description，成为机器可读契约。
3. **元素静态变换**：`rotation`、`flipX`、`opacity`、`transformOrigin` 成为元素属性——位姿不再需要烘进 PNG。
4. **move 语义定为绝对中心坐标**（可选 `path: [{x,y},...]` 折线/二次贝塞尔，vendored GSAP + MotionPathPlugin）。二选一，不做 origin 开关。
5. **文本样式**：`stroke`、`shadow`、`letterSpacing`、`lineHeight` + `font: {assetKey, weight}`（字体作为资产，见 3.3）。Baloo 字效套件不再烘焙。
6. **blend mode**：元素级 `mixBlendMode`（CSS 原生；`#canvas` 加 `isolation: isolate` 把混合限制在画布内；Chrome 渲染确定性与既有管线等同）。调色/颗粒/光晕从「烘死在底图」变为可动元素。
7. **audio.tracks[]**（见 3.2）。
8. **上限改资源预算**：IR ≤256KiB 不变 + 解码资产总字节预算 + 像素预算；删除元素计数闸门（可留 256 级性能建议值，文档标注非正确性约束）。
9. **JSON Schema 落盘**（`example/internal/video/app/ir.schema.json`，随 openapi 引用）：每个字段的坐标空间、单位、时钟、窗口语义进 description。**语义从代码注释升为契约**是本次重构的灵魂。

> **[2026-11-17 注记] v1 桥接提前落地**：本节四项已在 v0.32.0 以 v1 加法形式先行发布——
> ① `atFrame` 帧锚（动画级整数帧锚，与词锚互斥、写时校验；即第 1 条 `at:{frame}` 的 v1 桥）；
> ② `resize` 动画类型（宽高 tween，左上角锚定；语义进第 5 条/schema description 的事先演练）；
> ③ `MaxAnimationsPerElement` 16→32（第 8 条「计数闸门是粗代理」判断的又一次实证）；
> ④ harness 探针示范（`testdata/probe_frames_test.go`，走 render.Snapshotter 桥的 `SnapshotMulti`——第 3.4 节 Probe 一等化的先声）。
> **v2 迁移时的归宿**：`atFrame` 升格为必填 `at: {frame}|{wordId}`（第 1 条）；resize 的左上角语义写进 §2.8 契约表（v2 spec）；假锚词路径（manual words 纯作时间锚的用法）届时可整体删除——words 回归字幕/脚本本义。

### 3.2 音频层（消灭 R0 的音效半边）

`ir.audio.tracks[]: {assetKey, kind: voice|bgm|sfx, inSec, outSec, volume, fadeInSec, fadeOutSec}`，轨内事件可 `at: {frame}` 锚定（SFX 与贴纸落点同帧）。现有 voice/bgm 字段废除并入 tracks。MuxAV 滤镜链按轨数生成（amix inputs=N），响度链不变。写时校验：每个 assetKey 必须有登记行（对称 image src 的 validateAssetRefs）。

### 3.3 资产与烘焙层（消灭 R1/R3，覆盖 R0 的像素半边）

原则：**程序化内容在作者时烘焙，渲染时 IR 仍封闭确定性**（player 不开放 JS 的红线不动）。

1. **字体资产**：上传 woff2 → 内容寻址 → player 内联 @font-face（资源门 document.fonts.ready 已有，扩展即可）+ 子集检查。
2. **BakeJob 契约**（video 域新接口）：
   ```
   BakeJob {
     sources: [{sha256, role}]        // 溯源强制：壳图/布局/引擎版本全钉 hash
     params:  {camera, layout, items}
     renderer: 产品注册回调             // tool-site 注册 engine 渲染器
   }
   → BakeManifest {
       sprites: [{key(内容寻址), rect(合成空间), z, sourceHash}]
       provenance: sources + engineVersion + bake 工具版本
     }
   ```
   重烘=逐字节可复现；「这次出片用了哪版壳」系统可答；壳图漂移/双目录问题结构性消灭（按 hash 取，不按路径取）。
3. **通用 matte 库进 `platform/capx`**：差分 matte、外域洪泛、已知色 unmix alpha——试点手工写三遍的像素算法变成有单测的库函数；附「稳态采样」契约（bake 回调可声明状态机的瞬态区间，采样点自动避开，A8 类事故消灭）。
4. **manifest→IR mapper**：BakeManifest 直出 IR 元素数组（试点 build-studio-ir.mjs 减去全部 hack 后的残余，约 50 行）。

产品/框架边界干净：引擎渲染器回调注册在产品侧（tool-site 的 editor 引擎不进框架），框架只提供契约、matte 库、内容寻址存储与溯源。

### 3.4 反馈层（消灭 R4）

1. **Probe 一等化**：capx seekTimeline 包装为 video 域导出函数 `ProbeFrames(ir, assets, frames[]) → {png, domState}`；harness 模板内置「探针门」——全渲前先探 5-8 关键帧断言（golden 对比/元素 transform 校验），失败不出全片。MCP 的 preview_frames/render_frames 路径打通同一实现。
2. **harness 模板纪律**：输入文件依赖显式声明（或统一 `-count=1`）写进 testdata 模板注释——外部 ir.json 缓存坑一次性根治。
3. 全渲（~3min 级）只留给最终验收。

### 3.5 引擎即渲染器（产品注册渲染器路径，2026-11-17 补）

试点复刻的最大降级（弧线/活计数/yaw/调色全部烘焙）引出正解：**tool-site 的视频内容本身就是编辑器操作叙事，引擎不是外物，是这个产品家族的天然渲染器**。架构插槽现成——IR 注册表本就是 append-only（D8），加一种元素类型=一个 builder 函数+白名单一行。

设计要点：

1. IR v2 新增 `scene` 元素类型：`params: {renderer: "toolsite-editor@<version>", timeline: <产品自有 JSON Schema>}`。播放器外壳把该元素的绘制委托给产品注册的渲染器模块。
2. **引擎打包成单文件玩家**：editor 引擎是刻意 vanilla TS（layerscape 迁入时的决策）——esbuild 单文件 + 贴图 data URI 内联（试点实证 3.1MB 无压力）+ 暴露 `seek(t)`。capx 定帧截图协议原样复用。
3. **seek 纯函数约束**：scene 状态由 t 确定，禁 wall-clock/rAF 驱动画面（旧管线 `__renderFrame(t)` 已符合——约束是确认现状，不是新增负担）。
4. **分层合成**：引擎 canvas（z0，scene 元素）+ IR v2 声明层（字效/字幕/计数徽章，z10+）——一个 IR、一个时钟、一套音频混音；IR 声明层与引擎层互不越界。
5. **渲染器版本进 recipe**：引擎代码 hash 入 provenance；引擎变更 → goldens 重录（回归成本从"改播放器才动"变为"改引擎就动"，溯源管得住，需知情决策）。
6. **落地前提 = route (b)**：引擎渲染器是产品代码，不能注册进 example——视频域须移植 tool-site（与 48 概念量产方向一致）。首个引擎渲染器 = v4-assembly 的 vsPageInit 改造（700 行一次性模块化，此后每片=纯时间线数据）。

**对 3.3 的修订**：引擎渲染器落地后，BakeJob 从"视频编排主路"降级为**资产生产工具**（贴纸 sprite/缩略图/商品图导出仍用；matte 库照建，通用像素能力价值不变）。

---

## 4. 产品侧配套（tool-site，非框架）

- `assets/templates/` 与 `web/public/templates/` 双真源收敛：vite alias 指向 assets 单源，或构建期单向同步+drift 检测。A9 的三层地狱（双目录+1448 优先+git 考古）里，双目录这层是产品自己的债。
- 1448 回退链保留给应用运行时；bake 输入一律 hash 寻址（随 3.3 落地）。

---

## 5. 明确不做

- 不做 IR v1/v2 双读兼容层（存量三个消费者一次性迁移）。
- 不做 origin/坐标系开关参数（中心坐标唯一语义）。
- 不在 player 开放任意 JS/HTML（自包含+fail-closed 红线不动）。
- 不预建远程渲染/分布式 bake（ROADMAP 触发制不变）。

## 6. 落地顺序与量级

| 批 | 内容 | 量级 | 消灭 |
|---|---|---|---|
| P0-1 | IR v2 schema + 校验 + builder 显式化 + 存量迁移 | 2-3 天 | R2、R5、A5/A6/A10 类 |
| P0-2 | matte 库 + BakeJob 契约 + 溯源 manifest + 字体资产 | 2 天 | R1、R3、A1-A4/A8/A9 类 |
| P1-1 | audio.tracks + SFX 帧锚 + 写时资产校验 | 1 天 | A11 音效半 |
| P1-2 | path 动画 + 静态变换 + 文本样式 + blend | 1-1.5 天（随 v2 带出大半） | A11 像素半 |
| P2 | Probe 一等化 + harness 探针门模板 | 1 天 | R4、A12 |

验收：用 v4-assembly 复刻**重跑一次**——预期零手写烘焙脚本（全走 BakeJob）、零假锚词、字效/计数/SFX 原生表达、全渲次数 ≤2（探针门内完成迭代）。这次试点留下的 `toolsite_assembly_test.go` 改造为迁移后的回归基线。
