# Video Studio 真实案例库与分层测试方案

> **版本**：v1.0　**编写日期**：2026-11-15　**代码基线**：HEAD `d25362e`（2026-11-15 13:32，工作区 git clean）
> **文档状态**：**方案文档。本文没有任何一个案例被真实渲染过，也没有任何一条测试被标记为"已通过"。**
> **配套文档**：`plan-agent-video-studio-architecture-2026-11-14.md`（目标架构、不变量、错误语义）｜`plan-agent-video-studio-compat-2026-11-14.md`（兼容约束）｜`delivery-audit-video-studio-2026-11-15.md`（早期审计快照，其中多条已失效，见 §8.4）
> **覆盖范围**：9 个真实内容案例（10800 帧 / 380 秒）· 15 项渲染技术判定 · 19 类故障与安全用例 · L0–L5 六层执行计划
> **阅读前提**：能力判定一律按两列读（结构可表达性 / 视觉达标性），口径见 §8.2；不看这两列会退回"看起来支持"的误判。

## 目录

- **0. 文档定位、证据状态与阅读方式**
  - 0.1 这份文档是什么
  - 0.2 与既有文档的关系
  - 0.3 证据三态（全文强制）
  - 0.4 能力判定词汇（四档，全文统一）
  - 0.5 三类读者的阅读路径
  - 0.6 本文不包含
  - 0.7 版本与状态
- **1. 事实基线：当前实现、口径与能力矩阵**
  - 1.1 已实现 IR 逐字段现状（表：字段 | 类型 | 约束 | 校验位置 file:line | 备注）
  - 1.2 目标 IR 与实现差异矩阵（逐字段对照：目标字段 | 是否存在 | 差异后果 | 修复优先级 P0/P1/P2）
  - 1.3 Player 与时间轴语义（核实并补全基线的 9 条；另加 seek/fromTo 起始前状态/transformOrigin/z-index 层叠/字体回退链）
  - 1.4 字幕链路（分组、折行、SRT 输出；指出 CJK 硬切与行首标点的具体缺陷位置 file:line）
  - 1.5 音频与 FFmpeg 合成（MuxAV 实际滤镜链 vs 架构文档 §9.3 目标链，逐项列差距）
  - 1.6 capx 渲染与编码（RenderFrames 调用序列、FrameSpec 校验、池与并发上限、奇数尺寸、错误吞噬点）
  - 1.7 API / 装配缺口（spec-only 路由实际条数、main.go 未装配项、MCP/WS scope 未注册项）
  - 1.8 能力支持矩阵 —— 全文档唯一能力真值表
  - 1.9 本轮实测记录
- **2. 案例库总览、覆盖矩阵与执行组合**
  - 2.1 案例索引
  - 2.2 覆盖矩阵（规划覆盖；实际命中以 §3 / §4 各案例正文为准）
  - 2.3 里程碑划分
  - 2.4 案例到执行矩阵的组合规则
  - 2.5 案例与文档其他章节的映射
- **3. 案例集 A：转化与商业**
  - 3.1 VS-C01 短视频带货
  - 3.2 VS-C02 品牌发布
  - 3.3 VS-C07 招聘 / 企业宣传
  - 3.4 VS-C08 节日促销
- **4. 案例集 B：解释与纪实**
  - 4.1 VS-C03「知识科普」：为什么天空是蓝色的
  - 4.2 VS-C04「数据可视化口播」：中国经济三年切面（2022–2024）
  - 4.3 VS-C05「旅行 / 生活方式」：十一月京都红叶步行线
  - 4.4 VS-C06「访谈 / 字幕」：双人对谈——小团队怎么做工具产品
  - 4.5 VS-C09「产品功能演示」：文件管理器批量重命名流程
- **5. 动画与渲染技术专题**
  - 5.1 T-01 CJK 文本排版（字距 / 对齐 / 行高 / 避头尾 / 缺字）
  - 5.2 T-02 多图层与层级与素材适配
  - 5.3 T-03 局部裁剪 / 遮罩 / 圆角异形（mask / clip-path / overflow）
  - 5.4 T-04 粒子与粒子替代
  - 5.5 T-05 伪透视（2D 元素伪造三维倾角 / 梯形变形）
  - 5.6 T-06 镜头推进 / 拉远（dolly zoom 与视差）
  - 5.7 T-07 跨场景转场（多 composition / 淡入淡出 / 位移切换）
  - 5.8 T-08 路径运动（曲线 / 多段折线 / 贝塞尔轨迹）
  - 5.9 T-09 元素时间窗、错峰入场与 opacity 动画
  - 5.10 T-10 计数器（counter）定位与样式控制
  - 5.11 T-11 图表 / 条形生长动画（基线生长 vs 中心缩放）
  - 5.12 T-12 逐词 / 逐元素高亮（highlight 作用域）
  - 5.13 T-13 音频混音链（voice + BGM、响度、长度对齐、loop）
  - 5.14 T-14 字幕烧录与断行（硬字幕 / 软字幕 / CJK 换行缺陷）
  - 5.15 T-15 封面缩略图（封面帧选择与首帧钩子）
  - 5.16 IR 扩展提案汇总（按优先级）
  - 5.17 复杂度分级与成本上限
- **6. 可靠性、安全与故障矩阵**
  - 6.0 判定口径
  - 6.1 资源与素材类故障
  - 6.2 外部合成与时间戳类故障
  - 6.3 并发、版本与提交幂等类故障
  - 6.4 Worker 生命周期与配额故障
  - 6.5 授权与输入安全类故障
  - 6.6 并发容量、渲染语义与确定性故障
  - 6.7 状态汇总
- **7. 分层真实执行计划**
  - 7.0 通用约定
  - 7.1 L0 单测 / 纯函数
  - 7.2 L1 still 单帧 golden
  - 7.3 L2 短片段 MP4（≤5s，验证编码与音轨）
  - 7.4 L3 完整成片（9 案例全量）
  - 7.5 L4 浏览器逐像素 / DOM golden
  - 7.6 L5 性能与稳定性
  - 7.7 环境矩阵与 golden 基线流程
  - 7.8 成本估算（算式与量级）
  - 7.9 执行顺序、依赖图与门禁
  - 7.10 判定表模板（单次执行结果记录）
- **8. 交叉审查记录、裁定与未决项**
  - 8.1 审查用了什么方法
  - 8.2 能力判定的最终口径（全文唯一裁定）
  - 8.3 阻塞项修正登记
  - 8.4 本轮被推翻的旧结论（旧审计口径不再成立）
  - 8.5 未决项（有结论才算解决，这里都还没有结论）
  - 8.6 这套文档什么时候失效
  - 8.7 结论
- **附录 A：目标 IR 字段速查与实现映射**
- **附录 B：断言写法规范**
- **附录 C：素材、字体与命名规范**
- **附录 D：术语表**

## 0. 文档定位、证据状态与阅读方式

### 0.1 这份文档是什么

这是 Video Studio（Agent 视频工作室）的**案例库与分层测试方案**，用途有三：

1. **可直接构造**：每个案例给出完整的创作规格与目标 IR 规格，写出脚本、分镜、帧范围、锚点、元素、动画、特效、资产、渲染参数，不需要再"凭感觉补全"。
2. **可直接执行**：断言分层到 IR 层、DOM 层、帧层、MP4 层、运维层，阈值全部换算成可计算的数字。
3. **可直接判定**：区分"现 IR 能出片""现 IR 只能出降级版""必须扩展 IR 才能达标"三种状态，避免把"看起来像"当成"已经对了"。

它不是代码审计报告，也不是已执行测试报告。**本文档中没有任何一条测试被标记为"已通过"**，除非它附有本轮真实执行记录（见 §1.9）并明确标注 `[实测]`。

### 0.2 与既有文档的关系

| 文档 | 角色 | 本文如何对待它 |
|---|---|---|
| `docs/plan-agent-video-studio-architecture-2026-11-14.md`（v2.0） | 目标架构、不变量、错误语义、合入阻断项 | 目标 IR 与错误码以它为准；但它 §0.3 的"当前状态"是 2026-11-15 的审计快照，**已部分失效**，本文以当前工作区代码为准并逐项更正 |
| `docs/plan-agent-video-studio-compat-2026-11-14.md` | 兼容性与迁移约束 | 只在不变量冲突时引用 |
| `docs/delivery-audit-video-studio-2026-11-15.md` | 交付审计快照 | 作为缺口的历史证据引用，不作为当前事实 |
| `docs/testing-strategy.md` | 项目既有测试分层 | 本文的 L0–L5 分层与其对齐，不另立体系 |

一处必须提前说明的冲突：架构文档 §0.3 与 §16.3 记载"11 条 video 路由为 spec-only""main.go 未装配"，而 2026-11-15 本机实测 `python tools/check_api.py` 返回 `spec routes: 172  code routes: 172`（零漂移，exit=0），`example/cmd/app/main.go` 已装配 capx、storagex、videoapp service 与 ws scope。**本文所有"缺口"结论都以 §1 的代码取证为准，不以旧审计清单为准。**

### 0.3 证据三态（全文强制）

| 标记 | 含义 | 必备附注 |
|---|---|---|
| `[实测]` | 本轮真实执行命令并得到结果 | 命令 + 关键输出 + 日期 |
| `[代码]` | 读代码得出，未运行 | `文件:行号` |
| `[外部]` | 官方文档 / 规范 | 可访问 URL 或标准出处 |
| `[待验证]` | 合理推断但无证据 | 用什么命令或断言可验证 |

### 0.4 能力判定词汇（四档，全文统一）

| 标记 | 含义 | 案例里的后果 |
|---|---|---|
| ✅ | 现 IR + 现 Player 直接可做 | 案例可直接落 fixture 跑通 |
| ⚠️ | 现 IR 可做近似，存在已量化的误差 | 案例可出片，但验收标准要按"降级版"写，且必须登记误差 |
| ⛔ | 现 IR 做不了，需扩展字段或改 Player | 案例只能出"结构占位版"，达标项挂到扩展后里程碑 |
| 🚫 | 明确不做（v1 非目标） | 案例不得依赖它，否则案例本身要改 |

### 0.5 三类读者的阅读路径

- **要写 fixtures / 测试代码的人**：§1.8 能力矩阵 → §3 / §4 对应案例的「IR 规格」「预期帧表」「断言」→ 附录 A 字段速查 → 附录 B 断言规范。
- **要验收视觉质量的人**：§2.2 覆盖矩阵 → 案例的「创作规格」「分镜表」→ 案例的「人工验收点」→ §7.3 阈值。
- **要修能力的人**：§1.2 差异矩阵 → §1.8 矩阵中所有 ⛔ 行 → §5.16 扩展提案汇总 → §6 缺口清单。

### 0.6 本文不包含

- 不包含任何业务代码改动、迁移、OpenAPI 修改；案例中的 IR 是**输入规格**，不是已实现能力。
- 不包含已渲染成片、已生成的 golden 基线图片。基线需要按 §7.7 的流程生成并评审后才能引用。
- 不承诺跨 OS / GPU / Chrome 版本的 bit-identical 输出；确定性只按"固定渲染镜像 + 固定依赖 + 固定资产"定义（与架构文档 D12 一致）。
- 不包含商业素材的实际授权文件；附录 C 只规定授权口径与登记字段。

### 0.7 版本与状态

| 项 | 值 |
|---|---|
| 文档版本 | v1.0 |
| 编写日期 | 2026-11-15 |
| 代码基线 | 当前工作区（`example/internal/video/` 含 adapters/{http,mcp,tts,aligner} 与 render/{worker,pipeline,store,stub}；`platform/capx`） |
| 代码基线修订 | 任何一次能力相关合入后，§1.8 必须重新取证；§1.8 失效即本文档失效 |
| 状态口径 | 「已实测」= 有本轮命令记录；「可执行待测」= 断言写全但未跑；「受缺口阻塞」= 依赖 §1 中未实现的字段或链路 |

## 1. 事实基线：当前实现、口径与能力矩阵

### 1.1 已实现 IR 逐字段现状（表：字段 | 类型 | 约束 | 校验位置 file:line | 备注）

源码：`example/internal/video/app/ir.go`（类型与校验）、`service.go`（渲染参数与持久化投影）。

| 字段 | 类型 | 约束 | 校验位置 file:line | 备注 |
|---|---|---|---|---|
| `IR.version` | int (`json:"version"`) | 无写校验 | ir.go:147 | 与数据库行级乐观锁 `version` 是两个维度；投影到 HTML 的 payload 不含该字段（projector.go:178-186）。 |
| `IR.meta.fps` | int | ∈ {24,25,30,50,60}；0 → 默认 30 | ir.go:167, 279-285 | 写时规范化默认值。 |
| `IR.meta.width` | int | [360, 2160] | ir.go:286-288 | IR 层未限制偶数、未限制宽高比白名单；偶数在 capx 渲染边界由 Validate 强制（renderer.go:80-81，见 §1.6）。 |
| `IR.meta.height` | int | [360, 2160] | ir.go:289-291 | 同上。 |
| `IR.meta.durationSec` | float64 | > 0 | ir.go:292-294 | 目标区间 [0.04, 300] 未实现（§1.2）。 |
| `IR.script` | string | ≤ 5000 Unicode code points | ir.go:159, 207-209 | 目标上限 2000 code points（计划文档 §5.2 #7）。 |
| `IR.words[]` | []Word | ≤ 2000 条 | ir.go:160, 210-212 | 时间戳单调递增、不重叠；source 白名单（ir.go:213-227, 183-185）。 |
| `Word.index` | int | 无独立校验 | ir.go:64 | `SetWords` 入口由 `renumber` 重置为数组下标（service.go:511-518）；`Validate` 不检查 `index == 数组位置`。 |
| `Word.text` | string | 非空由分词路径保证 | ir.go:65 | 无长度上限校验。 |
| `Word.start` / `Word.end` | float64 | start ≥ 0；end > start；与前一词不重叠 | ir.go:66-67, 215-226 | 秒，浮点。 |
| `Word.source` | string | ∈ {tts, aligner, manual, estimated} | ir.go:68, 218-220, 183-185 | 无 confidence / scriptStart / scriptEnd 字段（§1.2）。 |
| `IR.effects[]` | []Effect | ≤ 128 条 | ir.go:161, 228-230 | 效果注册表 5 种（ir.go:169-172）。 |
| `Effect.id` | string | 必填 | ir.go:87, 233-235 | 命名空间唯一性未在 `Validate` 中断言。 |
| `Effect.type` | string | ∈ {pulse, counter, highlight, shake, fade} | ir.go:89, 236-238 | |
| `Effect.anchor.text` | string | 必填；occurrence ≥ 0 | ir.go:88, 73-76, 239-244 | 锚点只有文本 + 出现次序；无 wordId（§1.2）。 |
| `Effect.params` | json.RawMessage | 按类型白名单键；未知键拒绝 | ir.go:90, 298-329 | pulse.scale；counter.from/to/suffix；highlight.color；shake.intensity；fade.opacity。 |
| `Effect.resolvedFrom` | *ResolvedFrom | 写回审计；渲染期可读 | ir.go:91, 80-83 | `{wordIndex, reason}`；reason ∈ exact/same_text/nearest/missing（ir.go:47-51）。 |
| `IR.elements[]` | []Element | ≤ 64 条 | ir.go:162, 249-251 | |
| `Element.id` | string | 必填 | ir.go:117, 333-335 | |
| `Element.type` | string | ∈ {image, text, shape} | ir.go:118, 336-338 | 未知类型读时容忍（§1.3 R7）。 |
| `Element.src` | string | image 必填；必须 `video/` 前缀；拒绝 `://` 与 `data:` | ir.go:119, 339-351 | SSRF 面收窄到本域存储键。 |
| `Element.text` | string | 仅 text 类型消费 | ir.go:120 | 无富文本/内联样式子集。 |
| `Element.color` | string | 无格式校验 | ir.go:121 | |
| `Element.fontSize` | float64 | 0 = 不覆盖 CSS 默认 | ir.go:122, 236-238 | |
| `Element.x/y/w/h` | float64 | 必须有限数；w/h ≥ 0 | ir.go:123-126, 386-391 | 坐标在投影时裁剪到画布（ir.go:378-379 注释）。 |
| `Element.z` | int | 无范围校验 | ir.go:127 | 投影为 `zIndex = 1 + z`（timeline-builder.js:63）。 |
| `Element.animations[]` | []ElementAnimation | ≤ 16 条/元素 | ir.go:129, 352-354 | |
| `ElementAnimation.id` | string | 必填 | ir.go:102, 358-360 | |
| `ElementAnimation.type` | string | ∈ {move, scaleIn, rotate} | ir.go:103, 361-363 | |
| `ElementAnimation.from` / `to` | *Point | 坐标必须有限 | ir.go:104-105, 380-384 | 仅单点直线插值；无路径/多点关键帧。 |
| `ElementAnimation.fromValue` / `toValue` | *float64 | 标量（scale/rotate 用） | ir.go:106-107 | |
| `ElementAnimation.startAnchor` | *Anchor | 可选；文本必填、occurrence ≥ 0 | ir.go:108, 370-377 | |
| `ElementAnimation.durationFrames` | int | > 0 | ir.go:109, 364-366 | |
| `ElementAnimation.easing` | string | ∈ {linear, power1.out, power2.out, power3.out, back.out, expo.out}；空 = 默认 | ir.go:110, 367-369, 178-181 | |
| `ElementAnimation.resolvedFrom` | *ResolvedFrom | 审计写回 | ir.go:111 | |
| `ElementAnimation.extra` | json.RawMessage | 未被投影仪消费 | ir.go:112 | 预留扩展袋；`elementMap` 不输出（projector.go:240-269）。 |
| `IR.audio.voice` | *AudioTrack | 可选；存在时 key 必填、前缀 `video/`、volume ∈ [0,1] | ir.go:141, 395-417 | voice.durationSec 必须 ≥ 最后一个词 end（ir.go:262-268）。 |
| `IR.audio.bgm` | *AudioTrack | 同上 | ir.go:142 | |
| `AudioTrack.key` | string | 存储键；拒绝外部 URL | ir.go:134, 407-412 | |
| `AudioTrack.durationSec` | float64 | 无下限校验 | ir.go:135 | |
| `AudioTrack.volume` | float64 | [0, 1] | ir.go:136, 413-415 | |
| `RenderParams.fps` | int | 0 = 跟随 IR | service.go:62, 71-74 | 渲染期覆盖。 |
| `RenderParams.width/height` | int | 0 = 跟随 IR；无宽高比校验 | service.go:63-64, 75-80 | 目标要求保持原宽高比或显式 fit（计划文档 §5.2 #9）。 |
| `RenderParams.subtitleMode` | string | ∈ {burn, soft, none}；非法 → none | service.go:66, 81-92 | `burnSubtitles` 为旧标志，互推 mode。 |
| `RenderParams.bgmVolume` | float64 | > 0 时覆盖 IR BGM 音量 | service.go:67, 148-150（render_pipeline.go） | 无 0–1 区间校验在此层。 |
| 整包 IR | bytes | ≤ 256 KiB（json.Marshal 后） | ir.go:164, 269-275 | |

**服务层常量与状态枚举（非 IR 字段，写入口径一并记录）**

| 常量 / 枚举 | 值 | 位置 file:line | 备注 |
|---|---|---|---|
| Render 状态 | `queued / running / succeeded / failed / interrupted` | service.go:136-140 | `interrupted` 为 drain/被杀后的中间态，river 重试回 `running`。 |
| 领域错误码 | `E_VIDEO_PROJECT_NOT_FOUND`(404)、`E_VIDEO_RENDER_NOT_FOUND`(404)、`E_VIDEO_VERSION_CONFLICT`(409)、`E_VIDEO_ANCHOR_NOT_FOUND`(400)、`E_NOT_CONFIGURED`(503)、`E_FORBIDDEN`(403)、`E_VIDEO_ASSET_TOO_LARGE`(400)、`E_VIDEO_ASSET_UNSUPPORTED`(400) | service.go:27-35 | 经 `*webx.Error` 映射 HTTP；MCP 工具把错误码作为错误文本透传。 |
| 配额键 | `video_renders_monthly` | service.go:38；迁移 1008 | 月度渲染额度；提交预扣、失败/中断补偿释放。 |
| WS 事件 | `video.ir.updated`、`video.render.updated` | service.go:41-44 | 仅两类；推送在事务 commit 之后（service.go:251-262）。 |
| 审计动作 | `video.project.created / video.ir.updated / video.render.created / video.render.completed / video.render.failed / video.asset.uploaded` | service.go:47-54 | 写路径经 `RecordTx` 同事务落审计；资产上传用 `Record`（service.go:338-341）。 |
| 上传字节上限 | `700 << 10`（700 KiB） | service.go:59, 899-901 | MCP 路径嵌套在 /mcp 1 MiB body 限内；REST multipart 共用同一 /api 1 MiB 全局限。 |
| River 队列 / 作业类型 | 队列 `video`；类型 `video_render` | ports.go:38, 41, 47-51 | 独立于 events/schedule 队列；作业负载仅 `RenderID`（ports.go:47-49）。 |

---

### 1.2 目标 IR 与实现差异矩阵（逐字段对照：目标字段 | 是否存在 | 差异后果 | 修复优先级 P0/P1/P2）

目标来源：计划文档 §5.1 示例 JSON、§5.2 不变量、§5.3 锚点规则；现状来源：ir.go / projector.go / service.go。
优先级：**P0** = 阻断 v1 正确性或安全闭环；**P1** = 直接限制商业案例覆盖面；**P2** = 体验/规范层，可后置。

| 目标字段 / 规则（来源） | 是否存在 | 差异后果 | 优先级 |
|---|---|---|---|
| `schemaVersion`（计划 §5.1、§5.2 #6） | 否 | render 遇到未知结构无法 fail-closed 返回 `E_VIDEO_UNSUPPORTED_SCHEMA`；只能读时容忍跳过（timeline-builder.js:143,151,163）。 | P0 |
| 偶数尺寸 + 分辨率白名单 {1080×1920, 1920×1080, 1080×1080}（计划 §5.2 #3、§9.3） | 部分 | 偶数已在 capx 边界强制：`FrameSpec.Validate` 拒绝奇数（renderer.go:80-81），编码链另带 trunc-to-even scale 滤镜兜底（encode.go:78）；**IR/RenderParams 层仍可提交奇数与任意比例**，无标准分辨率白名单、无宽高比约束（ir.go:286-291；service.go:63-64）。奇数规格在渲染期会被 Validate 以明确错误拒绝，不会走到 x264 开编码器；比例拉伸与标准尺寸白名单问题仍存在（§1.5 #5、§1.6）。 | P1 |
| 锚点创建即精确匹配；缺失 → `E_VIDEO_ANCHOR_NOT_FOUND`；重复词无 occurrence → 歧义错误；禁止静默 nearest（计划 §5.3 #2-#4, #6） | 部分 | `ResolveAnchors` 在无候选时自动回退全局 nearest（ir.go:517-524）；occurrence 越界静默取同文本最近邻（ir.go:507-515）；无歧义错误码。Agent 会把漂移后的时间点当成已解析锚点使用。 | P0 |
| `meta.background`（计划 §5.1） | 否 | 舞台背景硬编码黑色（projector.go:286），无法做品牌底色卡片类案例。 | P2 |
| `voice{provider, voice, rate, audioKey}` 独立配音对象（计划 §5.1） | 否 | 只有 `audio.voice.key/durationSec`；`voiceName()` 恒返回空串（service.go:534），TTS 语速/音色不可由 IR 指定。 | P1 |
| `word.id / confidence / scriptStart / scriptEnd`（计划 §5.1、§5.3） | 否 | 无稳定词 ID，脚本改稿后无法按 ID 保留锚点；无置信度字段，estimated 词无法在字幕层标注低置信。 | P1 |
| `tracks[]`（main/bgm 图层，带 z/volume/assetKey，计划 §5.1） | 否 | 图层模型退化为扁平 Element 数组 + 单一 `audio.bgm`；无法表达独立轨道的显隐、混音顺序与轨道级音量。 | P1 |
| `element.trackId / startFrame / endFrame`（计划 §5.1、§10.2 工具参数） | 否 | 元素从第 0 帧可见到成片结束；无元素级时间窗，错峰出场只能依赖动画锚点。 | P1 |
| `element.params` 参数袋（计划 §5.1） | 否 | Element 只有扁平标量字段（ir.go:116-130）；新增视觉属性必须改 Go 结构体 + 投影仪 + JS 三处。 | P2 |
| 顶层 `animations[]` + `targetElementId`（计划 §5.1） | 否（嵌套实现） | 动画挂在 `element.animations` 内（ir.go:129）；内部自洽，但与目标契约结构不同，Agent 工具描述需对齐。 | P2 |
| 动画字段位置：`from/to/fromValue/toValue/easing`（计划 §5.1 示例把动画参数放 `params`；现实现读顶层） | 部分 | 现 `ElementAnimation` 无 `params` 字段，上述字段均为顶层 json tag（ir.go:104-110）；若把同名字段写进 `params` 袋，解码后不落任何动画字段（Go struct 无 params 捕获；唯一扩展袋为显式 `extra`，ir.go:112），投影仪 animation map 也只输出顶层字段、不输出 extra（projector.go:246-271）。**裁定：动画字段一律写顶层**；目标 §5.1 示例的 `params` 嵌套需架构侧更正（plan:249）。 | P1 |
| `anchor.wordId` 权威引用（计划 §5.3 #1） | 否 | 锚点只能按文本 + occurrence；词表重排后文本匹配是唯一路径。 | P1 |
| `effect.targetElementId`（计划 §5.1、§5.3） | 否 | 效果目标只能是舞台或 counter 宿主节点（timeline-builder.js:168）；高亮/脉冲无法定向到某个具体图层。 | P1 |
| `meta.durationSec ∈ [0.04, 300]`（计划 §5.2 #7） | 否 | 仅要求 > 0（ir.go:292-294）。 | P2 |
| `script ≤ 2000` code points（计划 §5.2 #7） | 否（现为 5000） | 长脚本字幕/词表膨胀风险；与目标上限不一致。 | P2 |
| 单图 ≤ 1 MiB 解码体积、图片 ≤ 64、解码像素总量 / 解压炸弹限制（计划 §5.2 #8、§12.1） | 部分 | 仅上传字节上限 700 KiB（service.go:59, 899-901）与元素总数 ≤ 64；无 magic bytes、像素总量、解码后体积校验（service.go:902-907 只看声明 MIME）。 | P1 |
| 渲染覆盖分辨率时保持宽高比 / `fit=contain|cover`（计划 §5.2 #9） | 否 | `RenderParams.width/height` 自由取值（service.go:63-64），无比例校验，画面可能被拉伸。 | P1 |
| canonical JSON + `ir_sha256`（计划 §5.2 #10） | 否 | 落库仅 `json.Marshal(ir)`（service.go:307-310），无规范哈希列，无法做快照去重与配方追溯。 | P2 |
| 响应 `warnings` 数组；unresolved 显式标记 + 用户确认（计划 §5.3 #5、§5.4、§10.5） | 否 | 解析结果经 `resolutions` 返回（service.go:227），但 Render 行/响应无 warnings 字段；降级（TTS/Aligner 失败走估算）只写日志（service.go:472, 505, 508）。 | P1 |
| 未知元素类型 / 不支持 schemaVersion 在 render 路径 fail-closed（计划 §5.2 #6、§16.2） | 否 | JS 侧 catch 后继续出片（timeline-builder.js:146；跳过未知类型 builder 151-153）。 | P1 |
| 列表分页 limit/cursor（计划 §10.1） | 否 | List 硬编码 LIMIT 200（service.go:374）、renders LIMIT 100（service.go:858），无 cursor。 | P2 |

---

### 1.3 Player 与时间轴语义（核实并补全基线的 9 条；另加 seek/fromTo 起始前状态/transformOrigin/z-index 层叠/字体回退链）

源码：`app/timeline-builder.js`（浏览器内 builder）、`app/projector.go`（HTML/CSS 模板）、`platform/capx/renderer.go`（出片定位）、`web/src/pages/VideoStudioPage.tsx`（父页协议）。

**基线 9 条（已逐条核实）**

- **R1 暂停时间轴 + seek 定位，不依赖 wall-clock。** 出片逐帧 `tl.pause(tSec)`（renderer.go:235-251）；预览播放器同样走 `seek`（timeline-builder.js:176-181）。`gsap.ticker.lagSmoothing(0)`（timeline-builder.js:173）；确定性契约见 capx.go:22-29。
- **R2 ready 门 = 字体就绪 + 图片 decode 完成；资源失败 fail-closed。** builder 等待 `document.fonts.ready` 与全部 `img.decode()`（timeline-builder.js:209-215）；decode 拒绝时根因写入 `window.__player.error` 并重抛（timeline-builder.js:153-160，`error` 字段初始化于 199-206），`Promise.all(decodePromises)` 拒绝后 `ready` 保持 false；capx 探针先读 `__player.error`，非空即以 `capx: player resource failure: <根因>` 中止（renderer.go:234-239），否则轮询 `ready`，60s 超时硬失败（renderer.go:111, 226-253）。
- **R3 双 rAF 刷合成器。** 每次 seek 后两个 `requestAnimationFrame` resolve 后才截图（renderer.go:240-244）。属经验性同步，非像素一致性数学保证（计划 §9.2 同述）。
- **R4 postMessage 双向同源校验。** iframe 侧校验 `event.origin === location.origin`（timeline-builder.js:204）；父页同时校验 origin 与 `event.source === iframe.contentWindow`（VideoStudioPage.tsx:169-172）。消息类型 `player` / `player:state`（timeline-builder.js:206, 218）。
- **R5 单一 composition。** 时间轴注册表 `window.__timelines['main']`，v1 无多 composition 切换（timeline-builder.js:138-139, 172）。
- **R6 锚点时间 = 命中词的 `start`；missing 不挂时间轴。** `anchorTime` 取 `words[wordIndex].start`（timeline-builder.js:69-73）；`reason === 'missing'` 的效果直接跳过（timeline-builder.js:167）。
- **R7 未知类型读时容忍。** 未知元素无 id 跳过（143）；未知动画类型 warn + 跳过（151-153）；未知效果类型 warn + 跳过（162-165）。白名单在 ir.go:174, 176, 169-172。
- **R8 画面状态禁用 Date.now / 随机数。** builder 内无时钟/随机调用；capx 契约要求运动只由 GSAP 暂停时间轴驱动（capx.go:22-29）。
- **R9 seek clamp。** builder `seek` 把帧号夹到 `[0, durationFrames]`（timeline-builder.js:177）；capx 帧循环固定 `0 .. DurationFrames-1`（renderer.go:180-202）。

**补充 4 条**

- **S1 seek / fromTo 的起始前状态。** GSAP `fromTo` 在锚点时间之前，节点保留其内联 CSS 状态（left/top/w/h/color）；move 的相对偏移在 `from` 缺省时取节点当前布局位置（timeline-builder.js:113-118）。**IR 没有元素可见性窗口字段**：元素从第 0 帧起即渲染，动画只在锚点时刻叠加变换；不存在「起始前隐藏、入场后出现」的原生状态（对比计划目标 `startFrame/endFrame`，§1.2）。fade/highlight 的 `fromTo` 在起始前同样显示常态（timeline-builder.js:94-97, 107）。
- **S2 transformOrigin。** `scaleIn` 与 `rotate` 硬编码 `transformOrigin: '50% 50%'`（timeline-builder.js:123, 129）；舞台原点为 top left（projector.go:288 `transform-origin: top left`）。IR 无元素级 origin 字段；绕角/绕边缩放旋转当前无法表达。
- **S3 z-index 层叠。** 每个节点 `node.style.zIndex = String(1 + (el.z || 0))`（timeline-builder.js:63）。同 z 值时层叠顺序 = IR `elements` 数组顺序（DOM append 顺序，timeline-builder.js:64）；效果节点（counter 宿主）后 append，天然压在普通元素之上（timeline-builder.js:230-240）。无动画级 z 变化。
- **S4 字体回退链。** CSS 字体栈 `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`（projector.go:294）。**无内嵌子集字体**：render 路径依赖出片机器已装中文字体；缺字时静默回退到系统字体，无缺字检测失败（计划 §9.1 要求缺字检测并失败，当前未实现）。

**补充规则（投影仪 DOM 层）**

- **R10 elementMap 显式投影，未知字段丢弃。** `elementMap` 只挑取 id/type/x/y/w/h/z/src/text/color/fontSize/animations（projector.go:217-273）；`ElementAnimation.Extra`（ir.go:112）不进 payload（projector.go:242-267）。CSS 默认为绝对定位 + `will-change: transform`（projector.go:291）；图片 `object-fit: contain`（projector.go:292）；文本 48px 白色、line-height 1.35（projector.go:293-296）；shape 圆角 8px（projector.go:298）。
- **R11 预览/出片双解析器，DOM 字节一致。** 唯一差异是素材 URL：`PreviewResolver` 出同源 `/api/video/files/<key>`（projector.go:39-47），`DataURIResolver` 内联 base64 data URI（projector.go:65-83）。IR 数据块为 `<script type="application/json">`（projector.go:303），非可执行脚本、不进 script-src；内联脚本（vendor gsap + builder + boot）走 hash 钉住 CSP（projector.go:107-122, 183-186）。bootJS 仅 `seek(0)` 复位（projector.go:147-149）。

---

### 1.4 字幕链路（分组、折行、SRT 输出；指出 CJK 硬切与行首标点的具体缺陷位置 file:line）

源码：`app/subtitle.go`；消费侧：`render/render_pipeline.go:110-126`（SRT 落临时文件）、`platform/capx/encode.go:206-235`（burn）。

**已实现**

- **分组**：`BuildCues` 贪心累积，三条硬限制——单行 ≤ 16 rune、≤ 2 行、单 cue ≤ 6 秒（subtitle.go:12-16, 37-56）；窗口内遇到句读标点记录 `breakPunct`，优先在标点边界切分（subtitle.go:45-47, 57-59）。
- **折行**：`layoutLines` 在中段附近找空格切两行；无空格时回退中点（subtitle.go:72-99）。词间拼接：CJK-CJK 不加空格，CJK-非 CJK 加空格（subtitle.go:101-117）。
- **SRT 输出**：序号 + `HH:MM:SS,mmm --> HH:MM:SS,mmm` + 文本 + 空行（subtitle.go:174-184, 158-170）。
- **模式**：`burn` 走 libass `subtitles` 滤镜；`soft` 仅生成 SRT 侧车文件；`none` 不出字幕（render_pipeline.go:111, 218-231；RenderParams 归一化 service.go:81-92）。

**缺陷与缺口（附位置）**

1. **CJK 硬切（无词/无空格可断时）。** `layoutLines` 在找不到空格时 `best = half`，按 rune 中点切开（subtitle.go:95-98）。中文整段词表（`EstimateWords` 按空格分词，正文无空格时尤其）没有换行机会，行断点落在任意两个汉字之间，可能切开一个词组/成语。无 CJK 换行机会字表、无断行权重。
2. **行首标点（无避头尾处理）。** 折行后第二行的首字可能是 `，。、！？“（` 等标点；`isCJKPunct` 已列出标点集（subtitle.go:150-156）但**未被 `layoutLines` 引用**，行首/行尾标点避让（kinsoku）完全缺失。
3. **英文行长限制未区分语种。** 目标 CJK ≤ 16 字/行、英文 ≤ 42 字符/行（计划 §5.4）；实现统一 16 rune（subtitle.go:13, 42, 52, 75），英文行被过早折断。
4. **最小 cue 时长 / 相邻 cue 间隔缺失。** `BuildCues` 只看时长上限与字数，无最短显示时长、无 cue 间最小间隔（计划 §5.4 要求单一 `BuildSRT` 规则覆盖）。
5. **estimated 词表未强制软字幕或低置信提示。** `SRT(words)` 不看 `word.source`（subtitle.go:174-184）；计划 §5.4 要求 `source=estimated` 强制 soft 或显式低置信标注，当前未实现。
6. **行尾序列与约定不符。** 注释称 SRT 使用 CRLF（subtitle.go:172-173），实际 `fmt.Fprintf` 写出的是 `\n`（subtitle.go:181）。主流播放器兼容，但与注释契约不一致。
7. **软字幕未真正封装进 mp4。** `soft` 模式生成了 SRT（render_pipeline.go:111-126），但管线只在 `burn` 分支调用 `BurnSubtitles`（render_pipeline.go:218-231）；`mov_text` 字幕轨封装不存在（代码注释自述 follow-up，render_pipeline.go:217）。

---

### 1.5 音频与 FFmpeg 合成（MuxAV 实际滤镜链 vs 架构文档 §9.3 目标链，逐项列差距）

实际源码：`platform/capx/encode.go:147-183`（MuxAV）、`50-94`（EncodePNGStream）、`206-235`（BurnSubtitles）；计划目标：§9.3（plan 522-530）、§5.2 #2。

| # | 目标链项（计划 §9.3 / §5.2） | 实际实现（encode.go） | 差距 |
|---|---|---|---|
| 1 | 音频混合 `amix=inputs=2:duration=longest:normalize=0`，避免默认 normalize 改变人声音量 | `[2:a]volume=<v>[bgm];[1:a][bgm]amix=inputs=2:duration=first[a]`（encode.go:161-162） | `duration=first`（随首路 voice 结束）而非 longest；未设 `normalize=0`，amix 默认归一化会压低人声电平。 |
| 2 | 混合后 `apad`、`atrim`、`aresample=48000`，统一收口到成片时长 | 无任何 apad/atrim/aresample（encode.go:159-178 全分支） | 音频长度可能与视频轨不一致；采样率跟随输入；无统一 48kHz。 |
| 3 | BGM 短于视频时显式 loop / pad | 无 `-stream_loop`、无 BGM pad（encode.go:169-175 bgm-only 分支仅 volume） | BGM 提前结束后后半段无声；短 BGM 案例不可直接出片。 |
| 4 | 可选响度链 `loudnorm=I=-16:TP=-1.5:LRA=11` 后重采样 48kHz；recipe 记录滤镜链与 FFmpeg 版本 | 无 loudnorm；滤镜链/FFmpeg 版本不落库 | 响度无标准化；配方追溯缺失（§1.7 ③）。 |
| 5 | H.264 + yuv420p 奇数尺寸统一 pad；产品层只允许偶数标准尺寸 | 双层防御：`FrameSpec.Validate` 拒绝奇数（renderer.go:80-81）；编码链带 `scale=trunc(iw/2)*2:trunc(ih/2)*2`（encode.go:78）兜底 | IR/参数层无标准尺寸白名单与宽高比约束（§1.2 偶数尺寸行）；目标要求的产品层白名单尺寸仍未实现。裸 x264（无 scale 滤镜）对奇数仍报 `width not divisible by 2`（§1.9 #8 探测）。 |
| 6 | 输出明确 `-frames:v` / `-t`、`-preset medium`、`-crf 18`、`-pix_fmt yuv420p`、`-movflags +faststart` | CRF 默认 18、preset medium、yuv420p（encode.go:60-65, 73-75）；无 `-frames:v`/`-t`；`-movflags frag_keyframe+empty_moov+default_base_moof`（encode.go:82） | 时长收口靠帧循环数量而非 ffmpeg `-t`；faststart 因管道输出改为分片 MP4（encode.go:76-81 注释已说明，属有意偏差）。 |
| 7 | 无 libass 时 burn → soft + warning，不重复 mux 损坏输出 | `ffmpegHasSubtitles` 探测，缺失返回 `ErrNoLibass`（encode.go:214-220, 188） | 降级动作在调用侧：soft 封装未实现（§1.4 #7）；warning 不入 Render 记录。 |
| 8 | 无 voice / 无 BGM 走独立分支，不构造不存在的输入 | 三分支：voice+bgm、仅 voice（map 1:a）、仅 bgm（volume 滤镜）、全静音（map 0:v）（encode.go:158-178） | 分支结构符合目标；**全静音输出无音频轨**（encode.go:177 只 map 视频）。 |
| 9 | argv 传参、不走 shell；滤镜/字幕路径固定临时目录 + 转义 | `exec.CommandContext` argv（encode.go:288）；`escapeFilterPath` 转义盘符冒号（encode.go:194-198, 224） | 符合目标；临时目录由 worker `TmpDir` 提供（worker.go:58, render_pipeline.go:152）。 |
| 10 | 字幕样式（字号/位置/边距）可控 | burn 仅 `-vf subtitles=<srt>`，无 `force_style`（encode.go:224） | 字幕外观完全交给 libass 默认与 SRT 内容，IR 无字幕样式字段。 |
| 11 | 帧流时长/帧率由 spec 收口；解码体积有上限守卫 | `-framerate <fps>` 来自 spec（encode.go:70）；帧协议 8 字节 LE 长度前缀，单帧 > 64 MiB 拒绝（encode.go:98-110, 127-135） | ffmpeg 侧无 `-t`/`-frames:v` 复核；成片帧数以 RenderFrames 循环次数为准（renderer.go:180），帧流损坏或循环提前退出时编码侧不做时长兜底校验。 |

---

### 1.6 capx 渲染与编码（RenderFrames 调用序列、FrameSpec 校验、池与并发上限、奇数尺寸、错误吞噬点）

源码：`platform/capx/renderer.go`、`capx.go`、`browser.go`、`encode.go`、`remote.go`；调用侧 `render/render_pipeline.go`。

**RenderFrames 调用序列（renderer.go:134-204）**

1. `Runtime.acquire` 从暖池取一个浏览器实例（capx.go:178-202）；实例互斥锁串行化该实例上的作业（browser.go:25）。
2. 新建独立 tab（`chromedp.NewContext`），配置视口 `EmulateViewport(width, height)`（renderer.go:138, 145-147）。
3. 网络锁：`network.SetBlockedURLs` 阻断 `*://*:*/*`（renderer.go:152-159）。data: URI 非 http scheme，不受该模式影响；但「data/blob 可用」无专门测试（对照计划 §9.2）。
4. `GetFrameTree` → `SetDocumentContent` 注入投影 HTML（renderer.go:163-172）。
5. `awaitReady` 轮询 `window.__player.ready === true`，60s 超时（renderer.go:176-178, 209-229）。
6. 逐帧循环：检查 `tabCtx.Err()` → `seekTimeline`（pause(t) + 双 rAF）→ `CaptureScreenshot` PNG（`FromSurface=true`）→ 空 PNG 守卫 → `onFrame` 回调（renderer.go:180-202）。
7. 实例释放回池；Close 幂等关闭全部暖实例（capx.go:198-201, 246-258, 271-292）。

**FrameSpec 校验（renderer.go:76-84）**

- 校验：Width/Height/FPS/DurationFrames 均为正数（renderer.go:78-79, 82-84）；**宽高必须为偶数**（`% 2 != 0` 拒绝，renderer.go:80-81），错误信息含实际 `WxH`。
- **未校验**：最大分辨率、宽高比、设备像素比。IR 层的 [360,2160] 限制（ir.go:286-291）在 capx 通用包边界不重复生效。

**池与并发上限**

- 池容量 = `Config.PoolSize`，默认 1（capx.go:58, 131-133）。
- **并发上限由加权信号量保证**：`acquire` 先取 `r.sem`（容量 = PoolSize）再进入复用/启动；槽位满时阻塞等待或被 ctx 取消（capx.go:102-105, 184, 187-191, 195, 198-201）。空闲 pool channel 只复用暖实例、不限流（capx.go:209-213, 246-258）；竞态多启动的实例在 `put` 时超容量即关闭（capx.go:204-206 注释, 251-257）。example 另有 River 队列 `MaxWorkers`（默认 1，main.go:1281）一层并发收口。
- 单实例互斥锁串行化该实例上的作业（browser.go:25）；启动超时 20s 只包裹启动探测，暖实例与长渲染走无 deadline 的 context 链（capx.go:59, 134-135；browser.go:40-43, 53-81）。

**奇数尺寸（双层防御 + 测试现状）**

- 上游：`FrameSpec.Validate` 在渲染前拒绝奇数宽/高（renderer.go:80-81）；下游：编码滤镜 `scale=trunc(iw/2)*2:trunc(ih/2)*2` 对绕过 Validate 的直连编码入口做 trunc-to-even 兜底（encode.go:78）。
- 测试负例：`TestFrameSpec_OddDimensionsRejected` 断言 1081×1920 与 1920×1081 被 Validate 拒绝且错误含 `even`（pool_internal_test.go:72-83）；`TestRenderFrames_InvalidSpec` 断言 0×0 被拒（renderer_test.go:184-196）。其余用例为偶数尺寸：64×64（encode_test.go:78,97,134）、320×180 / 160×120（renderer_test.go:82,118,149,176）；池复用用例视口见 capx_test.go:113,119。**无编码层奇数尺寸经 scale 滤镜后成功出片的用例**——兜底滤镜只在源码注释与 argv 中，未被测试断言。
- 本机裸 ffmpeg 探测（§1.9 #8，未带管线 scale 滤镜）：3×3 与 1×1 在 libx264 打开编码器时报 `width not divisible by 2`，2×2 对照成功；该结果解释了 Validate 与兜底滤镜存在的原因，不代表 capx 管线当前会让奇数规格走到编码器。

**错误吞噬点（fail-open / 降级日志，逐项定位）**

1. 图片 decode 失败为 **fail-closed**（旧版本曾是 `.catch(function(){})` 静默继续，已被并发提交纠正）：`decode().catch` 把根因写入 `__player.error` 并重新抛出（timeline-builder.js:153-160）；`Promise.all(decodePromises)` 拒绝后 ready 保持 false（211-215）；renderer 探针读 `__player.error` 非空即返回 `capx: player resource failure: <根因>`（renderer.go:234-239），不再落到 60s 不透明超时。
2. 缩略图写入失败仅 `Log.Warn`，不阻断渲染（render_pipeline.go:245-247）；`firstThumb` 当前恒返回 `nil, nil`（render_pipeline.go:272-277）。
3. 配额释放失败仅 `Log.Warn`（render/store.go:86, 95；worker.go:373）。
4. WS 推送失败仅 `Log.Warn`（worker.go:273-275；service.go:251-257）。
5. ffmpeg stderr 只保留最后 12 行随错误返回（encode.go:317-329）；成功路径 stderr 丢弃。
6. TTS / Aligner 调用失败 `Log.Warn` 后静默回退估算词表（service.go:471-473, 499-505, 508）。
7. `RemoteHTTP.RenderFrames` 显式返回 `ErrRemoteNotWired`（remote.go）——属可诊断的未实现，不是静默吞噬。
8. 硬失败点（未吞噬）：视口/网络锁/文档注入错误直接返回（renderer.go:146, 158, 165, 171）；空 PNG 返回错误（renderer.go:196-198）；onFrame 错误中止循环（renderer.go:199-201）；图片 decode 资源失败经 `__player.error` 中止渲染（timeline-builder.js:153-160；renderer.go:234-239）。

**仓库内测试覆盖现状（[代码] 逐文件核对）**

| 测试文件 | 覆盖对象 | 已断言内容 | 未覆盖 |
|---|---|---|---|
| capx_test.go | Runtime 门控/探测/remote 未接线 | 关闭门控惰性、nil Enabled 视为 false、全方法 `ErrNotConfigured`、显式 Chrome/FFmpeg 路径探测、`ErrRemoteNotWired`（capx_test.go:72-195） | 真实浏览器启动路径；池复用的暖实例生命周期在 pool_internal_test.go 覆盖。 |
| pool_internal_test.go | 池硬帽并发 + FrameSpec 校验 | `TestPoolHardCap_NeverExceedsPoolSize`：并发 acquire 不超过 PoolSize（pool_internal_test.go:19-70）；`TestFrameSpec_OddDimensionsRejected`：奇数尺寸被 Validate 拒绝（72-83） | 并发下信号量阻塞等待/超时取消路径；池实例回收后的复用断言粒度。 |
| renderer_test.go | Renderer 帧循环 + awaitReady 轮询 | 帧号→时间映射、ready 超时、空帧守卫、视口注入 | 真实 chromium 截图；双 rAF 合成同步只在 JS 层，无像素断言。 |
| encode_test.go | EncodePNGStream / MuxAV / BurnSubtitles 参数构造 | ffmpeg argv 与滤镜串组装、音频分支选择、libass 探测分支 | 真实 ffmpeg 跑通编码；scale 兜底滤镜对奇数尺寸的实际出片；输出像素/时长正确性。 |
| ir_test.go | IR Validate、锚点解析、词表估算 | 类型白名单、字段区间、exact/same_text/nearest/missing 解析、分词估算 | schemaVersion fail-closed；长文本/解码体积限制。 |
| projector_test.go | 投影仪 HTML 转义与 hash | JSON 块 `</script>` 闭合逃逸、内联脚本 hash 锁定 | 浏览器内渲染一致性。 |
| service_test.go / service_db_test.go | 服务层事务路径 | 成员校验、乐观锁冲突、配额/审计/推送编排（DB 版需 `TEST_DATABASE_URL`） | 出片端到端。 |
| routes_test.go / tools_test.go | HTTP 路由与 MCP 工具 schema | 路由挂载、工具参数 jsonschema、handler 覆盖 | 真实鉴权矩阵（PAT/session/跨 workspace）。 |
| worker_test.go | River worker 状态机 | queued→running→终态转换、终态跳过、故障注入；两种 build tag 下均可编译（worker_test.go:259） | capx 标签下的真实管线；`released_at` 防重释放。 |

**远端渲染扩展点**：`RemoteHTTP.RenderFrames` 返回 `ErrRemoteNotWired`（remote.go），无 HTTP 客户端实现；属 v1 预留接口，当前不可切换远端集群。

---

### 1.7 API / 装配缺口（spec-only 路由实际条数、main.go 未装配项、MCP/WS scope 未注册项）

**路由漂移实测**：`python tools/check_api.py` → `spec routes: 172  code routes: 172`，零漂移，exit 0（§1.9）。扫描范围含 video 适配层：`tools/check_api.py:45` 显式 glob `example/internal/video/adapters/http/*.go`（计划 §16.3 F2 已关闭）。**spec-only 路由 = 0，code-only 路由 = 0**。注意：该检查只比对 (method, path)，不比对状态码、请求头或响应字段——下列字段级漂移它发现不了。

**三态分类**（① 已装配且生产实现；② 已装配但为 stub / 降级；③ 仍未装配或缺失）。

| 态 | 项 | 证据 file:line | 说明 |
|---|---|---|---|
| ① | 11 条 REST 路由 + authz 角色门 | routes.go:75-88；main.go:1258 | read/write/render 三个权限键在路由层 `authz.Require`；角色授权 main.go:520-526。 |
| ① | Service 全部写路径 + 成员校验 + 乐观锁 + 事务内审计 + commit 后推送 | service.go:179-264, 313-343, 693-775 | HTTP 与 MCP 共用同一服务方法。 |
| ① | River worker 状态机 + 独立 `video` 队列 client + orphan sweep + drain 窗口 | worker.go:133-229, 270-286；main.go:1263-1309 | JobTimeout 15min、MaxAttempts 2、SoftStopTimeout=JobTimeout、RescueStuckJobsAfter=JobTimeout+15min（main.go:1278-1296）；drain StopWait=JobTimeout+1min（main.go:1307-1308）。 |
| ① | WS scope `video` + 项目级成员鉴权 | main.go:982 注册；986-995 `hub.Authorize` 委托 `videoSvc.CanAccess` | 帧事件 `video.ir.updated` / `video.render.updated`（service.go:41-44）。 |
| ① | MCP 12 个 `video_*` 工具注册 | main.go:1313-1318；tools.go（12 个 `mcpAdd`） | 工具清单见本节末注。 |
| ① | 素材存储（storagex 本地）+ 内容寻址键 + 审计 | main.go:1215；service.go:891-930 | key 布局 `video/<ws>/assets/<project>/<sha256>.<ext>`（service.go:929）。 |
| ① | 配额预扣 / 失败释放，idemKey=renderID | service.go:719-737；render/store.go:38-73（释放 claim）、80-98（period 固定释放） | 月度键 `video_renders_monthly`（service.go:38；迁移 1008）。 |
| ① | 幂等提交（Idempotency-Key）全链路 | routes.go:202-205（读取、trim、截断 128）；service.go:727-735（ConsumeWithTx idem + ErrIdemReplay 回放首条 render）；service.go:752-755（唯一索引兜底）；service.go:779-791（按 submission_key 查回放行）；迁移 1009:8-12（`(workspace_id, submission_key)` 部分唯一索引） | 空键 = legacy 非幂等提交；MCP 侧对应 `request_id` 通道（迁移 1009:4-5 注释）。 |
| ① | capx 本地 Chrome 渲染 + ffmpeg 编码/mux/burn 能力本体 | renderer.go；encode.go | 平台包完整；是否启用见 ②。 |
| ② | 渲染管线受 build tag `capx` 门控 | render_pipeline.go:1 `//go:build capx`；stub.go:1 `//go:build !capx` | 默认构建编译 stub，`Run` 返回 `ErrNotConfigured`（stub.go:17-19）；仓库构建脚本（Makefile:7 `go build ./...`）**未传 `-tags capx`**。worker_test.go:259 注释亦说明测试在两种标签下编译。 |
| ② | TTS / Aligner 适配器已写好但未注入 Ports | tts.go:29-38,59-106；aligner.go:27-34,52-83；main.go:1243-1251 | Ports 结构含 `Synth`/`Aligner`（ports.go:106-107），但装配段未传；example 运行时 `deriveWords` 永远落到 `EstimateWords`（service.go:467-495, 496-507, 508）。 |
| ② | capx 启用门复用 MCP 开关 | main.go:1229 `Enabled: &mcpOn` | 无独立 `CAPX_ENABLED`；未配置时渲染返回结构化 `E_NOT_CONFIGURED`（service.go:694-696），非静默。 |
| ② | 缩略图能力存在但管线未接通 | encode.go:240-258 `ExtractThumbnail`；render_pipeline.go:272-277 桩 | `Render` 结构无 thumbKey 字段（service.go:110-124）；openapi 却声明 `thumb_url`（openapi.yaml:6285-6287）——字段级 spec/code 漂移，check_api 不可见。 |
| ② | 软字幕 SRT 已生成但未封装进 mp4 | render_pipeline.go:111-126 vs 217-231 | 仅 burn 分支被调用；soft 模式当前输出无字幕轨。 |
| ② | 远端渲染扩展点声明未实现 | remote.go（`ErrRemoteNotWired`） | 契约槽位保留，无产品消费。 |
| ③ | 提交响应码 201 而非契约 202；openapi 未声明 Idempotency-Key 参数 | routes.go:211 `StatusCreated`；openapi.yaml:4419 声明 `'202'`；openapi.yaml:4398-4417 请求体无 header 参数定义 | 幂等机制本体已通（见 ① 行）；剩余偏差是状态码与契约文档层：check_api 只比对 method+path，状态码漂移不可见。 |
| ③ | `released_at` 列被 SQL 读写，但未暴露到 Render Go 结构 / API | 迁移 1009:24-25 建列；store.go:43 在 failed/interrupted 转换时 `released_at=now()`，store.go:62-64 读取该列判定释放 claim；service.go:129-131 的 `releasedAt` 私有字段在 SELECT（service.go:782-786, 830-835）中未扫描 | 单次释放守卫由「状态 CAS + released_at claim」共同承担（store.go:38-73；worker.go:345, 354, 213, 252）；缺口仅是该列不进 API 响应，不影响释放正确性。 |
| ③ | 删除项目无 active-render 409 检查 | service.go:420-435 直接 DELETE | 计划 §10.1 / §20 要求有在途渲染时 `E_VIDEO_RENDER_ACTIVE`；当前靠 FK 级联（迁移 1006 `ON DELETE CASCADE`）。 |
| ③ | 资产登记表 / 引用表 / 孤儿 GC 缺失 | 迁移仅 1005 project、1006 render、1008 quota keys、1009 render idem（example/cmd/app/migrations/） | 无 `video_asset` 表、无资产列表/删除端点；上传后素材无引用计数，无回收流程（计划 §11.4）。 |
| ③ | MCP 工具链无角色（authz.CanIn）门 | tools.go `requireToolScope` 仅对 `SourcePAT` 校验 scope，session 直接放行；service.go:165-173 只查 membership | HTTP 路由有 `authz.Require`（routes.go:75-77）；MCP 侧缺等价角色检查。PAT scope 已校验，session 调用的角色边界未在工具层复核。 |
| ③ | 分页 limit/cursor、inspect view 模式未实现 | service.go:374, 858；tools.go（list/inspect 输入无 view/limit/cursor） | 计划 §10.1/§10.2 要求分页与 `view=summary|ir|words|assets`。 |
| ③ | Render 行/响应缺 `attempt`、`warnings`、渲染配方（ffmpeg 版本/滤镜链）；字段名 `output_key` vs 契约 `output_url` 未对齐 | 迁移 1006 列定义；service.go:112-125, 120；openapi.yaml:6267-6289, 6282-6284 | worker 不记录 attempt 序号；降级与警告不落库；出片不可追溯到具体滤镜链。代码 JSON 字段为 `output_key`（service.go:120），契约为 `output_url`（openapi.yaml:6282），check_api 不比对字段名。 |
| ③ | `/mcp` 无 per-principal 限流 | main.go:1504-1514 `apiUserRateLimitMW` 仅挂 `/api/`；`/mcp` 只在 body limit（1495）与超时豁免（1525）内 | 计划 §12.2 要求 `/mcp` per-principal 限制。 |
| ③ | 文件路由仍为多段 `{key...}`，未改为不透明 fileID | routes.go:88；openapi.yaml:4549 | 计划 §10.1 修订要求服务端签发不透明 fileID，解码后查归属；当前直接接受原始对象路径段。 |
| ③ | `ir_sha256` canonical 哈希未持久化 | service.go:307-310（`irBytes` 仅 marshal，无哈希列） | 计划 §5.2 #10；快照去重与配方追溯缺基础字段。注意上传素材键里的 sha256（service.go:928）是内容寻址，不是 IR 快照哈希。 |
| ③ | 无独立 reconciler；heartbeat 仅靠 `updated_at` + river rescue | worker.go:270-286；main.go:1296 | 在途作业存活信号为进度帧每 15 帧更新（worker.go:30, 181-189）；无独立心跳列/超时看门狗。 |

**MCP 工具清单（实测 12 个，tools.go）**：`video_list_projects`、`video_create_project`、`video_inspect`、`video_set_script`、`video_set_words`、`video_add_effect_at_word`、`video_upsert_element`、`video_move_element`、`video_animate_element`、`video_upload_asset`、`video_render`、`video_get_render`。
与计划 §10.2 的 11 工具对照：实现无 `video_move_effect`（以 `video_move_element` 替代）；其余映射关系需在后续章节对齐契约描述。

**HTTP / 预览层约定（已核实）**

- 中间件链：`wsMW`（从 `X-Workspace-Id` 填充 principal 工作区）→ `authz.Require(video:read/write/render)` → `webx.P` 断言（routes.go:62-77）；CSRF 由产品全局 `/api/` 中间件覆盖，路由层不重复挂（routes.go:59-61）。
- 预览文档：`text/html; charset=utf-8`、`Cache-Control: no-store`、CSP `default-src 'none'; script-src <hash>; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-ancestors 'self'`、`nosniff`（routes.go:180-187）。
- 文件服务：先从 `video/<wsID>/...` 前缀解析工作区，成员校验通过后再出字节（routes.go:265-276, 325-331）；本地后端 `http.ServeContent` 支持 Range/HEAD/If-Range，私有不可变缓存 `private, max-age=31536000, immutable`（routes.go:288-316）；svg/html 以 `attachment` 下发（routes.go:27-33, 312-314）。
- WS 事件仅两类：`video.ir.updated`、`video.render.updated`（service.go:41-44）；审计动作 6 条（service.go:47-54）。
- 上传：multipart 单 part，上限 `UploadLimit = 700 KiB`（service.go:59, 899-901；routes.go:236）；MIME 白名单 png/jpeg/gif/webp + mp3/mp4audio/wav（service.go:902-907），仅看声明类型，无 magic bytes 与解码体积校验。

---

### 1.8 能力支持矩阵 —— 全文档唯一能力真值表

**两列判定口径**

- **结构可表达性**：不改业务代码，能否在现 IR 字段内表达该效果的结构（类型存在、层级、时间锚点、承载槽位）。✅ 字段齐备；⚠️ 需用相邻类型或多段拼接近似；⛔ IR 结构上无承载字段。
- **视觉达标性**：按商业案例验收断言（版式、形变、对齐、基线、样式可控）能否达标。✅ 现管线可原样出片；⚠️ 可近似但有可见偏差或手工编排成本；⛔ 不可达。
- 🚫v1 不做项见本节末排除清单。
- 「降级配方」只给一句话方向，细节指向 §1.2/§1.4/§1.5/§1.6/§1.7 对应行，避免与前述章节重复。

| ID | 技术项 | 结构可表达性 | 视觉达标性 | 范围（T-15） | 证据（file:line 或命令） | 现可用降级配方（一句话 + 章节指向） | 目标实现所需扩展（字段级提案） |
|---|---|---|---|---|---|---|---|
| T-01 | 复杂排版与 CJK 字距/换行 | ⚠️ | ⚠️（禁则/字距/行高不可达） | — | Element 仅 text/color/fontSize（ir.go:120-122, 116-130）；CSS 固定 `line-height:1.35`、`pre-wrap`（projector.go:293-296）；无 textAlign/lineHeight/letterSpacing/fontWeight/fontFamily | 整段文本 + 自动换行可出标题/字幕条；行距、字距、对齐、加粗、多字体不可控（§1.4 #1-2）。 | Element 增 `textAlign`、`lineHeight`、`letterSpacing`、`fontWeight`、`fontFamily`；text 内联样式子集（span 级 color/size/bold）；换行规则随字幕折行一并修正。 |
| T-02 | 多图层与层级 | ✅（静态图层次） | ⚠️（轨道级重排不可达） | — | `Element.z`（ir.go:127）→ `zIndex=1+z`（timeline-builder.js:63）；元素上限 64（ir.go:162）；无 trackId（§1.2 tracks[] 行） | 静态底图 + 文字 + 贴纸可直接排；同 z 按数组顺序叠压（§1.3 S3）；轨道级重排、动态换层不可达。 | 动画级换层用 Animation `zTo`；trackId 随 §1.2 轨道模型一并引入。 |
| T-03 | 遮罩 / 裁剪 | ⛔ | ⛔ | — | Element 无 clipPath/mask/overflow 字段（ir.go:116-130）；舞台 `overflow:hidden`（projector.go:287）；shape 仅背景色（timeline-builder.js:53-55） | 外部裁好图片再上传；shape 色块遮挡仅近似，不可做镂空/渐变蒙板。 | Element 增 `clipPath`（inset/ellipse/roundRect）、`maskElementId`、`borderRadius`；shape fill/stroke 双模式与圆角半径字段。 |
| T-04 | 粒子与粒子替代 | ⛔ | ⛔ | — | 元素类型仅 image/text/shape（ir.go:30-34）；无批量实例化/生命周期系统；仅 counter 宿主节点（timeline-builder.js:230-240） | 手工铺若干 shape/image + 动画模拟光点；受 ≤64 元素上限约束，密度与随机分布不可控。 | `elementKind="particles"` 或独立粒子节点 `{count, emissionSec, lifeSec, speed, spread, seed, color[]}`；确定性 seed 保证复现。 |
| T-05 | 伪 3D 透视 | ⚠️（统一 scale+translate 近似轮廓） | ⛔（真梯形/侧边形变不可达；对称缩放近似 ⚠️） | — | 动画类型仅 move/scaleIn/rotate（ir.go:176；timeline-builder.js:112-131）；变换只有 x/y/scale/2D rotation；无 perspective/rotateX/rotateY/skew | scale 曲线模拟远近、rotate 平面旋转；对称缩放近似 ⚠️，无纵深消失点与侧面翻转。 | Element/Animation 增 `rotationX`、`rotationY`、`perspective`、`skewX`、`skewY` 与元素级 `transformOrigin`（§1.3 S2）。 |
| T-06 | 镜头推进 / 平移 | ⚠️ | ⚠️（单层次推拉可现；视差/dolly-zoom ⛔） | — | 无 camera/composition 级变换；舞台视口固定（projector.go:282-289）；运动只能逐元素 move（timeline-builder.js:112-119） | 全元素并行 move/scaleIn 模拟整体推拉（Agent 逐元素编排，无统一相机）；视差、跟随镜头、dolly-zoom 不可做。 | composition/camera 节点 `{panX, panY, zoom, rotation, origin, animation?}`；或 composition 级动画作用于 #canvas 容器。 |
| T-07 | 转场 | ⛔ | ⛔ | — | 单一时间轴 `main`（timeline-builder.js:172）；效果注册表无 transition（ir.go:169-172）；无多 composition | fade 效果在时间点对整幅元素淡入淡出；交叉淡化、擦除、滑动转场不可表达，段间只能硬切。 | `transitions[]` `{atFrame, type: fade/wipe/slide/zoom, durationFrames, fromCompositionId, toCompositionId}`；配套多 composition 与元素时间窗（§1.2）。 |
| T-08 | 路径运动 | ⚠️（两段折线） | ⚠️（样条/切线方向 ⛔） | — | move 仅 `from`/`to` 单点（ir.go:104-105）；GSAP x/y 直线插值（timeline-builder.js:113-119）；无 bezier/关键帧数组 | 多点折线用多段 move 串联；曲线轨迹、圆弧、贝塞尔摆动不可。 | Animation 增 `waypoints[]Point`（逐段 easing）或 `path`（SVG d + 沿路径朝向）。 |
| T-09 | 错峰入场 | ⚠️（词锚+scaleIn/move 可搭错峰结构） | ⛔（无元素时间窗、无 opacity 类型；入场前隐藏依赖 immediateRender，[待验证]；未解析锚点落 0 帧全显） | — | `ElementAnimation.startAnchor`（ir.go:108）；服务端 `AnimateElement` 锚点解析（service.go:641-666）；锚点时间定位（timeline-builder.js:154）；无 startFrame/endFrame（§1.2）；动画类型无 fade/opacity（ir.go:176） | 按词锚点逐个入场可搭结构；入场前隐藏、未解析锚点元素 0 帧全显，验收不可达。 | Animation 增 `delayFrames`；元素时间窗 startFrame/endFrame；入场态隐藏/透明；锚点未解析 fail-closed（§1.2 锚点行）。 |
| T-10 | 数字滚动 | ⚠️（counter 类型在位） | ⛔（节点无 x/y/w/h、样式硬编码，指定版式不可达） | — | counter 效果（ir.go:22）；params `from/to/suffix`（ir.go:312-315）；onUpdate 四舍五入文本（timeline-builder.js:82-91）；counter 宿主节点无布局字段、文本样式硬编码（timeline-builder.js:230-240；projector.go:293-296） | 整数计数器结构在位；指定位置/字号/配色版式不可控。 | counter params 增 `prefix`、`decimals`、`durationSec`、`easing`、布局坐标与样式；千分位格式。 |
| T-11 | 图表生长 | ⚠️（shape+scaleIn 对称生长） | ⛔（transformOrigin 固定中心，基线生长不可达） | — | 无 chart 元素类型（ir.go:30-34）；shape 纯色块（timeline-builder.js:53-55）；scaleIn origin 硬编码 `50% 50%`（timeline-builder.js:123；§1.3 S2） | shape + scaleIn 高度动画手工摆位模拟柱状生长；无坐标轴/数据绑定/折线饼图；基线锚定不可达。 | Element `type="chart"` `{chartType: bar/line/pie, series[], colors[], axis, animateGrowth}`；或工具层「数据 → shape 阵列」高层编排原语。 |
| T-12 | 文字高亮 / 逐词动画 | ⚠️（逐词独立元素替代路径） | ⚠️（原生 highlight 为整层作用域 ⛔；替代路径代价是手工词布局） | — | highlight 背景色透明→color→透明（timeline-builder.js:92-98）；目标为舞台或 counter 宿主（timeline-builder.js:168）；Effect 无 `targetElementId`（ir.go:86-92）；IR 不渲染词级文本层 | 整元素/整舞台高亮可近似；逐词高亮需为每个被高亮词建独立 text 元素并手工对齐时间。 | Effect 增 `targetElementId`；`words[]` 驱动词文本层；highlight params 支持 `range/wordIndex`、颜色与持续帧。 |
| T-13 | 循环 BGM / 响度 | ⚠️ | ⚠️（loop/loudnorm/apad/aresample 均无） | — | AudioTrack `key/durationSec/volume`（ir.go:133-137）；MuxAV `volume` + amix（encode.go:159-175）；volume 校验 [0,1]（ir.go:413-415） | 单次铺设 + 音量衰减可做；短 BGM 不循环、无响度标准化、无 48kHz 重采样、无淡入淡出（§1.5 #1-3）。 | AudioTrack 增 `loop`、`loudness{targetLUFS, truePeak}`、`fadeInSec/fadeOutSec`；MuxAV 增 `-stream_loop`、`apad`、`loudnorm`、`aresample=48000`。 |
| T-14 | 软 / 硬字幕 | ⚠️ | ⚠️（CJK 禁则/词边界折行 ⛔） | — | SRT 由 words 生成（subtitle.go:174-184）；burn 经 libass subtitles（encode.go:206-235，本机 libass 可用，§1.9 #6）；soft 未封装（render_pipeline.go:217-231）；CJK 折行缺陷 §1.4 #1-2 | 硬字幕案例可交付；软字幕轨未接通；CJK 禁则/行首标点避让不可达；字幕样式不可控（§1.5 #10）。 | mov_text 侧车封装；Render 记录 subtitleMode 到配方；字幕样式字段进 IR；soft 降级写 warnings。 |
| T-15 | 缩略图 / 封面帧 | ✅（包内能力在位） | ⛔（firstThumb 恒 nil，服务层未接通） | 包内 ✅；产品端到端 ⛔ | `ExtractThumbnail` 已存在（encode.go:240-258）；管线 `firstThumb` 桩返回 nil（render_pipeline.go:272-277）；Render 无 thumbKey（service.go:110-124）；UI 历史表无封面列（VideoStudioPage.tsx:51-52, 397-403, 722） | capx 层能力存在；服务/装配/UI 三层未接通，v1 历史列表无封面（§1.7 ②）。 | Render 行 `thumb_key` 列 + Render 结构/响应 `thumbKey/thumbUrl`；管线调用 `ExtractThumbnail`；UI 封面列；对齐 openapi `thumb_url`（openapi.yaml:6285-6287）。 |

> **[修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 X-4 / example/internal/video/testdata/spec-audit-report.json X-4）上表 T-10/T-12 行只点名 counter（自建 div 无定位）与 highlight（整层作用域）两类目标定位缺口；实测范围更大**：`timeline-builder.js:182` `var target = fx.type === 'counter' ? counterHost(fx) : canvas;`——**pulse / shake / fade 同样全部作用于 `#canvas` 整层**（5 个 effectBuilder 均无 target 概念，timeline-builder.js:79-112），非 counter 特效不存在任何元素级目标。两列档位不受影响（T-12 视觉列的 ⚠️ 本就按整层作用域计），但事实面收窄：按目标 schema 写的 `targetElementId` 型 effect（如 C06 `ef_pulse_nameA`、`ef_fade_turn`）在现实现下一律全画布生效——pulse 缩放整个画布、fade 把全画面压暗（opacity 0.8）且不复原。各案例涉及行见 §4.2.6 / §4.4.6 修正框。

**矩阵外排除项（🚫v1 不做，本轮不展开）**：远程渲染集群（remote.go 仅扩展点）、视频素材剪辑拼接、AI 生成画面、多语言字幕轨、3D 模型。

**案例交付分级（两列口径汇总，供后续章节排期引用）**

口径说明：旧单列「✅直接可做」按结构可表达性判定，曾把 T-02/T-09/T-10 归入直接交付；拆列后以本表两列为准——**15 项无一在两列同时 ✅**，视觉达标是交付验收的硬门槛。该「仅 3 项直接交付」结论属旧单列口径，**不得再被引用为当前结论**。

- **结构 ✅**：仅 T-02（静态图层次）；其视觉列为 ⚠️（轨道级重排不可达）。
- **结构 ⚠️ / 视觉 ⚠️**：T-01、T-02（视觉列）、T-06、T-08、T-12、T-13、T-14——可拼 demo，存在可见偏差或手工编排成本。
- **视觉 ⛔（结构 ⚠️）**：T-05、T-09、T-10、T-11、T-15（端到端）。
- **双 ⛔（结构与视觉均不可达）**：T-03、T-04、T-07。
- **范围拆分（T-15）**：包内 capx 能力 ✅；产品端到端 ⛔（服务/装配/UI 未接通）。

---

### 1.9 本轮实测记录

日期：2026-11-15（Asia/Shanghai）。环境：Windows，PowerShell；仓库根 `D:\code\ploykit`；root module `github.com/haozing/ploykit`，example module `myproduct`（独立 go.mod，service.go 注释与目录结构一致）。

**代码基线时点**：2026-11-15 13:15（`timeline-builder.js` 等源文件 LastWriteTime）；复核时工作区 git clean，HEAD `d25362e`（2026-11-15 13:32:18 +0800，提交信息「fix(video,capx): 审计漏项补齐——双真值消除/资源失败fail-closed/截图参数钉满」）。本轮期间仓库由并发会话提交过改动；本文 file:line 以该时点磁盘内容为准，builder/validate 代码块行号可能相对旧基线平移 ±十余行，引用前需对照该 commit 复核。

| # | 命令（cwd / 备注） | 关键输出 | exit | 证据 |
|---|---|---|---|---|
| 1 | `go -C example test -count=1 ./internal/video/app`（cwd=`D:\code\ploykit`） | `ok  myproduct/internal/video/app  0.340s` | 0 | [实测] |
| 2 | `go test ./platform/capx`（root module，cwd=`D:\code\ploykit`）；首轮失败后重跑 | 首轮：**FAIL** exit 1，`TestPoolHardCap_NeverExceedsPoolSize` 报 `capx: capx: chrome-stub: GetFileAttributesEx chrome-stub: The system cannot find the file specified`（pool_internal_test.go:29），stderr 另有 5 行 `received DOM.documentUpdated when there's no top-level frame`；全量重跑：`ok  github.com/haozing/ploykit/platform/capx  24.217s`；定向 `-run 'TestFrameSpec|TestPoolHardCap' -v`：两例均 PASS（1.740s） | 重跑 0；首轮 1 | [实测]；首轮失败在定向重跑与全量重跑中均不复现，判为 flaky，根因 [待验证]（疑似真实 Chrome 用例与 stub 池用例并发/共享状态干扰）。 |
| 3 | `python tools/check_api.py`（cwd=`D:\code\ploykit`） | `spec routes: 172  code routes: 172`；`OK: docs/openapi.yaml 与 Go 路由注册零漂移` | 0 | [实测]；扫描范围含 video http 适配层（tools/check_api.py:45） |
| 4 | `git status --short`（cwd=`D:\code\ploykit`） | 空输出（工作区干净，无未提交修改） | 0 | [实测] |
| 5 | `go version` | `go version go1.27.0 windows/amd64` | 0 | [实测] |
| 6 | `ffmpeg -hide_banner -version` | `ffmpeg version N-117763-ge35587250c-20241113`；configuration 含 `--enable-libass --enable-libx264`；`-filters` 同时列出 `ass` 与 `subtitles` | 0 | [实测] |
| 7 | Chrome 路径存在性：`Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"` | `True` | 0 | [实测]（未在本轮启动 headless Chrome 跑完整帧渲染） |
| 8 | 奇数尺寸编码探测（lavfi 生成黑帧 → 裸 libx264/yuv420p → mp4 到管道，不落盘；未带管线 scale 滤镜）：`3x3`、`1x1`；对照 `2x2` | 3×3 与 1×1：`[libx264] width not divisible by 2 (3x3 / 1x1)`，编码器打开失败，exit `-542398533`；2×2 对照 exit `0` | 见左 | [实测]；capx 管线另有 Validate 拒绝 + trunc-to-even 兜底（§1.6），仓库奇数负例见 pool_internal_test.go:72-83。 |

**测试文件清单（本轮读取确认）**

- `example/internal/video/app/`：`ir_test.go`、`projector_test.go`、`service_test.go`、`service_db_test.go`
- `example/internal/video/adapters/http/`：`routes_test.go`
- `example/internal/video/adapters/mcp/`：`tools_test.go`
- `example/internal/video/render/`：`worker_test.go`
- `platform/capx/`：`capx_test.go`、`encode_test.go`、`renderer_test.go`、`pool_internal_test.go`

**环境与改动边界记录**

- 迁移核对：`example/cmd/app/migrations/` 下 video 相关为 1005（project）、1006（render）、1008（quota keys）、1009（render idem：`submission_key` 部分唯一索引 + `quota_period` + `released_at`）、1010（drop script column）；无 `video_asset` 表 [代码]。
- 本任务只在 agent 工作区写入本产物与探针临时文件（`probe.txt`、`ffprobe.txt`、`linecount.txt` 等，均在本 agent workspace 内）；未对 `D:\code\ploykit` 仓库执行任何写、暂存或提交。§1.9 第 4 行 `git status --short` 空输出为本任务测量时点的真实结果。
- 并发会话改动已随 commit `d25362e` 提交，复核时 `git status --porcelain` 为空；涉及 `example/internal/video/app/ir.go`、`projector.go`、`projector_test.go`、`service.go`、`timeline-builder.js`、`platform/capx/renderer.go` 与迁移 `1010_video_drop_script_column.up.sql` / `.down.sql`。本文结论与 file:line 以基线时点磁盘内容为准。
- 命令执行模块划分：root module（`github.com/haozing/ploykit`）运行 `go test ./platform/capx`；example 为独立 module（`myproduct`），视频 app 测试须 `go -C example test ./internal/video/app`，跨模块直接在 root 跑不到 example 包 [代码]（两个 go.mod 头部）。

**本轮未执行 / 未能验证的项（如实记录，未拿历史结论冒充）**

| 项 | 状态 | 原因 / 应在何环境执行何命令 |
|---|---|---|
| `go test -race ./platform/capx` | [待验证] | 本轮按任务清单只跑了普通 `go test`；计划 §16.2 要求 race 检测（stderr buffer、pipe、pool）。应在 root module 执行 `go test -race ./platform/capx`。 |
| `make test-db`（含 `service_db_test.go`、worker 故障注入测试） | [待验证] | 需要 PostgreSQL（计划 §16.4：先 `make -C example db-up`）；本轮未启动数据库。 |
| `make verify-ui`（packages/ui vitest） | [待验证] | 需要 Node/npm 依赖；本轮未执行前端测试。 |
| 端到端真实出片（Chrome 帧捕获 → mp4） | [待验证] | 默认构建未带 `-tags capx`（§1.7 ②）；需以 capx 标签构建 example、启动 DB 与 River worker，提交一次渲染观察全链路。本机 Chrome/FFmpeg 已就位，缺的是带标签的运行装配。 |
| 固定镜像 golden 逐字节一致（计划 §16.2，100 帧比对） | [待验证] | 仓库未见 golden 镜像测试；需在集成环境补基线帧与比对用例。 |
| `/mcp` per-principal 限流、PAT 跨 workspace 越权、session MCP 拒绝等安全用例 | [待验证] | 需运行中的服务 + 会话/PAT 两类凭证；代码层缺口见 §1.7 ③。 |
| 软字幕 mov_text 封装、loudnorm、BGM 循环、缩略图提取的实际输出 | [待验证] | 对应能力在当前管线未接通（§1.5、§1.7 ②），无现成可跑路径。 |

## 2. 案例库总览、覆盖矩阵与执行组合

### 2.1 案例索引

九个案例覆盖八类真实内容。时长、画幅、fps 都是渠道硬规格，不是审美选择。

| ID | 名称 | 内容类型 | 画幅 | fps | 时长 | 帧数（ceil） | 语言 | 主要技术项 | 优先级 |
|---|---|---|---|---|---|---|---|---|---|
| VS-C01 | 短视频带货 | 电商转化 | 1080×1920 | 30 | 15s | 450 | 中文 | T-09 T-10 T-12 T-03 | P0 |
| VS-C02 | 品牌发布 | 品牌 TVC | 1920×1080 | 25 | 30s | 750 | 中英混排 | T-05 T-06 T-07 T-01 T-13 | P1 |
| VS-C03 | 知识科普 | 解说图解 | 1080×1920 | 30 | 45s | 1350 | 中文 | T-11 T-01 T-12 T-02 | P1 |
| VS-C04 | 数据可视化口播 | 数据新闻 | 1920×1080 | 30 | 60s | 1800 | 中文 | T-11 T-10 T-06 T-15 | P0 |
| VS-C05 | 旅行生活方式 | 生活纪录 | 1080×1920 | 30 | 30s | 900 | 中文 | T-08 T-03 T-09 T-13 | P2 |
| VS-C06 | 访谈字幕 | 访谈纪实 | 1920×1080 | 25 | 90s | 2250 | 中英双语 | T-14 T-01 T-02 T-07 | P0 |
| VS-C07 | 招聘企业宣传 | 组织形象 | 1920×1080 | 30 | 40s | 1200 | 中文 | T-10 T-09 T-02 T-01 | P2 |
| VS-C08 | 节日促销 | 促销活动 | 1080×1080 | 30 | 20s | 600 | 中文 | T-04 T-10 T-09 T-05 | P2 |
| VS-C09 | 产品功能演示 | 软件教学 | 1920×1080 | 30 | 50s | 1500 | 中文 | T-03 T-08 T-09 T-12 | P1 |

合计 **10800 帧 / 380 秒（6 分 20 秒）**的有效素材量（450+750+1350+1800+900+2250+1200+600+1500 = 10800；时长 15+30+45+60+30+90+40+20+50 = 380s）。这个数字是 L3 全量回归的帧数基数，直接决定 §7.8 的成本。

> 帧数口径：验收口径为 `durationFrames = ceil(durationSec * fps)`。Player 侧已在 HEAD `d25362e`（2026-11-15）改用 `Math.ceil`（`timeline-builder.js:37`，`[代码]`），与 Go 服务端一致；历史上曾用 `Math.round` 并在 8.04s@30fps 上差 1 帧（241 vs 242），该差异已消除。**但这不能成为删掉一致性断言的理由**：两侧任一改动都会立刻暴露，L0 必须保留该用例。

优先级依据（不是排期偏好，是可计算的三个维度）：

| 优先级 | 判据 | 命中案例 |
|---|---|---|
| P0 | 断言可高度自动化 + 覆盖当前最大缺口 + 渠道价值最高，任一维度最差都要先做 | C01（数字与价格断言最硬，且直接触 T-10 缺陷）、C04（图表生长断言可量化）、C06（字幕链路最长，最易暴露 CJK 断行缺陷） |
| P1 | 断言部分可自动化，需要 DOM 层或人工复核 | C02、C03、C09 |
| P2 | 视觉主观权重高、自动化只能覆盖结构层 | C05、C07、C08 |

### 2.2 覆盖矩阵（规划覆盖；实际命中以 §3 / §4 各案例正文为准）

**技术项覆盖**：●=该案例必须命中（验收必查），○=该案例会用到但不作为验收重点，—=不用。

| 案例 | T-01 | T-02 | T-03 | T-04 | T-05 | T-06 | T-07 | T-08 | T-09 | T-10 | T-11 | T-12 | T-13 | T-14 | T-15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C01 | ○ | ○ | ● | — | — | — | — | — | ● | ● | — | ● | ○ | ○ | ○ |
| C02 | ● | ○ | ○ | — | ● | ● | ● | — | ○ | — | — | ○ | ● | — | ○ |
| C03 | ● | ● | — | — | — | — | — | — | ○ | — | ● | ● | ○ | ○ | — |
| C04 | ○ | ○ | — | — | — | ● | ○ | — | ○ | ● | ● | — | ○ | — | ● |
| C05 | ○ | ○ | ● | — | — | — | — | ● | ● | — | — | — | ● | ○ | ○ |
| C06 | ● | ● | — | — | — | — | ● | — | — | — | — | ○ | ○ | ● | ○ |
| C07 | ● | ● | ○ | — | — | — | ○ | — | ● | ● | — | — | ○ | ○ | — |
| C08 | ○ | ○ | ○ | ● | ● | — | ○ | — | ● | ● | — | — | ○ | — | ○ |
| C09 | ○ | ○ | ● | — | — | ○ | — | ● | ● | — | — | ● | ○ | ○ | ● |

十五个技术项全部至少有一个 ● 命中点；T-04（粒子）、T-05（伪 3D）、T-07（转场）、T-14（软/硬字幕）四项的命中密度最低，各只有一个 ●，这是刻意的：它们当前多为 ⛔，堆案例只会放大阻塞面。它们的现状与降级配方集中在 §5。

**内容类型覆盖**（对应真实交付场景，不是标签）：

| 场景 | 案例 | 渠道特征 | 判据差异 |
|---|---|---|---|
| 电商信息流 | C01 | 首帧钩子决定完播，价格与卖点必须在前 3 秒 | 数字与价格区域断言最硬 |
| 品牌发布 | C02 | 时长宽裕、镜头运动密集、结尾定格 | 运动连续性 + 品牌色一致性 |
| 知识科普 | C03 | 术语密度高、注释层级多 | 排版与断行断言最硬 |
| 数据新闻 | C04 | 数据必须可溯源、口径要标注 | 图表生长与数值一致性 |
| 生活方式 | C05 | 画面主导、文字克制 | 裁切构图与色调一致性 |
| 访谈纪实 | C06 | 字幕是主信息载体 | 字幕时序与断行正确性 |
| 组织形象 | C07 | 信息密集、分栏排版 | 分栏对齐与错峰节奏 |
| 促销活动 | C08 | 强节奏、高对比 | 卡点与元素数量上限 |
| 软件教学 | C09 | 操作路径必须可跟随 | 光标路径与取景框准确性 |

**故障与安全覆盖**：故障用例不按案例平摊，而是按"故障触发的代码路径"分布——IR 校验类挂 L0，渲染资源类挂 L1/L2，worker/配额/越权类挂 §6 的集成用例。九个案例至少各贡献 2 条失败注入（写在各自「失败注入」块），其余由 §6 统一补足；不得用"每个案例都注入一次图片 404"来假装覆盖。

### 2.3 里程碑划分

同一批案例在不同能力状态下的验收结论不同，必须分里程碑登记，否则会把"降级版能出片"当成"功能达标"。

| 里程碑 | 定义 | 进入条件 | 通过判据 |
|---|---|---|---|
| M1 降级可出片 | 用现 IR 能构造出结构正确的成片，允许已登记的视觉误差 | 本机 Go/Chrome/FFmpeg 可用（本轮已验证三件套齐全，见 §1.9） | L0 + L1 全绿；L2 至少 3 个 P0 案例出片且音轨存在 |
| M2 扩展后达标 | §5.16 提案中被判为 P0 的字段落地后，⛔ 项转 ✅/⚠️ | M1 通过 + IR 扩展合入 | 9 案例 L1/L2 全绿，人工验收点全部通过 |
| M3 全量回归 | 完整成片 + 逐像素 + 性能稳定性 | M2 通过 + 固定渲染镜像就绪 | L3/L4/L5 全绿，§7.3 阈值全达标 |

### 2.4 案例到执行矩阵的组合规则

- **L1（still）**：每案例取 8–12 个关键帧，即"分镜切换点 + 每个技术项的生效帧 + 首末帧"。九个案例落 90 个左右 still，是成本最低、最能钉住回归的一层。
- **L2（短片段）**：每案例只切 **一段 ≤5s** 的代表片段，优先选技术项密度最高的镜（例如 C01 的价格卡段、C04 的柱状生长段、C06 的说话人切换段）。用 L2 验证"编码 + 音轨 + 字幕 mux"，不用它验证完整叙事。
- **L3（完整成片）**：九案例全量，只做"结构与时长正确"，不做逐像素。
- **L4（逐像素/DOM）**：只对 P0 三案 + 一例 P2 做，避免把 9×N 的像素比对变成维护负担；DOM 断言（`getBoundingClientRect`、`TextMetrics`）对所有案例都便宜，可以全上。
- **L5（性能与稳定性）**：取最长案例（C06，2250 帧）与最密案例（C08，元素/特效密度最高）做并发与长时稳定性，其余案例不参与。

这条组合规则的目的只有一个：**让每一层只回答它能回答的问题**。用 L3 的成片去判像素，等于没有基线；用 L1 的 still 去判音轨，等于没测。

### 2.5 案例与文档其他章节的映射

| 想知道 | 去哪 |
|---|---|
| 某个技术项在现 IR 上是什么状态、降级怎么写、怎么断言 | §5 对应小节（T-01→§5.1 … T-15→§5.15） |
| 某个能力缺什么字段 | §1.2 差异矩阵 + §5.16 提案汇总 + §1.8 矩阵末列 |
| 案例的失败注入对应哪条故障 | §6 同名场景（如"资源缺失""重复提交""无 libass"） |
| 案例的断言怎么落地成代码 | 附录 B 断言规范 + §7 各层 |
| 成本、耗时、机器要求 | §7.6 与 §7.8 |

## 3. 案例集 A：转化与商业

> 本章节为 Video Studio「真实商业内容案例库」案例集 A：带货短视频、品牌 TVC、招聘/企业宣传、节日促销。写作契约继承共享基线 `baseline-v0.md`：证据三态 `[实测]/[代码]/[外部]/[待验证]`；技术项 ID 全文档共用（T-01 排版字距换行、T-02 多图层、T-03 遮罩裁剪、T-04 粒子、T-05 伪 3D、T-06 镜头推进、T-07 转场、T-08 路径运动、T-09 错峰入场、T-10 数字滚动、T-11 图表生长、T-12 逐词高亮、T-13 BGM 循环响度、T-14 字幕、T-15 封面帧）。
> 帧基准：目标 schema `durationFrames=ceil(durationSec×fps)`（架构文档 §5.2）；现实现为 `Math.round`（`[代码] timeline-builder.js:41`）。四个案例时长×帧率均为整数乘积，ceil 与 round 一致。IR 为输入规格，按目标 schema 书写；每案 §4 给出现 IR + 现 Player 的降级差异。案例 IR 尚未渲染验证，不构成能力承诺。断言编号 `A-<案例>-<序号>`，故障用例 `F-<域>-<序号>`，层级 L0–L5 见基线 §6。

### 3.1 VS-C01 短视频带货

#### 3.1.1 案例头

| 字段 | 值 |
|---|---|
| 案例 ID / 名称 | VS-C01 短视频带货（便携榨汁杯 VitaGo Mini） |
| 内容类型 | 电商信息流带货（口播 + 卖点卡 + 价格转化） |
| 目标受众 | 25–35 岁女性，关注早餐效率与家居小电器，价格敏感 |
| 发布渠道 | 抖音信息流竖屏 |
| 画幅 / fps / 时长 | 1080×1920 / 30 / 15.00 s（ceil=450，round=450） |
| 语言 | 中文普通话 + 型号词 `USB-C` |
| 优先级 / 依赖 | P0；无依赖，被 C08 参照券面样式 |

#### 3.1.2 创作规格

**主张**：痛点钩子开场，三张卖点卡错峰立住产品力，末段价格与销量滚动收口到购物车。**场景**：单手竖屏信息流，前 0.8 s 完成钩子，价格与行动指令放最后 2 s。

**渠道硬规格**：1080×1920、30 fps、15 s；上下安全区各 220 px、左右各 60 px；首帧 F0–F8 全屏奶白底 + 产品居中 + 大字"早餐来不及？"；封面帧取 F36（t=1.20 s，产品已 decode、标题完整、卖点卡未切换）。平台二次转码码率 `[待验证]`（渠道无稳定公开数值，以上传实测为准）；卖点卡用大色块粗字重，避免 1 px 细描边与纯黑底。

**逐句脚本（成稿）**：
- S1（0.00–2.05）早餐来不及？一只杯子五分钟出汁。
- S2（2.60–5.05）三倍搅打力，六叶刀头，果肉纤维打细不残留。
- S3（5.20–6.77）USB-C 充电，一次充电打十五杯。
- S4（7.80–9.25）杯身防水，冲一冲就干净。
- S5（10.40–12.55）日常一百二十九，券后七十九，已售一万两千六百多件。
- S6（13.00–14.62）点下方购物车，今天下单再送清洁刷。

**分镜表**（30 fps，末帧 449，帧号左闭右闭）：

| 镜号 | 帧范围 | 画面 | 图层/元素 | 动效与锚点词 | 字幕/音频 |
|---|---|---|---|---|---|
| 1 | F0–F77 | 奶白底，产品居中悬浮，顶部钩子标题 | el_bg / el_product / el_headline | 标题 scaleIn；产品微浮 move；锚点"五分钟"(w04) | S1；硬字幕；BGM 起 |
| 2 | F78–F155 | 卖点卡 A（三倍搅打力）滑入落定，产品缩至卡左 | el_cardA / el_product | 卡 A 错峰 scaleIn（T-09）；锚点"三倍"(w05)；高亮 T-12 | S2；字幕"三倍搅打力 / 六叶刀头" |
| 3 | F156–F233 | 卖点卡 B（USB-C 续航）入场，卡 A 退出 | el_cardB / el_cardA | 卡 B 错峰入场；锚点"充电"(w10/w11 重复词) | S3；字幕"USB-C 充电 / 一次打十五杯" |
| 4 | F234–F311 | 卖点卡 C（防水易洗）入场，配水流线条 | el_cardC / el_product | 卡 C 错峰入场；锚点"防水"(w14)；高亮 T-12 | S4；字幕"杯身防水 / 冲一冲就干净" |
| 5 | F312–F389 | 价格区：日常价划线 + 到手价橙字；销量滚动 | el_price（含销量行） | counter 8,200→12,600（T-10）；跨词锚点"券后七十九"(w17+w18) | S5；字幕"日常 ¥129 / 券后 ¥79" |
| 6 | F390–F449 | CTA 条 + 产品回居中；F445 起整片压暗 | el_cta / el_product | CTA scaleIn+move；F445 整片 fade（目标字段） | S6；字幕"下单送清洁刷"；BGM 收尾 |

**版式**：纵向四段——标题 y180–420、产品 y500–1080、卡面 y1120–1500、价格/CTA y1540–1880。字号：钩子 76/900、卡标题 56/800、卡说明 34/500、到手价 96/900、CTA 38/700；行高标题 1.25 / 说明 1.45；标题居中、价格左对齐、CTA 居中。字幕底部 y1600–1680，≤16 rune/行、≤2 行、单 cue ≤6 s（`[代码] subtitle.go:16-20`）。

**色彩**：背景 `#FFF7EE`；主文字 `#2B2118`；强调橙 `#FF6A3D`；辅助绿 `#1E9E62`；卡面 `#FFFFFF`。对比度目标对白底 ≥4.5:1（WCAG AA，`[外部] https://www.w3.org/TR/WCAG21/#contrast-minimum`）；实测比值 `[待验证]`，以 L1 Chrome DevTools 对比度为准。

**字体**：中文 `Noto Sans SC`（回退 `PingFang SC, Microsoft YaHei, sans-serif`）500/700/900；英文 `Inter` 600；无 emoji（购物车用 shape 替代），无 CJK 扩展生僻字。

**素材清单**：`video/c01/product-main.png`（榨汁杯主图，1080×1080 PNG ≤1 MiB，品牌方授权示例）；`video/c01/bgm-upbeat-128.m4a`（BGM，44.1 kHz / 128 BPM / ≤900 KiB，商用订阅示例）。

**音频**：voice `azure-tts / zh-CN-XiaoxiaoNeural`，rate 1.10，-14 LUFS；BGM 128 BPM、音量 0.18、目标循环，整片 -16 LUFS。现实现差异：MuxAV 无 loop/loudnorm/apad/aresample（`[代码] encode.go:147-185`）；预览不创建 audio 节点，IR.audio 仅作时长基准（`[代码] timeline-builder.js:36-40`）。**字幕**：硬字幕 burn-in；逐词高亮仅"三倍/五分钟/防水"；断行缺陷见 `[代码] subtitle.go:66-96`，L1 帧检查词不被切散。

#### 3.1.3 IR 规格（目标 schema）

```json
{
  "schemaVersion": 1,
  "meta": {"width": 1080, "height": 1920, "fps": 30, "durationSec": 15.0, "background": "#FFF7EE"},
  "script": "早餐来不及？一只杯子五分钟出汁。三倍搅打力，六叶刀头，果肉纤维打细不残留。USB-C 充电，一次充电打十五杯。杯身防水，冲一冲就干净。日常一百二十九，券后七十九，已售一万两千六百多件。点下方购物车，今天下单再送清洁刷。",
  "words": [{"id": "w01", "index": 0, "start": 0.0, "end": 0.4, "text": "早餐", "source": "aligner", "confidence": 0.97, "scriptStart": 0, "scriptEnd": 2}, {"id": "w02", "index": 1, "start": 0.4, "end": 0.86, "text": "来不及", "source": "aligner", "confidence": 0.96, "scriptStart": 2, "scriptEnd": 5}, {"id": "w03", "index": 2, "start": 1.15, "end": 1.4, "text": "杯子", "source": "aligner", "confidence": 0.95, "scriptStart": 8, "scriptEnd": 10}, {"id": "w04", "index": 3, "start": 1.4, "end": 1.72, "text": "五分钟", "source": "aligner", "confidence": 0.98, "scriptStart": 10, "scriptEnd": 13}, {"id": "w05", "index": 4, "start": 2.6, "end": 2.9, "text": "三倍", "source": "aligner", "confidence": 0.99, "scriptStart": 17, "scriptEnd": 19}, {"id": "w06", "index": 5, "start": 2.9, "end": 3.3, "text": "搅打力", "source": "aligner", "confidence": 0.95, "scriptStart": 19, "scriptEnd": 22}, {"id": "w07", "index": 6, "start": 3.78, "end": 4.04, "text": "果肉", "source": "aligner", "confidence": 0.96, "scriptStart": 28, "scriptEnd": 30}, {"id": "w08", "index": 7, "start": 4.28, "end": 4.52, "text": "打细", "source": "aligner", "confidence": 0.94, "scriptStart": 32, "scriptEnd": 34}, {"id": "w09", "index": 8, "start": 5.2, "end": 5.62, "text": "USB-C", "source": "manual", "confidence": 0.99, "scriptStart": 39, "scriptEnd": 44}, {"id": "w10", "index": 9, "start": 5.62, "end": 5.86, "text": "充电", "source": "aligner", "confidence": 0.97, "scriptStart": 45, "scriptEnd": 47}, {"id": "w11", "index": 10, "start": 6.13, "end": 6.37, "text": "充电", "source": "aligner", "confidence": 0.97, "scriptStart": 50, "scriptEnd": 52}, {"id": "w12", "index": 11, "start": 6.37, "end": 6.77, "text": "十五杯", "source": "aligner", "confidence": 0.95, "scriptStart": 52, "scriptEnd": 55}, {"id": "w13", "index": 12, "start": 7.8, "end": 8.08, "text": "杯身", "source": "aligner", "confidence": 0.96, "scriptStart": 56, "scriptEnd": 58}, {"id": "w14", "index": 13, "start": 8.08, "end": 8.35, "text": "防水", "source": "aligner", "confidence": 0.98, "scriptStart": 58, "scriptEnd": 60}, {"id": "w15", "index": 14, "start": 8.75, "end": 9.25, "text": "就干净", "source": "aligner", "confidence": 0.95, "scriptStart": 64, "scriptEnd": 67}, {"id": "w16", "index": 15, "start": 10.64, "end": 11.06, "text": "一百二十九", "source": "aligner", "confidence": 0.93, "scriptStart": 70, "scriptEnd": 75}, {"id": "w17", "index": 16, "start": 11.1, "end": 11.3, "text": "券后", "source": "aligner", "confidence": 0.97, "scriptStart": 76, "scriptEnd": 78}, {"id": "w18", "index": 17, "start": 11.3, "end": 11.66, "text": "七十九", "source": "aligner", "confidence": 0.96, "scriptStart": 78, "scriptEnd": 81}, {"id": "w19", "index": 18, "start": 11.92, "end": 12.55, "text": "一万两千六百多件", "source": "aligner", "confidence": 0.9, "scriptStart": 84, "scriptEnd": 93}, {"id": "w20", "index": 19, "start": 14.23, "end": 14.62, "text": "清洁刷", "source": "aligner", "confidence": 0.95, "scriptStart": 107, "scriptEnd": 110}],
  "tracks": [{"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_cards", "kind": "overlay", "z": 10}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.18, "assetKey": "video/c01/bgm-upbeat-128.m4a"}],
  "elements": [
    {"id": "el_bg", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 449, "params": {"x": 0, "y": 0, "w": 1080, "h": 1920, "color": "#FFF7EE"}},
    {"id": "el_product", "type": "image", "trackId": "tr_main", "startFrame": 0, "endFrame": 449, "src": "video/c01/product-main.png", "params": {"x": 340, "y": 500, "w": 400, "h": 560, "anchor": "center"}},
    {"id": "el_headline", "type": "text", "trackId": "tr_main", "startFrame": 0, "endFrame": 155, "params": {"text": "早餐来不及？", "x": 60, "y": 180, "w": 960, "h": 240, "fontSize": 76, "fontWeight": 900, "color": "#2B2118", "textAlign": "center", "lineHeight": 1.25}},
    {"id": "el_cardA", "type": "shape", "trackId": "tr_cards", "startFrame": 78, "endFrame": 155, "params": {"x": 90, "y": 1120, "w": 900, "h": 380, "color": "#FFFFFF", "mask": {"type": "roundedRect", "rx": 32}, "title": "三倍搅打力", "body": "六叶刀头，果肉纤维打细不残留", "accent": "#FF6A3D"}},
    {"id": "el_cardB", "type": "shape", "trackId": "tr_cards", "startFrame": 156, "endFrame": 233, "params": {"x": 90, "y": 1120, "w": 900, "h": 380, "color": "#FFFFFF", "mask": {"type": "roundedRect", "rx": 32}, "title": "USB-C 充电", "body": "一次充电打十五杯", "accent": "#1E9E62"}},
    {"id": "el_cardC", "type": "shape", "trackId": "tr_cards", "startFrame": 234, "endFrame": 311, "params": {"x": 90, "y": 1120, "w": 900, "h": 380, "color": "#FFFFFF", "mask": {"type": "roundedRect", "rx": 32}, "title": "杯身防水", "body": "冲一冲就干净", "accent": "#1E9E62"}},
    {"id": "el_price", "type": "text", "trackId": "tr_cards", "startFrame": 312, "endFrame": 449, "params": {"text": "券后 ¥79", "subText": "已售 12,600 件", "x": 90, "y": 1560, "w": 900, "h": 160, "fontSize": 96, "fontWeight": 900, "color": "#FF6A3D", "strikeText": "日常 ¥129", "textAlign": "left"}},
    {"id": "el_cta", "type": "shape", "trackId": "tr_cards", "startFrame": 390, "endFrame": 449, "params": {"x": 90, "y": 1780, "w": 900, "h": 100, "color": "#FF6A3D", "text": "点下方购物车 · 下单送清洁刷", "textColor": "#FFFFFF", "fontSize": 38, "fontWeight": 700, "textAlign": "center"}}
  ],
  "animations": [
    {"id": "an_headline_in", "targetElementId": "el_headline", "type": "scaleIn", "startFrame": 0, "durationFrames": 12, "fromValue": 0, "toValue": 1, "easing": "power2.out"},
    {"id": "an_product_float", "targetElementId": "el_product", "type": "move", "startFrame": 6, "durationFrames": 72, "from": {"y": 500}, "to": {"y": 486}, "easing": "power1.out"},
    {"id": "an_cardA_in", "targetElementId": "el_cardA", "type": "scaleIn", "startFrame": 78, "durationFrames": 15, "fromValue": 0, "toValue": 1, "easing": "back.out"},
    {"id": "an_cardB_in", "targetElementId": "el_cardB", "type": "scaleIn", "startFrame": 156, "durationFrames": 15, "fromValue": 0, "toValue": 1, "easing": "back.out"},
    {"id": "an_cardC_in", "targetElementId": "el_cardC", "type": "scaleIn", "startFrame": 234, "durationFrames": 15, "fromValue": 0, "toValue": 1, "easing": "back.out"},
    {"id": "an_cta_in", "targetElementId": "el_cta", "type": "move", "startFrame": 390, "durationFrames": 10, "from": {"y": 1840}, "to": {"y": 1780}, "easing": "power2.out"}
  ],
  "effects": [
    {"id": "ef_hook", "type": "highlight", "targetElementId": "el_headline", "anchor": {"wordId": "w04", "lastText": "五分钟", "lastIndex": 3, "resolvedFrom": "exact", "status": "resolved"}, "params": {"color": "#FFD166"}},
    {"id": "ef_sales", "type": "counter", "targetElementId": "el_price", "anchor": {"wordId": "w19", "lastText": "一万两千六百多件", "lastIndex": 18, "resolvedFrom": "exact", "status": "resolved"}, "params": {"from": 8200, "to": 12600, "suffix": " 件"}},
    {"id": "ef_kw1", "type": "highlight", "targetElementId": "el_cardA", "anchor": {"wordId": "w05", "lastText": "三倍", "lastIndex": 4, "resolvedFrom": "exact", "status": "resolved"}, "params": {"color": "#FFD166"}},
    {"id": "ef_kw3", "type": "highlight", "targetElementId": "el_cardC", "anchor": {"wordId": "w14", "lastText": "防水", "lastIndex": 13, "resolvedFrom": "exact", "status": "resolved"}, "params": {"color": "#FFD166"}}
  ],
  "assets": [
    {"key": "video/c01/product-main.png", "kind": "image", "bytes": 860000, "license": "品牌方授权（示例）"},
    {"key": "video/c01/bgm-upbeat-128.m4a", "kind": "audio", "bytes": 940000, "license": "商用订阅（示例）"}
  ],
  "render": {"width": 1080, "height": 1920, "fps": 30, "crf": 18, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "hard", "fontSizePx": 52, "maxLineRunes": 16, "maxLines": 2}, "thumbnail": {"atSec": 1.2}}
}
```

> 锚点：重复词"充电" w10(occurrence=0)/w11(occurrence=1)；跨词锚点"券后七十九" w17+w18，ef_sales 按 w19 解析。锚点解析 exact→same_text→nearest→missing（`[代码] ir.go:500-575`）；重复词无 occurrence 在目标 schema 下返回 `E_VIDEO_ANCHOR_AMBIGUOUS`（架构文档 §10.5）。`scriptStart/End` 为 code point 偏移示例，落库前由对齐器重算。

#### 3.1.4 现状降级映射

| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-09 错峰入场（3 张卖点卡） | `elements[].startFrame/endFrame` + 每卡独立起始帧 | 元素无显隐区间，一次性 append（`[代码] timeline-builder.js:143-180`）；入场仅靠 `scaleIn from 0`/`move`；动画类型仅 move/scaleIn/rotate（`[代码] ir.go:100-116`），无 opacity 类型 | ⚠️ | 三卡 DOM 中从 F0 存在，未入场卡 scale=0 占位；锚点未解析的动画静默落 0 帧（`[代码] timeline-builder.js:186-187`），三卡会同时显现 |
| T-10 数字滚动（销量；价格为静态大字） | `counter` + `targetElementId` + 元素级定位 | 现 IR 有 counter（`[代码] ir.go:19-26`），但自建 `<div id="counter-<fxId>">` 无 x/y/w/h，仅 96 px/700（`[代码] timeline-builder.js:232-241`） | ⚠️ | 数字出现在画布左上原点，不在 el_price 区域；字号不可配；后缀可配（`[代码] ir.go:322-345`） |
| T-12 逐词高亮（三倍/五分钟/防水） | `highlight` + `targetElementId` + 词文本层词内上色 | 现 highlight 作用于整层 `#canvas`，非元素/非词（`[代码] timeline-builder.js:190`） | ⚠️ | 高亮是整屏底色闪现，不是目标词变色；锚点 missing 时 effect 直接 skip（`[代码] timeline-builder.js:191`） |
| T-03 遮罩裁剪（卡圆角 rx=32 / 局部裁切窗） | `params.mask{type:"roundedRect",rx}`、`clipPath` | 元素类型仅 image/text/shape（`[代码] ir.go:118-134`），无 mask 字段；圆角需素材侧透明 PNG 或直角 shape 近似 | ⛔ | 不生成 CSS mask 节点；卡为直角矩形；局部圆窗裁切必须预置裁切素材。CSS Masking `[外部] https://www.w3.org/TR/css-masking-1/` |
| T-02 多图层 | `tracks[]` + `trackId` + 轨道显隐 | 现 IR 无 trackId；层级靠元素 `z` + append 顺序（`[代码] ir.go:118-134`） | ⚠️ | 不能按轨道整体显隐；跨轨道批量退出需逐元素写动画 |
| T-13 BGM 循环与响度 | bgm 循环 + loudnorm -16 LUFS | MuxAV 无 loop/loudnorm/apad/aresample（`[代码] encode.go:147-185`）；预览无 audio 节点（`[代码] timeline-builder.js:36-40`） | ⛔ | BGM 被 `amix duration=first` 截到人声时长，不循环；响度未归一；预览无声 |
| 动画参数位置（from/to/easing） | 目标 schema：`params.from/to/easing`；现实现：`ElementAnimation` 读顶层 `from/to/fromValue/toValue/easing`（`[代码] ir.go:100-116`） | 案例 IR 以顶层为准：move 用顶层 `from/to`，scaleIn/rotate 用顶层 `fromValue/toValue`，`easing` 顶层；其余 extras 仍进 `extra` | ⚠️ | 若把三键放回 `params`，入场/缩放静默落 0 帧；顶层写法与现实现一致 |
| 复合参数键（§5.16 P2-7/P2-8 提案） | `params.mask/title/body/accent/subText/strikeText/textColor` | 现 builder 仅消费 image/text/shape 标准坐标与字号字段，复合键落 `extra`（`[代码] ir.go:118-134`） | ⛔ 依赖 §5.16 P2-7/P2-8 提案 | 现 builder 不消费这些键，画面不出现对应效果（卡面文案、划线价、副文案须素材侧预置） |

#### 3.1.5 预期帧表

> **[口径 round2]（依据 §7.0 时钟基准裁定）本表按词锚重算**：C01 的动画锚定 `words[].start`（L1 夹具词表见 `testdata/l1_render_test.go:100-120`，与 §3.1.3 words 表一致），帧号 = `ceil(词.start × 30)`。C01 特殊性：目标 schema 的入场动画（卡 A/B/C 错峰 F78/F156/F234、CTA F390）在降级 IR 中**均无 startAnchor、从 t=0 起**（l1 夹具注释"all anims from t=0"），因此这些行的词锚推导值没有对应动画——行号标注的是"若按词锚回填 IR 时应挂的锚帧"；真正由词锚驱动的是 effects（ef_hook 高亮"五分钟"、ef_kw1"三倍"、ef_kw3"防水"、ef_sales counter"一万两千六百多件"）。差异 >±30 帧的行加 ⚠️。

| 帧号（原表） | 词锚推导 `[口径 round2]` | 时刻 | 期望画面状态 | 断言类型 |
|---|---|---|---|---|
| F0 | **F0**（推导=0） | 0.00 | 背景铺满；标题 scale=0；产品待 decode；卡面/CTA 未入场（l1 实测降级差异：价格文本与 CTA 条 F0 已在屏——无显隐区间） | DOM：9 元素挂载；帧：标题区前景占比 < 5% |
| F12 | **F12**（an_headline_in 无锚从 0 起，12 帧落定 →12，推导一致） | 0.40 | 标题 scale=1 落定；产品在上浮 | 帧：标题区 (60,180,960,240) 深色像素 ≥18%（l1 实测 3.4%，目标值待 T-01 后重标定）；A-C01-01 |
| ⚠️ F77 | **F78**（77→78，+1） | 2.60 | 卡 A 未入场（scale=0）；产品居中。词锚节拍："三倍"（w05，卡 A 锚词）@2.6s：2.6×30=78→**F78**——卡 A 入场若按词锚回填 IR（挂 startAnchor"三倍"），锚帧是 78，原 77 差 1 帧属镜号边界 vs 锚帧的口径差。现实现降级：卡从 F0 挂载且动画从 t=0 起，F77/F90 均已满入场（l1 实测） | DOM：el_cardA `transform: scale(0)`；帧：卡面区与背景均值差 <3% |
| F90 | **F93**（90→93，+3；词锚节拍） | 3.10 | 卡 A 入场 12/15 帧，scale ∈ [0.8,1]。词锚推导：锚 78 + 15 帧 = F93 落定；F90 处 12/15。现实现下此断言不可判定（降级，见上行） | DOM：el_cardA scale ∈ [0.8,1]；A-C01-02 |
| F180 | **F184**（180→184，+4；词锚节拍） | 6.13 | 卡 B 落定；卡 A 已退出视区。词锚节拍："充电"第 2 次（w11，卡 B 锚词）@6.13s：6.13×30=183.9→**F184**，+15 帧 →F199 落定。现实现降级：无显隐区间，卡 A 不退出（l1 实测三卡同位叠堆） | DOM：el_cardB 可见；帧：卡面区白卡 + 绿色强调点 |
| F250 | **F243**（250→243，−7） | 8.08 | 卡 C 落定；"防水"高亮触发区间。ef_kw3 锚"防水"（w14）@8.08s：8.08×30=242.4→**F243**（0.25s 上冲至 ≈F250.5，0.6s 回落至 ≈F268.5）——高亮触发区间 F243–268 与原 F250 相容，帧号按 243 口径。l1 实测：高亮画在 #canvas 层，被全画布 el_bg 遮挡，`#FFD166` 抬升不可见（比文档"整屏闪现"更强一级降级） | 帧：整屏 `#FFD166` 分量抬升（整层闪现，差异见 §3.1.4） |
| ⚠️ F320 | **F358**（320→358，+38） | 11.92 | 价格区显现；counter 起始 8,200。ef_sales 锚"一万两千六百多件"（w19）@11.92s：11.92×30=357.6→**F358**——原表 F320 早于锚帧 38 帧，counter 未开始（l1 实测 F320 counter 为空）。counter 时长 `min(1.2, max(0.3, 15−11.92))`=1.2s → 36 帧，F358–F394 滚动，落定 F394；F360 处于滚动前段（断言 A-C01-03 帧号 360 保留，但"数值 ∈ [10000,10500]"按 1.2s/36 帧滚动曲线重标定） | DOM：el_price 挂载；counter div 在 (0,0)（已知降级）；帧：价格区橙通道均值高于背景 |
| F360 | **F360**（A-C01-03 断言帧保留；词锚 F358 后第 3 帧） | 12.00 | counter 中段（数值 ∈ [10000,10500]，`[待验证]` 缓动标定——现滚动区间 F358–F394，power1.out 缓动下 F360 数值偏低位，标定区间随 l1 复测刷新） | 帧：原点区存在深色数字像素；A-C01-03（l1 实测 dark_ratio 0.2303，D-01 修复后通过） |
| F396 | **F396**（无词锚，行不变；词表节拍："清洁刷"@14.23s→F427） | 13.20 | CTA 条 y1840→1780；橙色条横贯底部。an_cta_in 无 startAnchor，从 t=0 起 10 帧——bar 在 ≈F10 已落定 y=1780（l1 实测），F396 只是静态检视帧 | DOM：el_cta y ∈ [1780,1840]；帧：底条 (90,1780,900,100) 橙通道占比 ≥80% |
| F449 | **F449**（尾帧，行不变） | 14.97 | 尾帧：CTA + 产品同屏；bbox 不越界。F445 整片压暗目标在词锚时钟下无锚可用（末词"清洁刷"止于 14.62s→F438.6，与 14.83s 不对应，l1 夹具已删该 fade 并记录转换规则） | MP4：15.00 s / 30 fps / 450 帧；DOM：无 bbox 越界 |

推导锚词全表（`frame = ceil(word.start × 30)`，词表见 §3.1.3 / `l1_render_test.go:100-120`）：早餐@0.0→0、来不及@0.4→12、杯子@1.15→35、五分钟@1.4→42、三倍@2.6→78、搅打力@2.9→87、果肉@3.78→114、打细@4.28→129、USB-C@5.2→156、充电@5.62→169、充电@6.13→184、十五杯@6.37→192、杯身@7.8→234、防水@8.08→243、就干净@8.75→263、一百二十九@10.64→320、券后@11.1→333、七十九@11.3→339、一万两千六百多件@11.92→358、清洁刷@14.23→427。

#### 3.1.6 断言

**可量化视觉断言**

| ID | 判定对象 | 区域/通道 | 判据与阈值 | 失败含义 |
|---|---|---|---|---|
| A-C01-01 | 标题存在性 | (60,180,960,240) 深色像素 | F12 占比 ≥18% | 标题未渲染或字号过小 |
| A-C01-02 | 卖点卡入场 | el_cardA bbox / scale | F90 scale ∈ [0.8,1]，F100 后 =1 | 错峰未触发或锚点落 0 帧 |
| A-C01-03 | counter 滚动 | 原点 (0,0) 起 300×120 | F360 ≥3 位数字字形；F389 后文本稳定 | counter 未创建或数值未落定 |
| A-C01-04 | 安全区避让 | y∈[0,220)、y∈[1700,1920] | 主文字/卡面 bbox 不进入（CTA 约定区除外） | 信息被平台栏遮挡 |
| A-C01-05 | 背景纯色 | 非文字区 | `#FFF7EE` 通道 ΔE ≤5（`[待验证]` 阈值 L1 标定） | 素材/特效污染背景 |

**自动化断言**：IR 层（L0）：meta 1080×1920/30/15.0；words 单调不重叠（`[代码] ir.go:225-231`）；`voice.durationSec` ≥ 末词 end（`[代码] ir.go:263-270`）；src/key 必须 `video/` 前缀，无 `://`/`data:`（`[代码] ir.go:355-365`、`:452-458`）；elements ≤64、effects ≤128、script ≤5000（`[代码] ir.go:152-159`）；easing 白名单（`[代码] ir.go:171`）。DOM 层（L4）：元素数 = IR 数；counter 容器 id 前缀 `counter-`；未解析锚点落 0 帧现象显式报告。帧层（L1）：F12/F90/F180/F250/F320/F360/F396/F449 golden；坏图 decode 被 `.catch()` 吞掉的行为（`[代码] timeline-builder.js:158-160`、`:225-229`）单独断言空白占位。MP4 层（L2/L3）：15.00 s ±1 帧、30 fps、1080×1920、yuv420p；音频流存在（预览除外）。

**人工验收点**：① 三张卡顺序与口播一一对应，无"卡先于词"；② ¥79 / ¥129 / 12,600 三处数字与 S5 一致，无位数跳变残留；③ 字幕未把"十五杯""防水"切成单字一行；④ F36 封面帧产品完整、标题无截断、无半入场元素；⑤ 全片无 emoji 字形漂移，`USB-C` 不折行。

**失败注入**

| ID | 注入点 | 注入内容 | 期望错误码 / 降级行为 |
|---|---|---|---|
| F-C01-01 | 锚点词 | 删除 w14（"防水"），ef_kw3 exact 缺失 | 目标：400 `E_VIDEO_ANCHOR_NOT_FOUND`；现实现：effect `missing` skip + warn（`[代码] timeline-builder.js:191-194`），不阻断渲染 |
| F-C01-02 | 重复词 | "充电"锚点仅给文本不带 occurrence | 目标：400 `E_VIDEO_ANCHOR_AMBIGUOUS`；现实现：same_text 取首个匹配，偏移进 warnings |
| F-C01-03 | 素材 src | el_product.src 改为 `https://cdn.example/x.png` | IR 校验 400 `E_VIDEO_INVALID_IR`（`[代码] ir.go:355-365`），不进渲染 |
| F-C01-04 | schemaVersion | 改为 999 | 渲染拒绝 400 `E_VIDEO_UNSUPPORTED_SCHEMA`（架构文档 §5.2 不变量 6） |

#### 3.1.7 当前可实现性小结

**结论**：脚本、分镜、版式与节奏可出 still 与基础 MP4；错峰入场、counter 定位、词内高亮、圆角遮罩为已知视觉降级（§3.1.4），验收须随画面标注，不得记 ✅。**阻塞项**：元素显隐区间、元素级特效目标、counter 坐标字段、mask 节点、BGM loop/loudnorm——对应基线 §1.8 矩阵 C01 行。

### 3.2 VS-C02 品牌发布

#### 3.2.1 案例头

| 字段 | 值 |
|---|---|
| 案例 ID / 名称 | VS-C02 品牌发布（AURA One 无线耳机 TVC） |
| 内容类型 | 品牌 TVC（静默开场 + 产品特写 + 场景蒙太奇 + Logo 落版） |
| 目标受众 | 25–40 岁都市白领、数码与设计敏感型用户 |
| 发布渠道 | 官网首屏、YouTube/B 站片头、发布会大屏 |
| 画幅 / fps / 时长 | 1920×1080 / 25 / 30.00 s（ceil=750，round=750） |
| 语言 | 英文标语 + 中文副标 + 中文旁白 |
| 优先级 / 依赖 | P1；T-05/T-06 降级方式被 C08 复用 |

#### 3.2.2 创作规格

**主张**：三段分镜完成"静默登场 → 场景融入 → Logo 落版"，镜头推进与伪 3D 建立纵深，不靠口播堆卖点。**场景**：大屏横屏，前 3 秒无旁白，规格点集中 13–18 s，落版信息最后 6 秒固定不切。

**渠道硬规格**：1920×1080、25 fps、30 s；安全区左右 120 px、上下 80 px；Logo 落版居中框 x760–1160、y420–660。TVC 可判定指标：主场景亮度分层 ≥3 级（高光/主体/暗部）；转场前后重叠 ≥6 帧；除抖动元素外无随机位移。暗底 `#0E1320` 避免纯黑；高光青 `#7BE3FF` 面积 ≤15%。

**逐句脚本（成稿）**：
- S1（0.00–2.96，无旁白）全黑，一道横向光线扫过产品轮廓。
- S2（3.00–7.96）Sound rises. Design settles. 声起，形定。
- S3（8.00–12.96）从通勤地铁到深夜书桌，降噪陪你穿过噪声。
- S4（13.00–17.96）四十五小时续航，双设备瞬连，轻至二百三十五克。
- S5（18.00–23.96）AURA One，为专注而生。
- S6（24.00–29.96）AURA One，十一月二十二日全渠道开售。

**分镜表**（25 fps，末帧 749）：

| 镜号 | 帧范围 | 画面 | 图层/元素 | 动效与锚点词 | 字幕/音频 |
|---|---|---|---|---|---|
| 1 | F0–F74 | 暗场；横向高光扫过，产品轮廓末段显形 | el_bg / el_product | 光线 shape move；产品 scaleIn 0.6→1（T-06 推进近似） | 无字幕；BGM 单音起 |
| 2 | F75–F199 | 英文标语居左大字，中文副标在下；产品居右轻侧转 | el_slogan_en / el_sub_cn / el_product | 标语 scaleIn；产品 rotate+scale 组合（T-05）；锚点 "Sound"/"settles" | 英 + 中副标；BGM 节拍 1 |
| 3 | F200–F324 | 地铁与书桌两场景前后衔接，镜头推进穿过 | el_scene1 / el_scene2 | 转场 1：F199–F210 整片叠化（T-07）；两图 scaleIn+move（T-06）；锚点"地铁""书桌" | S3；字幕两行 |
| 4 | F325–F449 | 三规格点横排：45 h / 双设备瞬连 / 235 g；产品缩小居上 | el_stats | 三规格点错峰 scaleIn（T-09）；锚点"续航""瞬连""二百三十五克" | S4；字幕"45h · 双设备瞬连 · 235 g" |
| 5 | F450–F599 | 转场 2（F449–F460 叠化）；Logo 居中 + slogan | el_logo / el_sub_cn | Logo pulse 呼吸；跨词锚点"专注而生"(w18+w19) | S5；字幕单行 |
| 6 | F600–F749 | Logo 缩小居上；日期渠道落版；F735 起轻 fade | el_logo / el_date | 日期 scaleIn；F735 整片 fade | S6；字幕"11 月 22 日 全渠道开售"；BGM 收束 |

**版式**：镜号 2 左右分栏——文字栏 x120–900、产品栏 x960–1700；落版居中对称。字号：英文标语 92/800、中文副标 40/500、规格点 44/700、日期 48/700；英文字距 +2%，中文行高 1.4。

**色彩**：背景 `#0E1320`；主文字 `#F5F8FF`；强调青 `#7BE3FF`；辅灰蓝 `#C9D6E8`。对比度目标暗底 ≥4.5:1（`[外部] WCAG 链接见 §3.1.2`），实测 `[待验证]`。**字体**：英文 `Archivo`（回退 `Inter, Arial`）700/800；中文 `Noto Sans SC` 500/700；无 emoji 与生僻字。

**素材清单**：`video/c02/product-hero.png`（产品主图，1920×1920 PNG 透明底，品牌方授权示例）；`video/c02/scene-metro.jpg`、`scene-desk.jpg`（两场景图，1920×1080 JPEG，商用订阅示例）；`video/c02/bgm-cinematic-92.m4a`（BGM，44.1 kHz / 92 BPM / ≤1.2 MiB，商用订阅示例）。

**音频**：目标双 voice——`en-US-AndrewNeural` + `zh-CN-YunyangNeural`，rate 1.0；现 IR `Audio{voice,bgm}` 为单 voice 结构（`[代码] ir.go:136-146`），双轨需扩展。BGM 92 BPM、音量 0.22，目标 F75/F200/F325/F450 卡点；-16 LUFS。现实现无 loop/loudnorm/apad（`[代码] encode.go:147-185`），预览无 audio 节点（`[代码] timeline-builder.js:36-40`）。**字幕**：英文标语为画面硬排；中文旁白硬字幕，≤16 rune/行、≤2 行。

#### 3.2.3 IR 规格（目标 schema）

```json
{
  "schemaVersion": 1,
  "meta": {"width": 1920, "height": 1080, "fps": 25, "durationSec": 30.0, "background": "#0E1320"},
  "script": "Sound rises. Design settles. 声起，形定。从通勤地铁到深夜书桌，降噪陪你穿过噪声。四十五小时续航，双设备瞬连，轻至二百三十五克。AURA One，为专注而生。AURA One，十一月二十二日全渠道开售。",
  "words": [{"id": "w01", "index": 0, "start": 3.0, "end": 3.38, "text": "Sound", "source": "aligner", "confidence": 0.98, "scriptStart": 0, "scriptEnd": 5}, {"id": "w02", "index": 1, "start": 3.38, "end": 3.74, "text": "rises", "source": "aligner", "confidence": 0.97, "scriptStart": 6, "scriptEnd": 11}, {"id": "w03", "index": 2, "start": 3.8, "end": 4.14, "text": "Design", "source": "aligner", "confidence": 0.98, "scriptStart": 12, "scriptEnd": 18}, {"id": "w04", "index": 3, "start": 4.14, "end": 4.58, "text": "settles", "source": "aligner", "confidence": 0.96, "scriptStart": 19, "scriptEnd": 26}, {"id": "w05", "index": 4, "start": 5.0, "end": 5.3, "text": "声起", "source": "aligner", "confidence": 0.97, "scriptStart": 28, "scriptEnd": 30}, {"id": "w06", "index": 5, "start": 5.3, "end": 5.66, "text": "形定", "source": "aligner", "confidence": 0.96, "scriptStart": 31, "scriptEnd": 33}, {"id": "w07", "index": 6, "start": 8.14, "end": 8.56, "text": "通勤地铁", "source": "aligner", "confidence": 0.94, "scriptStart": 36, "scriptEnd": 40}, {"id": "w08", "index": 7, "start": 8.66, "end": 9.1, "text": "深夜书桌", "source": "aligner", "confidence": 0.94, "scriptStart": 41, "scriptEnd": 45}, {"id": "w09", "index": 8, "start": 9.16, "end": 9.4, "text": "降噪", "source": "aligner", "confidence": 0.96, "scriptStart": 46, "scriptEnd": 48}, {"id": "w10", "index": 9, "start": 9.82, "end": 10.2, "text": "噪声", "source": "aligner", "confidence": 0.95, "scriptStart": 51, "scriptEnd": 53}, {"id": "w11", "index": 10, "start": 13.0, "end": 13.34, "text": "四十五", "source": "aligner", "confidence": 0.95, "scriptStart": 55, "scriptEnd": 58}, {"id": "w12", "index": 11, "start": 13.34, "end": 13.78, "text": "小时续航", "source": "aligner", "confidence": 0.94, "scriptStart": 58, "scriptEnd": 62}, {"id": "w13", "index": 12, "start": 13.82, "end": 14.1, "text": "双设备", "source": "aligner", "confidence": 0.96, "scriptStart": 63, "scriptEnd": 66}, {"id": "w14", "index": 13, "start": 14.1, "end": 14.38, "text": "瞬连", "source": "aligner", "confidence": 0.95, "scriptStart": 66, "scriptEnd": 68}, {"id": "w15", "index": 14, "start": 14.62, "end": 15.18, "text": "二百三十五克", "source": "aligner", "confidence": 0.91, "scriptStart": 70, "scriptEnd": 76}, {"id": "w16", "index": 15, "start": 18.0, "end": 18.36, "text": "AURA", "source": "manual", "confidence": 1.0, "scriptStart": 78, "scriptEnd": 82}, {"id": "w17", "index": 16, "start": 18.36, "end": 18.66, "text": "One", "source": "manual", "confidence": 1.0, "scriptStart": 83, "scriptEnd": 86}, {"id": "w18", "index": 17, "start": 18.84, "end": 19.08, "text": "专注", "source": "aligner", "confidence": 0.96, "scriptStart": 88, "scriptEnd": 90}, {"id": "w19", "index": 18, "start": 19.08, "end": 19.38, "text": "而生", "source": "aligner", "confidence": 0.95, "scriptStart": 90, "scriptEnd": 92}, {"id": "w20", "index": 19, "start": 24.0, "end": 24.36, "text": "AURA", "source": "manual", "confidence": 1.0, "scriptStart": 94, "scriptEnd": 98}, {"id": "w21", "index": 20, "start": 24.7, "end": 25.3, "text": "十一月二十二日", "source": "aligner", "confidence": 0.92, "scriptStart": 99, "scriptEnd": 106}, {"id": "w22", "index": 21, "start": 25.54, "end": 25.86, "text": "开售", "source": "aligner", "confidence": 0.96, "scriptStart": 107, "scriptEnd": 109}],
  "tracks": [{"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_fx", "kind": "overlay", "z": 10}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.22, "assetKey": "video/c02/bgm-cinematic-92.m4a"}],
  "elements": [
    {"id": "el_bg", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 749, "params": {"x": 0, "y": 0, "w": 1920, "h": 1080, "color": "#0E1320"}},
    {"id": "el_product", "type": "image", "trackId": "tr_main", "startFrame": 0, "endFrame": 749, "src": "video/c02/product-hero.png", "params": {"x": 960, "y": 200, "w": 740, "h": 620, "anchor": "center"}},
    {"id": "el_slogan_en", "type": "text", "trackId": "tr_fx", "startFrame": 75, "endFrame": 199, "params": {"text": "Sound rises. Design settles.", "x": 120, "y": 380, "w": 780, "h": 160, "fontSize": 92, "fontWeight": 800, "color": "#F5F8FF", "textAlign": "left", "letterSpacing": 2}},
    {"id": "el_sub_cn", "type": "text", "trackId": "tr_fx", "startFrame": 75, "endFrame": 599, "params": {"text": "声起，形定。", "x": 120, "y": 560, "w": 780, "h": 80, "fontSize": 40, "fontWeight": 500, "color": "#C9D6E8", "textAlign": "left"}},
    {"id": "el_scene1", "type": "image", "trackId": "tr_main", "startFrame": 200, "endFrame": 261, "src": "video/c02/scene-metro.jpg", "params": {"x": 120, "y": 160, "w": 1680, "h": 560, "objectFit": "cover"}},
    {"id": "el_scene2", "type": "image", "trackId": "tr_main", "startFrame": 262, "endFrame": 449, "src": "video/c02/scene-desk.jpg", "params": {"x": 120, "y": 160, "w": 1680, "h": 560, "objectFit": "cover"}},
    {"id": "el_stats", "type": "shape", "trackId": "tr_fx", "startFrame": 325, "endFrame": 449, "params": {"x": 120, "y": 760, "w": 1680, "h": 180, "color": "#16202E", "columns": ["45 h 续航", "双设备瞬连", "235 g"], "textColor": "#F5F8FF", "accent": "#7BE3FF", "fontSize": 44, "fontWeight": 700}},
    {"id": "el_logo", "type": "image", "trackId": "tr_fx", "startFrame": 450, "endFrame": 749, "src": "video/c02/product-hero.png", "params": {"x": 760, "y": 420, "w": 400, "h": 240, "anchor": "center", "dateText": "11 月 22 日 · 全渠道开售", "dateY": 700, "dateColor": "#C9D6E8", "dateSize": 48}}
  ],
  "animations": [
    {"id": "an_light_sweep", "targetElementId": "el_product", "type": "move", "startFrame": 0, "durationFrames": 74, "from": {"x": 800}, "to": {"x": 1120}, "easing": "linear"},
    {"id": "an_slogan_in", "targetElementId": "el_slogan_en", "type": "scaleIn", "startFrame": 75, "durationFrames": 20, "fromValue": 0.85, "toValue": 1, "easing": "power2.out"},
    {"id": "an_product_pan", "targetElementId": "el_product", "type": "scaleIn", "startFrame": 75, "durationFrames": 40, "fromValue": 0.6, "toValue": 1, "easing": "expo.out"},
    {"id": "an_scene1_in", "targetElementId": "el_scene1", "type": "scaleIn", "startFrame": 200, "durationFrames": 18, "fromValue": 0.92, "toValue": 1, "easing": "power2.out"},
    {"id": "an_scene2_in", "targetElementId": "el_scene2", "type": "scaleIn", "startFrame": 262, "durationFrames": 18, "fromValue": 0.92, "toValue": 1, "easing": "power2.out"},
    {"id": "an_logo_in", "targetElementId": "el_logo", "type": "scaleIn", "startFrame": 450, "durationFrames": 24, "fromValue": 0, "toValue": 1, "easing": "back.out"}
  ],
  "effects": [
    {"id": "ef_trans1", "type": "fade", "targetElementId": null, "anchor": {"wordId": "w08", "lastText": "深夜书桌", "lastIndex": 7, "resolvedFrom": "exact", "status": "resolved"}, "params": {"opacity": 0.35}},
    {"id": "ef_trans2", "type": "fade", "targetElementId": null, "anchor": {"wordId": "w19", "lastText": "而生", "lastIndex": 18, "resolvedFrom": "exact", "status": "resolved"}, "params": {"opacity": 0.35}},
    {"id": "ef_logo_pulse", "type": "pulse", "targetElementId": "el_logo", "anchor": {"wordId": "w16", "lastText": "AURA", "lastIndex": 15, "occurrence": 0, "resolvedFrom": "exact", "status": "resolved"}, "params": {"scale": 1.06}}
  ],
  "assets": [
    {"key": "video/c02/product-hero.png", "kind": "image", "bytes": 920000, "license": "品牌方授权（示例）"},
    {"key": "video/c02/scene-metro.jpg", "kind": "image", "bytes": 640000, "license": "商用订阅（示例）"},
    {"key": "video/c02/scene-desk.jpg", "kind": "image", "bytes": 610000, "license": "商用订阅（示例）"},
    {"key": "video/c02/bgm-cinematic-92.m4a", "kind": "audio", "bytes": 1180000, "license": "商用订阅（示例）"}
  ],
  "render": {"width": 1920, "height": 1080, "fps": 25, "crf": 17, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "hard", "fontSizePx": 44, "maxLineRunes": 16, "maxLines": 2}, "thumbnail": {"atSec": 18.0}}
}
```

> 锚点：重复词 `AURA` w16(occurrence=0)/w20(occurrence=1)；跨词锚点"专注而生" w18+w19，ef_trans2 按 w19 解析。

#### 3.2.4 现状降级映射

| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-05 伪 3D 透视 | `params.transform{perspective, rotateX, rotateY, skew}` | 动画仅 move/scaleIn/rotate，rotate 为 2D（`[代码] ir.go:100-116`）；无 perspective/rotateY | ⛔ | 侧转为平面缩放 + 2D 旋转；无纵深压缩、无背面贴图，"斜侧立体"不可复现 |
| T-06 镜头推进/平移 | `animation.type=cameraPush{zoom,pan,parallax}` 分层差速 | 整层 scaleIn+move 近似；无独立 camera 节点，前后景共用变换 | ⚠️ | 推进是整层等比放大 + 位移；场景与产品无视差差速，远景无相对位移 |
| T-07 三段分镜转场 | `elements[].transition{type,durationFrames}` | 无 transition 字段；仅整片 fade 特效（作用 `#canvas`，`[代码] timeline-builder.js:190`）或元素 move 叠加 | ⚠️ | 转场为整屏淡出叠化，不能做单层横向滑动；"穿过两场景图"靠叠化，无滑动方向 |
| T-01 中外文混排 | `text.params.richRuns[{text,font,fontWeight,color}]` + letterSpacing | text 单一 fontSize/color/fontWeight（`[代码] ir.go:118-134`），无富文本 run；CJK 换行按 rune 硬切（`[代码] subtitle.go:66-96`） | ⚠️ | 英文标语与中文副标必须拆两个 text；英文长句断行位置不可控，可能切在单词中间 |
| T-13 BGM 卡点 | `tracks[].beats[]` + 动画 `startAnchor=beat` | 锚点只挂 word（`[代码] ir.go:74`）；timeline 无 audio 节点（`[代码] timeline-builder.js:36-40`）；MuxAV 无 loop/loudnorm/apad（`[代码] encode.go:147-185`） | ⛔ | 卡点时间只能手写帧号；预览无声无法对拍；成片 BGM 截断不循环、响度未归一 |
| T-02 多图层 | `tracks[]` + `trackId` 分组显隐 | 无 trackId；层级靠 `z` + append 顺序（`[代码] ir.go:118-134`） | ⚠️ | 无轨道级批量显隐；场景层退出需逐元素写动画 |
| 动画参数位置（from/to/easing） | 目标 schema：`params.from/to/easing`；现实现：`ElementAnimation` 读顶层 `from/to/fromValue/toValue/easing`（`[代码] ir.go:100-116`） | 案例 IR 以顶层为准：move 用顶层 `from/to`，scaleIn/rotate 用顶层 `fromValue/toValue`，`easing` 顶层；其余 extras 仍进 `extra` | ⚠️ | 若把三键放回 `params`，入场/缩放静默落 0 帧；顶层写法与现实现一致 |
| 复合参数键（§5.16 P2-7/P2-8 提案） | `params.letterSpacing/columns/textColor/accent/dateText/dateY/dateColor/dateSize/objectFit/anchor` | 现 builder 仅消费 image/text/shape 标准坐标与字号字段，复合键落 `extra`（`[代码] ir.go:118-134`） | ⛔ 依赖 §5.16 P2-7/P2-8 提案 | 现 builder 不消费这些键，画面不出现对应效果（分栏、落版日期、场景裁切须素材侧预置） |

#### 3.2.5 预期帧表

| 帧号 | 时刻(s) | 期望画面状态 | 断言类型 |
|---|---|---|---|
| F0 | 0.00 | 暗场 `#0E1320`；产品 scale≈0.6；标语/场景/Logo 未入场 | DOM：9 元素挂载；帧：全图灰度均值 <30 |
| F37 | 1.48 | 扫光位移中段；高光在画面右侧偏中 | 帧：青通道像素集中于 x∈[800,1120] 条带；A-C02-01 |
| F95 | 3.80 | 标语落定；副标在其下；产品居右 | 帧：文字栏 (120,380,780,160) 白文字 ≥15%；副标 `#C9D6E8` 可辨识 |
| F200 | 8.00 | 转场 1 叠化；场景 1 入场 | DOM：el_scene1 scaleIn；帧：场景区均值由暗转亮 |
| F262 | 10.48 | 场景 2 入场，场景 1 退出 | DOM：el_scene2 可见；帧：场景区色温过渡（阈值 `[待验证]` 素材标定） |
| F360 | 14.40 | 规格条三列文字完整；数字与 S4 同源 | 帧：三列边缘密度均衡；A-C02-02 |
| F450 | 18.00 | 转场 2 叠化；Logo scale 0→1 | DOM：el_logo scaleIn；帧：居中框 (760,420,400,240) 前景占比单调上升 |
| F474 | 18.96 | Logo 落定；pulse 第一拍 scale 1.06 | DOM：el_logo scale ∈ [1,1.06]；A-C02-03 |
| F600 | 24.00 | 日期落版入场；Logo 缩小居上 | DOM：日期参数挂载；帧：日期文字在居中下方 y=700 带 |
| F749 | 29.96 | 尾帧：Logo + 日期同屏；bbox 不越界 | MP4：30.00 s / 25 fps / 750 帧；DOM：bbox 全在界内 |

#### 3.2.6 断言

**可量化视觉断言**

| ID | 判定对象 | 区域/通道 | 判据与阈值 | 失败含义 |
|---|---|---|---|---|
| A-C02-01 | 扫光位置 | 条带 y∈[420,660] 青通道 | F37 青像素 x 重心 ∈ [800,1120]；F74 前移出左半屏 | 光线方向/锚点错误 |
| A-C02-02 | 规格条三列 | (120,760,1680,180) | 各列 bbox 宽 ≥400 px，列间距 ≥60 px；数字与 S4 一致 | 版式挤压或文案错位 |
| A-C02-03 | Logo 呼吸 | el_logo bbox / scale | F474 scale ≤1.06；区间外 =1（现实现 pulse 作用整层，须帧层核验整屏是否同步缩放——若是即降级证据） | 特效未限定目标被误判为元素级 |
| A-C02-04 | 暗场基底 | 非文字/产品区 | 背景均值 ≈ `#0E1320`，ΔE ≤5 | 素材/特效污染暗场 |
| A-C02-05 | 安全区 | 左右 120 px、上下 80 px | 主文字与 Logo bbox 不进入边缘条带 | 大屏裁切信息丢失 |

**自动化断言**：IR 层（L0）：meta 1920×1080/25/30.0；words 单调不重叠；双 voice 目标在现单 voice 结构下记 warning，不得静默合并；assets bytes 受单项目图片上限约束（架构文档 §5.2 不变量 8）；easing 白名单（`[代码] ir.go:171`）。DOM 层（L4）：元素 8 个；pulse/highlight/shake/fade 实际挂载 `#canvas` 的事实写入备注（`[代码] timeline-builder.js:190`）；未解析锚点落 0 帧显式报告。帧层（L1）：F37/F95/F200/F262/F360/F450/F474/F600/F749 golden；坏图 decode 吞错单独断言空白占位（`[代码] timeline-builder.js:225-229`）。MP4 层（L2/L3）：25 fps、1920×1080、yuv420p；音频流存在；叠化区间前后帧重叠 ≥6 帧（帧差阈值 `[待验证]` L2 标定）。

**人工验收点**：① 三段顺序与 S1→S6 对应，转场无跳帧残影；② 英文标语拼写大小写与脚本逐字一致，中文副标无错字；③ 45 h / 235 g 与旁白同源；④ F450 后 Logo 保持居中，日期不压 Logo；⑤ 暗场无噪色块，高光青面积 ≤15%。

**失败注入**

| ID | 注入点 | 注入内容 | 期望错误码 / 降级行为 |
|---|---|---|---|
| F-C02-01 | 元素参数 | el_stats 加未知 `transition:"slide"` | 目标：未知字段保留；现 Player：未知类型 skip + console.warn（`[代码] timeline-builder.js:183-185`、`:192-194`），不抛错 |
| F-C02-02 | 词锚点 | ef_logo_pulse wordId 指向已删除词 | 目标：400 `E_VIDEO_ANCHOR_NOT_FOUND`；现实现：effect skip + warn（`[代码] timeline-builder.js:191`） |
| F-C02-03 | 素材资产 | el_scene1.src 指向未上传 key | 渲染期 404 `E_VIDEO_ASSET_NOT_FOUND`（架构文档 §10.5）；不回退占位图静默通过 |
| F-C02-04 | schemaVersion | 未知版本 | 渲染拒绝 400 `E_VIDEO_UNSUPPORTED_SCHEMA`（架构文档 §5.2 不变量 6） |

#### 3.2.7 当前可实现性小结

**结论**：分镜骨架、标语排版、规格条与落版可出 still 与基础 MP4；伪 3D 纵深、分层视差推进、单层滑动转场、BGM 节拍对齐为阻塞/半阻塞项（§3.2.4），验收须按 2D 缩放/叠化近似描述，不得标注"3D 转场已实现"。**阻塞项**：transform 三维字段、camera/parallax、transition 字段、richRuns、beat 锚点轨道、双 voice 结构——对应基线 §1.8 矩阵 C02 行。

### 3.3 VS-C07 招聘 / 企业宣传

#### 3.3.1 案例头

| 字段 | 值 |
|---|---|
| 案例 ID / 名称 | VS-C07 招聘 / 企业宣传（云栖技术雇主品牌片） |
| 内容类型 | 企业介绍 + 招聘流程 + 员工证言 + 投递指引（图文口播型） |
| 目标受众 | 2–6 年工程师、产品经理；求职平台与官网招聘页访客 |
| 发布渠道 | 官网招聘页、LinkedIn/脉脉横屏帖、校招宣讲会 |
| 画幅 / fps / 时长 | 1920×1080 / 30 / 40.00 s（ceil=1200，round=1200） |
| 语言 | 中文普通话 + 英文邮箱地址 |
| 优先级 / 依赖 | P2；T-02 分层方式被 C01/C02 参照 |

#### 3.3.2 创作规格

**主张**：左图右栏双栏贯穿全片，按"公司事实 → 工作方式 → 流程 → 福利 → 成果 → 证言 → 投递"的求职决策顺序铺信息。**场景**：桌面端招聘页与宣讲大屏；数字类信息（人数、年限、项目数、复购率）必须与旁白同源。

**渠道硬规格**：1920×1080、30 fps、40 s；安全区左右 100 px、上下 60 px；二维码/邮箱在右下投递段，不被播放器控件遮挡。固定双栏（T-01）：左栏 x120–780，右栏 x860–1800；品牌条 y40–120 全程在屏，footer y940–1020 在投递段出现。文字不细于 28 px；二维码素材净尺寸 ≥480×480。

**逐句脚本（成稿）**：
- S1（0.00–3.97）云栖技术成立于二零一六年，团队三百二十人。
- S2（4.00–8.97）在这里，工程师拥有从需求到上线的完整链路。
- S3（9.00–13.97）招聘流程：简历筛选，技术面试，项目实战，HR 沟通，入职。
- S4（14.00–19.97）我们提供补充医疗、弹性工作制、学习基金与每年十五天年假。
- S5（20.00–26.97）服务四十多家企业，交付三百多个项目，复购率百分之八十二。
- S6（27.00–32.97）后端工程师林娜说：在这里我的方案会被认真讨论。
- S7（33.00–39.97）扫描屏幕二维码，或投递 jobs@yunqi.example。

**分镜表**（30 fps，末帧 1199）：

| 镜号 | 帧范围 | 画面 | 图层/元素 | 动效与锚点词 | 字幕/音频 |
|---|---|---|---|---|---|
| 1 | F0–F119 | 品牌条在顶；左栏环境图，右栏公司名 + 成立年份；团队规模滚动 | el_brandbar / el_photo / el_infobar | 三层依次入场（T-02）；counter 0→320（T-10）；锚点"团队""三百二十人" | S1；字幕"成立于 2016 · 团队 320 人"；BGM 起 |
| 2 | F120–F269 | 左栏换工位图；右栏"完整链路"四节点：需求→设计→开发→上线 | el_photo / el_infobar | 信息条 scaleIn；节点横排落位；锚点"工程师"(occurrence=0) | S2；字幕两行 |
| 3 | F270–F419 | 右栏流程五步纵向列表，编号 01–05；左栏工位图保留 | el_steps | 五步错峰 scaleIn（T-09），每步间隔 12 帧；锚点"简历筛选""技术面试""入职" | S3；字幕"五步完成招聘" |
| 4 | F420–F599 | 右栏福利四条两列排布；图标 shape + 文字 | el_infobar 更新 | 福利卡错峰入场（T-09 第二批）；跨词锚点"弹性工作制"(w15+w16) | S4；字幕"补充医疗 · 弹性工作制 · 学习基金 · 15 天年假" |
| 5 | F600–F809 | 右栏 KPI 三格：40+ 企业 / 300+ 项目 / 82% 复购率；项目数滚动 | el_kpi / el_photo | counter 0→300（T-10 第二组）；KPI 格 scaleIn；锚点"项目""复购率" | S5；字幕数字与 KPI 格同源 |
| 6 | F810–F989 | 左栏头像 + 姓名职位；右栏引言卡 + 引号图形 | el_photo / el_quote | 引言卡 scaleIn；高亮挂"工程师"(occurrence=1)；锚点"林娜" | S6；引言字幕，引号不拆行 |
| 7 | F990–F1199 | footer：右下二维码 + 邮箱；品牌条保持；前序图层退出 | el_cta / el_brandbar | footer move 上移；邮箱 scaleIn；F1185 整片轻 fade | S7；字幕二维码提示 + 邮箱；BGM 收束 |

**版式**：双栏栏间距 80 px；品牌条高 80 px。字号：公司名 56/900、栏目标题 44/800、条目 34/500、KPI 数字 64/900、步骤编号 30/700、引言 38/500、邮箱 30/500；行高 1.4；栏内左对齐，KPI 居中。

**色彩**：背景 `#F4F6F8`；品牌深蓝 `#1F3A5F`；强调金 `#E8A33D`；正文 `#1B2733`；卡片 `#FFFFFF`。对比度目标 ≥4.5:1（`[外部] WCAG 见 §3.1.2`），实测 `[待验证]`。**字体**：中文 `Noto Sans SC` 500/700/900；邮箱英文 `Inter`；二维码以位图提供，不用文字拼接；无生僻字。

**素材清单**：`video/c07/office-env.jpg`、`engineer-desk.jpg`（环境/工位图，1560×1240 JPEG，实拍授权示例）；`video/c07/portrait-lina.jpg`（员工头像，960×960 JPEG，肖像授权示例）；`video/c07/qrcode.png`（二维码，480×480 PNG 白底，内部资产）；`video/c07/bgm-corporate-100.m4a`（BGM，44.1 kHz / 100 BPM / ≤900 KiB，商用订阅示例）。

**音频**：voice `zh-CN-XiaoxiaoNeural`，rate 1.0，-14 LUFS；BGM 100 BPM、音量 0.15、目标循环，-16 LUFS。现实现无 loop/loudnorm/apad（`[代码] encode.go:147-185`），预览无 audio 节点（`[代码] timeline-builder.js:36-40`）。**字幕**：硬字幕，y860–920（footer 段让位 y800–850）；≤16 rune/行、≤2 行；邮箱属画面文字，不进字幕轨。

#### 3.3.3 IR 规格（目标 schema）

```json
{
  "schemaVersion": 1,
  "meta": {"width": 1920, "height": 1080, "fps": 30, "durationSec": 40.0, "background": "#F4F6F8"},
  "script": "云栖技术成立于二零一六年，团队三百二十人。在这里，工程师拥有从需求到上线的完整链路。招聘流程：简历筛选，技术面试，项目实战，HR 沟通，入职。我们提供补充医疗、弹性工作制、学习基金与每年十五天年假。服务四十多家企业，交付三百多个项目，复购率百分之八十二。后端工程师林娜说：在这里我的方案会被认真讨论。扫描屏幕二维码，或投递 jobs@yunqi.example。",
  "words": [{"id": "w01", "index": 0, "start": 0.0, "end": 0.48, "text": "云栖技术", "source": "aligner", "confidence": 0.96, "scriptStart": 0, "scriptEnd": 4}, {"id": "w02", "index": 1, "start": 0.72, "end": 1.26, "text": "二零一六年", "source": "aligner", "confidence": 0.94, "scriptStart": 7, "scriptEnd": 13}, {"id": "w03", "index": 2, "start": 1.3, "end": 1.54, "text": "团队", "source": "aligner", "confidence": 0.97, "scriptStart": 14, "scriptEnd": 16}, {"id": "w04", "index": 3, "start": 1.54, "end": 1.96, "text": "三百二十人", "source": "aligner", "confidence": 0.93, "scriptStart": 16, "scriptEnd": 21}, {"id": "w05", "index": 4, "start": 4.0, "end": 4.3, "text": "在这里", "source": "aligner", "confidence": 0.96, "scriptStart": 23, "scriptEnd": 26}, {"id": "w06", "index": 5, "start": 4.36, "end": 4.62, "text": "工程师", "source": "aligner", "confidence": 0.97, "scriptStart": 26, "scriptEnd": 29}, {"id": "w07", "index": 6, "start": 4.82, "end": 5.1, "text": "从需求", "source": "aligner", "confidence": 0.95, "scriptStart": 31, "scriptEnd": 34}, {"id": "w08", "index": 7, "start": 5.1, "end": 5.38, "text": "到上线", "source": "aligner", "confidence": 0.95, "scriptStart": 34, "scriptEnd": 37}, {"id": "w09", "index": 8, "start": 9.0, "end": 9.36, "text": "招聘流程", "source": "aligner", "confidence": 0.97, "scriptStart": 43, "scriptEnd": 47}, {"id": "w10", "index": 9, "start": 9.42, "end": 9.78, "text": "简历筛选", "source": "aligner", "confidence": 0.95, "scriptStart": 48, "scriptEnd": 52}, {"id": "w11", "index": 10, "start": 9.82, "end": 10.14, "text": "技术面试", "source": "aligner", "confidence": 0.95, "scriptStart": 53, "scriptEnd": 57}, {"id": "w12", "index": 11, "start": 10.96, "end": 11.2, "text": "入职", "source": "aligner", "confidence": 0.96, "scriptStart": 69, "scriptEnd": 71}, {"id": "w13", "index": 12, "start": 14.18, "end": 14.36, "text": "提供", "source": "aligner", "confidence": 0.96, "scriptStart": 75, "scriptEnd": 77}, {"id": "w14", "index": 13, "start": 14.36, "end": 14.72, "text": "补充医疗", "source": "aligner", "confidence": 0.95, "scriptStart": 77, "scriptEnd": 81}, {"id": "w15", "index": 14, "start": 14.76, "end": 15.02, "text": "弹性", "source": "aligner", "confidence": 0.95, "scriptStart": 82, "scriptEnd": 84}, {"id": "w16", "index": 15, "start": 15.02, "end": 15.32, "text": "工作制", "source": "aligner", "confidence": 0.95, "scriptStart": 84, "scriptEnd": 87}, {"id": "w17", "index": 16, "start": 15.86, "end": 16.34, "text": "十五天年假", "source": "aligner", "confidence": 0.93, "scriptStart": 95, "scriptEnd": 100}, {"id": "w18", "index": 17, "start": 20.18, "end": 20.66, "text": "四十多家企业", "source": "aligner", "confidence": 0.93, "scriptStart": 104, "scriptEnd": 110}, {"id": "w19", "index": 18, "start": 20.88, "end": 21.38, "text": "三百多个项目", "source": "aligner", "confidence": 0.92, "scriptStart": 111, "scriptEnd": 117}, {"id": "w20", "index": 19, "start": 21.42, "end": 21.68, "text": "复购率", "source": "aligner", "confidence": 0.96, "scriptStart": 118, "scriptEnd": 121}, {"id": "w21", "index": 20, "start": 27.0, "end": 27.24, "text": "后端", "source": "aligner", "confidence": 0.95, "scriptStart": 129, "scriptEnd": 131}, {"id": "w22", "index": 21, "start": 27.24, "end": 27.5, "text": "工程师", "source": "aligner", "confidence": 0.97, "scriptStart": 131, "scriptEnd": 134}, {"id": "w23", "index": 22, "start": 27.5, "end": 27.7, "text": "林娜", "source": "aligner", "confidence": 0.96, "scriptStart": 134, "scriptEnd": 136}, {"id": "w24", "index": 23, "start": 33.94, "end": 34.5, "text": "jobs@yunqi.example", "source": "manual", "confidence": 1.0, "scriptStart": 162, "scriptEnd": 181}],
  "tracks": [{"id": "tr_brand", "kind": "overlay", "z": 20}, {"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_info", "kind": "overlay", "z": 10}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.15, "assetKey": "video/c07/bgm-corporate-100.m4a"}],
  "elements": [
    {"id": "el_bg", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 1199, "params": {"x": 0, "y": 0, "w": 1920, "h": 1080, "color": "#F4F6F8"}},
    {"id": "el_brandbar", "type": "shape", "trackId": "tr_brand", "startFrame": 0, "endFrame": 1199, "params": {"x": 0, "y": 40, "w": 1920, "h": 80, "color": "#1F3A5F", "text": "云栖技术 YUNQI", "textColor": "#FFFFFF", "fontSize": 30, "fontWeight": 700, "textAlign": "left", "paddingX": 100}},
    {"id": "el_photo", "type": "image", "trackId": "tr_main", "startFrame": 0, "endFrame": 989, "src": "video/c07/office-env.jpg", "params": {"x": 120, "y": 160, "w": 660, "h": 620, "objectFit": "cover"}},
    {"id": "el_infobar", "type": "shape", "trackId": "tr_info", "startFrame": 0, "endFrame": 599, "params": {"x": 860, "y": 160, "w": 940, "h": 620, "color": "#FFFFFF", "title": "云栖技术 · 成立于 2016", "headcountText": "团队 320 人", "titleColor": "#1B2733", "fontSize": 44, "fontWeight": 800}},
    {"id": "el_steps", "type": "shape", "trackId": "tr_info", "startFrame": 270, "endFrame": 419, "params": {"x": 860, "y": 200, "w": 940, "h": 540, "columns": 1, "steps": ["01 简历筛选", "02 技术面试", "03 项目实战", "04 HR 沟通", "05 入职"], "stepColor": "#1B2733", "numberColor": "#E8A33D", "fontSize": 34, "fontWeight": 500}},
    {"id": "el_kpi", "type": "shape", "trackId": "tr_info", "startFrame": 600, "endFrame": 809, "params": {"x": 860, "y": 200, "w": 940, "h": 540, "cards": ["40+ 企业", "300+ 项目", "82% 复购率"], "cardColor": "#FFFFFF", "numberColor": "#1F3A5F", "fontSize": 64, "fontWeight": 900}},
    {"id": "el_quote", "type": "shape", "trackId": "tr_info", "startFrame": 810, "endFrame": 989, "params": {"x": 860, "y": 260, "w": 940, "h": 420, "color": "#FFFFFF", "quote": "在这里我的方案会被认真讨论。", "author": "林娜 · 后端工程师", "quoteColor": "#1B2733", "accent": "#E8A33D", "fontSize": 38, "fontWeight": 500}},
    {"id": "el_cta", "type": "shape", "trackId": "tr_info", "startFrame": 990, "endFrame": 1199, "params": {"x": 100, "y": 940, "w": 1720, "h": 100, "color": "#FFFFFF", "qrSrc": "video/c07/qrcode.png", "qrSize": 80, "text": "扫描二维码投递 · jobs@yunqi.example", "textColor": "#1B2733", "fontSize": 30, "fontWeight": 500, "textAlign": "right"}}
  ],
  "animations": [
    {"id": "an_brandbar_in", "targetElementId": "el_brandbar", "type": "scaleIn", "startFrame": 0, "durationFrames": 15, "fromValue": 0, "toValue": 1, "easing": "power2.out"},
    {"id": "an_photo_in", "targetElementId": "el_photo", "type": "scaleIn", "startFrame": 8, "durationFrames": 18, "fromValue": 0.9, "toValue": 1, "easing": "power2.out"},
    {"id": "an_info_in", "targetElementId": "el_infobar", "type": "scaleIn", "startFrame": 16, "durationFrames": 18, "fromValue": 0, "toValue": 1, "easing": "power2.out"},
    {"id": "an_steps_in", "targetElementId": "el_steps", "type": "scaleIn", "startFrame": 270, "durationFrames": 30, "fromValue": 0, "toValue": 1, "easing": "power3.out", "params": {"staggerFrames": 12}},
    {"id": "an_kpi_in", "targetElementId": "el_kpi", "type": "scaleIn", "startFrame": 600, "durationFrames": 24, "fromValue": 0, "toValue": 1, "easing": "back.out"},
    {"id": "an_cta_in", "targetElementId": "el_cta", "type": "move", "startFrame": 990, "durationFrames": 16, "from": {"y": 1000}, "to": {"y": 940}, "easing": "power2.out"}
  ],
  "effects": [
    {"id": "ef_headcount", "type": "counter", "targetElementId": "el_infobar", "anchor": {"wordId": "w04", "lastText": "三百二十人", "lastIndex": 3, "resolvedFrom": "exact", "status": "resolved"}, "params": {"from": 0, "to": 320, "suffix": " 人"}},
    {"id": "ef_projects", "type": "counter", "targetElementId": "el_kpi", "anchor": {"wordId": "w19", "lastText": "三百多个项目", "lastIndex": 18, "resolvedFrom": "exact", "status": "resolved"}, "params": {"from": 0, "to": 300, "suffix": "+ 项目"}},
    {"id": "ef_quote_hl", "type": "highlight", "targetElementId": "el_quote", "anchor": {"wordId": "w22", "lastText": "工程师", "lastIndex": 21, "occurrence": 1, "resolvedFrom": "exact", "status": "resolved"}, "params": {"color": "#FFD166"}}
  ],
  "assets": [
    {"key": "video/c07/office-env.jpg", "kind": "image", "bytes": 720000, "license": "实拍授权（示例）"},
    {"key": "video/c07/engineer-desk.jpg", "kind": "image", "bytes": 680000, "license": "实拍授权（示例）"},
    {"key": "video/c07/portrait-lina.jpg", "kind": "image", "bytes": 540000, "license": "肖像授权（示例）"},
    {"key": "video/c07/qrcode.png", "kind": "image", "bytes": 90000, "license": "内部资产"},
    {"key": "video/c07/bgm-corporate-100.m4a", "kind": "audio", "bytes": 880000, "license": "商用订阅（示例）"}
  ],
  "render": {"width": 1920, "height": 1080, "fps": 30, "crf": 19, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "hard", "fontSizePx": 40, "maxLineRunes": 16, "maxLines": 2}, "thumbnail": {"atSec": 20.0}}
}
```

> 锚点：重复词"工程师" w06(occurrence=0)/w22(occurrence=1)；跨词锚点"弹性工作制" w15+w16，福利卡标题按 w16 解析。

#### 3.3.4 现状降级映射

| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-10 团队规模数字滚动 | `counter` + `targetElementId=el_infobar` + 元素内定位 | 现 IR 有 counter，但自建容器无 x/y/w/h、固定 96 px/700（`[代码] timeline-builder.js:232-241`） | ⚠️ | 人数数字在画布左上原点，不在右栏标题位；字号不可配；后缀" 人"可配。KPI"300+ 项目"同理 |
| T-09 流程步骤错峰 | 每步独立元素 + 各自 startFrame；或 `params.staggerFrames` | 元素无 startFrame/endFrame；动画仅 move/scaleIn/rotate（`[代码] ir.go:100-116`）；`staggerFrames` 为目标参数，现实现无解析 | ⚠️ | 五步作为 el_steps 单卡整体入场，步骤间 12 帧错峰不可见；stagger 被忽略时表现为整卡一次 scaleIn |
| T-02 多图层（员工图 + 信息条 + 品牌条） | `tracks[]` + `trackId` + 轨道级显隐 | 无 trackId；元素保留 `z`（`[代码] ir.go:118-134`），层级靠 z + append 顺序 | ⚠️ | 三层可叠放，不能按轨道整体退出；品牌条全程在屏的语义靠"不显隐 + 高 z"近似，无轨道状态可查 |
| T-01 版式分栏 | `params.layout{columns,gutter,gridTemplate}` 响应式网格 | text/shape 仅手工 x/y/w/h（`[代码] ir.go:118-134`）；分栏由多元素拼坐标实现 | ⚠️ | 栏宽栏间距固定 px，无自适应；栏内换行只在空格处折行，纯中文按 rune 硬切（`[代码] subtitle.go:66-96`），长步骤名可能切在词中间 |
| T-14 硬字幕 | `render.subtitle.mode=hard` + libass | `BurnSubtitles` 无 libass 时降级软字幕 sidecar（`[代码] encode.go:188-238`） | ⚠️ | 降级路径成片无内嵌字幕；footer 邮箱属画面文字，不依赖字幕轨 |
| T-13 BGM 循环与响度 | bgm 循环 + loudnorm -16 LUFS | MuxAV 无 loop/loudnorm/apad/aresample（`[代码] encode.go:147-185`）；预览无 audio 节点（`[代码] timeline-builder.js:36-40`） | ⛔ | 40 s BGM 截到人声时长；响度未归一；预览听不到混音比例 |
| 动画参数位置（from/to/easing） | 目标 schema：`params.from/to/easing`；现实现：`ElementAnimation` 读顶层 `from/to/fromValue/toValue/easing`（`[代码] ir.go:100-116`） | 案例 IR 以顶层为准：move 用顶层 `from/to`，scaleIn/rotate 用顶层 `fromValue/toValue`，`easing` 顶层；`staggerFrames` 等 extras 仍进 `extra` | ⚠️ | 若把三键放回 `params`，入场/缩放静默落 0 帧；顶层写法与现实现一致 |
| 复合参数键（§5.16 P2-7/P2-8 提案） | `params.title/headcountText/titleColor/steps/stepColor/numberColor/cards/cardColor/quote/author/quoteColor/accent/paddingX/qrSrc/qrSize/textColor` | 现 builder 仅消费 image/text/shape 标准坐标与字号字段，复合键落 `extra`（`[代码] ir.go:118-134`） | ⛔ 依赖 §5.16 P2-7/P2-8 提案 | 现 builder 不消费这些键，画面不出现对应效果（流程列表、KPI 卡、引言署名、二维码贴图须素材侧预置） |

#### 3.3.5 预期帧表

| 帧号 | 时刻(s) | 期望画面状态 | 断言类型 |
|---|---|---|---|
| F0 | 0.00 | 品牌条/图/信息条/人数元素挂载；动画起始；counter=0 | DOM：8 元素挂载；帧：品牌条区 (0,40,1920,80) 深蓝 ≥85% |
| F30 | 1.00 | 品牌条与图落定；信息条 scaleIn 中段；counter 中段（数值 ∈ [100,220]，`[待验证]` 缓动标定） | DOM：el_infobar scale ∈ [0.5,0.9]；A-C07-01 |
| F60 | 2.00 | 人数落定 320；公司名与年份完整 | 帧：右栏 (860,380,940,120) 深蓝数字存在；文本稳定到 F119 |
| F120 | 4.00 | 镜号 2：工位图替换环境图；链路四节点标题在信息条内 | DOM：图片换源（现实现需两 image 节点切换显隐——降级记录）；帧：左栏色温更新 |
| F270 | 9.00 | 步骤层入场起始；五步编号待显现 | DOM：el_steps scaleIn；帧：右栏步骤区前景占比从 0 上升 |
| F306 | 10.20 | 错峰第 4 步位置（270+3×12）；可见步骤 ≥4（目标语义；现实现整卡入场时此断言降级为"整卡可见"） | DOM/帧：编号逐行出现；A-C07-02 |
| F600 | 20.00 | KPI 入场；三格 40+/300+/82%；项目数 counter 0→300 | DOM：el_kpi scaleIn；帧：三格等宽排布 |
| F660 | 22.00 | KPI 落定；counter ∈ [200,280]（`[待验证]` 缓动标定）；复购率 82% 静态 | 帧：KPI 数字可辨识；A-C07-03 |
| F810 | 27.00 | 引言卡入场；左栏头像；署名在卡内 | DOM：el_quote scaleIn；帧：引号图形金色 `#E8A33D` 可见 |
| F990 | 33.00 | footer 入场；二维码 + 邮箱；前序图层退出 | DOM：el_cta move；帧：右下二维码区 (1580,950,80,80) 黑白图案 ≥50% |
| F1199 | 39.97 | 尾帧：品牌条 + footer 同屏；bbox 不越界 | MP4：40.00 s / 30 fps / 1200 帧；DOM：bbox 全在界内 |

#### 3.3.6 断言

**可量化视觉断言**

| ID | 判定对象 | 区域/通道 | 判据与阈值 | 失败含义 |
|---|---|---|---|---|
| A-C07-01 | 双栏边界 | 左栏 (120,160,660,620)、右栏 (860,160,940,620) | 内容 bbox 不跨栏中线 x=820 | 版式串栏 |
| A-C07-02 | 步骤错峰 | el_steps 内五行 | 目标：F270/F282/F294/F306/F318 依次出现；现实现降级为整卡 F270–F300 可见，报告标注 | 错峰语义丢失被误判通过 |
| A-C07-03 | KPI 同源性 | el_kpi 三格 | 数字 40 / 300 / 82 与 S5 一致；counter 后缀与格标题一致 | 数字口径错误 |
| A-C07-04 | 品牌条全程在屏 | (0,40,1920,80) 深蓝通道 | F0–F1199 每帧深蓝 ≥85%（转场 fade 帧除外） | 品牌层显隐错误 |
| A-C07-05 | 二维码可识别性 | (1580,950,80,80) | 黑白像素占比 ∈ [45%,70%]；无纯色填充（可扫码性需独立解码测试 `[待验证]`） | 二维码被压缩或渲染空白 |

**自动化断言**：IR 层（L0）：meta 1920×1080/30/40.0；words 单调不重叠；`voice.durationSec` ≥ 末词 end=34.50；src/key 前缀校验；elements=8 ≤64；counter params 仅 `from/to/suffix`（`[代码] ir.go:322-345`）；easing 白名单（`[代码] ir.go:171`）。DOM 层（L4）：元素 8 个；品牌条 z 高于主层；counter 位于原点（已知降级，显式记录）；图片切换在现实现下需两节点，断言记录差异。帧层（L1）：F30/F60/F270/F306/F600/F660/F810/F990/F1199 golden；坏图 decode 吞错单独断言空白占位（`[代码] timeline-builder.js:225-229`）。MP4 层（L2/L3）：30 fps、1920×1080、yuv420p、40.00 s ±1 帧；音频流存在；硬字幕降级时 sidecar SRT 存在。

**人工验收点**：① 七段顺序与 S1→S7 对应，流程五步编号与旁白一致无跳步；② 320 人 / 300+ 项目 / 82% 与旁白一致，无 counter 位数残留；③ 引言署名与头像对应，文字无错字、引号完整；④ 二维码保持 ≥480×480 素材净尺寸，缩放后仍可扫码；⑤ 品牌条全程不被信息条/照片覆盖，footer 段字幕不压二维码。

**失败注入**

| ID | 注入点 | 注入内容 | 期望错误码 / 降级行为 |
|---|---|---|---|
| F-C07-01 | counter 参数 | ef_headcount 删除 `to` 字段 | IR 校验 400 `E_VIDEO_INVALID_IR`（params 白名单 `[代码] ir.go:322-345`）；不进渲染 |
| F-C07-02 | 重复词锚点 | ef_quote_hl 锚点"工程师"不带 occurrence | 目标：400 `E_VIDEO_ANCHOR_AMBIGUOUS`；现实现：same_text 取 w06，偏移进 warnings |
| F-C07-03 | 素材 src | el_photo.src 改为 `data:image/png;base64,...` | IR 校验 400 `E_VIDEO_INVALID_IR`（`[代码] ir.go:355-365`）；data URI 拒绝 |
| F-C07-04 | meta fps | 改为 12 | IR 校验 400 `E_VIDEO_INVALID_IR`（fps 白名单 `[代码] ir.go:161`） |

#### 3.3.7 当前可实现性小结

**结论**：双栏骨架、品牌条分层、两类 counter 与流程/福利/KPI 卡片可出 still 与基础 MP4；步骤级错峰、元素级 counter 定位、轨道级显隐、响应式分栏为降级项（§3.3.4）；引言高亮在现实现下是整层闪现，验收不得写成"引言词变色"。**阻塞项**：子元素/步骤级动画与 stagger、counter 坐标字段、track 分组显隐、layout 网格参数、BGM loop/loudnorm——对应基线 §1.8 矩阵 C07 行。

### 3.4 VS-C08 节日促销

#### 3.4.1 案例头

| 字段 | 值 |
|---|---|
| 案例 ID / 名称 | VS-C08 节日促销（年终大促优惠券 + 倒计时） |
| 内容类型 | 方形促销海报式短视频（券面 + 倒计时 + 领券 CTA） |
| 目标受众 | 价格敏感型购物人群；社交方形信息流与店铺首页访客 |
| 发布渠道 | 抖音/小红书方形帖、店铺首页弹窗、社群转发 |
| 画幅 / fps / 时长 | 1080×1080 / 30 / 20.00 s（ceil=600，round=600） |
| 语言 | 中文普通话 |
| 优先级 / 依赖 | P2；券面样式参照 C01，翻转降级参照 C02 |

#### 3.4.2 创作规格

**主张**：方形内"开场氛围 → 三券依次翻转 → 倒计时收口 → 领券 CTA"，粒子层承担氛围，券面与倒计时承担转化。**场景**：方形缩略图与图文并列，首帧须在缩略尺寸读出"大促 + 折扣"；券面面额字号不低于促销标题 60%。

**渠道硬规格**：1080×1080、30 fps、20 s；安全区四边各 60 px；券面三列等宽、间距 30 px；倒计时位于下三分之一居中。构图为方形中心对称（区别于 C01 竖屏上下流、C02 横屏分镜、C07 双栏图文）：粒子环绕四周，券面横排三列，倒计时与 CTA 沿中轴叠放。红底大面积纯色易出压缩块，粒子金/白小面积点缀，券面浅底保证深字对比，不用细描边券孔。

**逐句脚本（成稿）**：
- S1（0.00–2.97）年终大促开始了，全场两件八折。
- S2（3.00–6.97）第一张券满一百九十九减三十，第二张券满三百九十九减八十。
- S3（7.00–10.97）第三张券满六百九十九减一百五十，仅限今天。
- S4（11.00–14.97）倒计时十五秒，手慢无。
- S5（15.00–19.97）点击领取优惠券，结算时自动抵扣。

**分镜表**（30 fps，末帧 599）：

| 镜号 | 帧范围 | 画面 | 图层/元素 | 动效与锚点词 | 字幕/音频 |
|---|---|---|---|---|---|
| 1 | F0–F89 | 红底；金白粒子自上而下飘落；标题 + 副标"两件八折" | el_bg / el_confetti / el_headline | 标题 scaleIn；粒子 shape 阵列 move 下落（T-04 替代）；锚点"大促""八折" | S1；字幕单行；BGM 起 |
| 2 | F90–F209 | 券 1、券 2 依次翻转入场，横排左中 | el_coupon1 / el_coupon2 | 券面翻转（T-05 目标 rotateY；现 scaleX 近似）；卡点入场（T-09）；锚点"券""满" | S2；字幕"满 199 减 30 · 满 399 减 80" |
| 3 | F210–F329 | 券 3 补齐三列；"仅限今天"标签贴券 3 角 | el_coupon3 | 券 3 翻转 + scaleIn；锚点"券"(occurrence=2)；高亮"仅限今天" | S3；字幕"满 699 减 150 · 仅限今天" |
| 4 | F330–F449 | 券面缩至上方；中轴倒计时 15→0；粒子密度降低 | el_countdown / el_confetti | counter 15→0（T-10）；锚点"十五秒""手慢无" | S4；字幕"倒计时 15 秒" |
| 5 | F450–F599 | CTA 条居中；券面保持；F585 起轻 fade | el_cta；券面保持 | CTA scaleIn+move；跨词锚点"自动抵扣"(w21+w22)；F585 整片 fade | S5；字幕"结算时自动抵扣"；BGM 收束 |

**版式**：中轴对称；标题 y90–230、券面行 y300–620（三列各宽 300 px、间距 30 px）、倒计时 y700–820、CTA y880–980。字号：标题 72/900、券门槛 30/500、券面额 56/900、倒计时 96/900、CTA 36/700；行高 1.3；全部居中。

**色彩**：背景 `#B3261E`（目标渐变 `#7A1F2B→#B3261E`）；券面 `#FFF3E0`；强调金 `#FFD166`；面额字 `#1B2733`；CTA 白 `#FFFFFF`。对比度目标 ≥4.5:1（`[外部] WCAG 见 §3.1.2`），实测 `[待验证]`。**字体**：中文 `Noto Sans SC` 500/700/900；数字 `Inter` 900；粒子为 shape 图形，不依赖字体字形；无 emoji、无生僻字。

**素材清单**：`video/c08/bgm-festive-126.m4a`（BGM，44.1 kHz / 126 BPM / ≤800 KiB，商用订阅示例）；`video/c08/confetti-shapes.svg`（粒子图形定义，矩形/圆点两型，内部资产）。

**音频**：voice `zh-CN-XiaoxiaoNeural`，rate 1.15，-14 LUFS；BGM 126 BPM、音量 0.24、目标循环，-16 LUFS。现实现无 loop/loudnorm/apad（`[代码] encode.go:147-185`），预览无 audio 节点（`[代码] timeline-builder.js:36-40`）。**字幕**：硬字幕 y800–850（倒计时段让位 y640–690）；≤16 rune/行、≤2 行；券面数字不进字幕轨。

#### 3.4.3 IR 规格（目标 schema）

```json
{
  "schemaVersion": 1,
  "meta": {"width": 1080, "height": 1080, "fps": 30, "durationSec": 20.0, "background": "#B3261E"},
  "script": "年终大促开始了，全场两件八折。第一张券满一百九十九减三十，第二张券满三百九十九减八十。第三张券满六百九十九减一百五十，仅限今天。倒计时十五秒，手慢无。点击领取优惠券，结算时自动抵扣。",
  "words": [{"id": "w01", "index": 0, "start": 0.0, "end": 0.48, "text": "年终大促", "source": "aligner", "confidence": 0.96, "scriptStart": 0, "scriptEnd": 4}, {"id": "w02", "index": 1, "start": 0.9, "end": 1.1, "text": "全场", "source": "aligner", "confidence": 0.96, "scriptStart": 8, "scriptEnd": 10}, {"id": "w03", "index": 2, "start": 1.1, "end": 1.56, "text": "两件八折", "source": "aligner", "confidence": 0.94, "scriptStart": 10, "scriptEnd": 15}, {"id": "w04", "index": 3, "start": 3.0, "end": 3.36, "text": "第一张券", "source": "aligner", "confidence": 0.95, "scriptStart": 17, "scriptEnd": 21}, {"id": "w05", "index": 4, "start": 3.36, "end": 3.54, "text": "满", "source": "aligner", "confidence": 0.97, "scriptStart": 21, "scriptEnd": 22}, {"id": "w06", "index": 5, "start": 3.54, "end": 3.96, "text": "一百九十九", "source": "aligner", "confidence": 0.93, "scriptStart": 22, "scriptEnd": 27}, {"id": "w07", "index": 6, "start": 3.96, "end": 4.28, "text": "减三十", "source": "aligner", "confidence": 0.95, "scriptStart": 27, "scriptEnd": 30}, {"id": "w08", "index": 7, "start": 4.32, "end": 4.68, "text": "第二张券", "source": "aligner", "confidence": 0.95, "scriptStart": 31, "scriptEnd": 35}, {"id": "w09", "index": 8, "start": 4.68, "end": 4.86, "text": "满", "source": "aligner", "confidence": 0.97, "scriptStart": 35, "scriptEnd": 36}, {"id": "w10", "index": 9, "start": 4.86, "end": 5.28, "text": "三百九十九", "source": "aligner", "confidence": 0.93, "scriptStart": 36, "scriptEnd": 41}, {"id": "w11", "index": 10, "start": 5.28, "end": 5.6, "text": "减八十", "source": "aligner", "confidence": 0.95, "scriptStart": 41, "scriptEnd": 44}, {"id": "w12", "index": 11, "start": 7.0, "end": 7.36, "text": "第三张券", "source": "aligner", "confidence": 0.95, "scriptStart": 46, "scriptEnd": 50}, {"id": "w13", "index": 12, "start": 7.36, "end": 7.54, "text": "满", "source": "aligner", "confidence": 0.97, "scriptStart": 50, "scriptEnd": 51}, {"id": "w14", "index": 13, "start": 7.54, "end": 7.96, "text": "六百九十九", "source": "aligner", "confidence": 0.93, "scriptStart": 51, "scriptEnd": 56}, {"id": "w15", "index": 14, "start": 7.96, "end": 8.4, "text": "减一百五十", "source": "aligner", "confidence": 0.92, "scriptStart": 56, "scriptEnd": 61}, {"id": "w16", "index": 15, "start": 8.44, "end": 8.92, "text": "仅限今天", "source": "aligner", "confidence": 0.96, "scriptStart": 62, "scriptEnd": 66}, {"id": "w17", "index": 16, "start": 11.0, "end": 11.36, "text": "倒计时", "source": "aligner", "confidence": 0.97, "scriptStart": 68, "scriptEnd": 71}, {"id": "w18", "index": 17, "start": 11.36, "end": 11.66, "text": "十五秒", "source": "aligner", "confidence": 0.95, "scriptStart": 71, "scriptEnd": 74}, {"id": "w19", "index": 18, "start": 11.7, "end": 12.16, "text": "手慢无", "source": "aligner", "confidence": 0.95, "scriptStart": 75, "scriptEnd": 78}, {"id": "w20", "index": 19, "start": 15.0, "end": 15.18, "text": "点击", "source": "aligner", "confidence": 0.96, "scriptStart": 80, "scriptEnd": 82}, {"id": "w21", "index": 20, "start": 15.98, "end": 16.19, "text": "自动", "source": "aligner", "confidence": 0.96, "scriptStart": 90, "scriptEnd": 92}, {"id": "w22", "index": 21, "start": 16.19, "end": 16.5, "text": "抵扣", "source": "aligner", "confidence": 0.96, "scriptStart": 92, "scriptEnd": 94}],
  "tracks": [{"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_particles", "kind": "overlay", "z": 5}, {"id": "tr_coupons", "kind": "overlay", "z": 10}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.24, "assetKey": "video/c08/bgm-festive-126.m4a"}],
  "elements": [
    {"id": "el_bg", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 599, "params": {"x": 0, "y": 0, "w": 1080, "h": 1080, "color": "#B3261E", "gradient": {"from": "#7A1F2B", "to": "#B3261E", "direction": "vertical"}}},
    {"id": "el_confetti", "type": "shape", "trackId": "tr_particles", "startFrame": 0, "endFrame": 599, "params": {"count": 18, "origin": "top", "spread": 1.0, "velocity": 2.4, "gravity": 0.05, "life": 2.4, "opacityEnvelope": [1.0, 0.0], "blendMode": "source-over", "seed": 7, "shapes": ["rect", "dot"], "colors": ["#FFD166", "#FFFFFF"]}},
    {"id": "el_headline", "type": "text", "trackId": "tr_coupons", "startFrame": 0, "endFrame": 89, "params": {"text": "年终大促 · 全场两件八折", "x": 60, "y": 90, "w": 960, "h": 140, "fontSize": 72, "fontWeight": 900, "color": "#FFFFFF", "textAlign": "center"}},
    {"id": "el_coupon1", "type": "shape", "trackId": "tr_coupons", "startFrame": 90, "endFrame": 599, "params": {"x": 90, "y": 300, "w": 300, "h": 320, "color": "#FFF3E0", "threshold": "满 199", "face": "减 30", "tag": "券 1", "textColor": "#1B2733", "accent": "#E8A33D", "fontSize": 56, "fontWeight": 900}},
    {"id": "el_coupon2", "type": "shape", "trackId": "tr_coupons", "startFrame": 130, "endFrame": 599, "params": {"x": 390, "y": 300, "w": 300, "h": 320, "color": "#FFF3E0", "threshold": "满 399", "face": "减 80", "tag": "券 2", "textColor": "#1B2733", "accent": "#E8A33D", "fontSize": 56, "fontWeight": 900}},
    {"id": "el_coupon3", "type": "shape", "trackId": "tr_coupons", "startFrame": 210, "endFrame": 599, "params": {"x": 690, "y": 300, "w": 300, "h": 320, "color": "#FFF3E0", "threshold": "满 699", "face": "减 150", "tag": "券 3", "badge": "仅限今天", "textColor": "#1B2733", "accent": "#E8A33D", "fontSize": 56, "fontWeight": 900}},
    {"id": "el_countdown", "type": "text", "trackId": "tr_coupons", "startFrame": 330, "endFrame": 449, "params": {"text": "15", "x": 340, "y": 700, "w": 400, "h": 120, "fontSize": 96, "fontWeight": 900, "color": "#FFD166", "textAlign": "center", "suffix": "s"}},
    {"id": "el_cta", "type": "shape", "trackId": "tr_coupons", "startFrame": 450, "endFrame": 599, "params": {"x": 190, "y": 880, "w": 700, "h": 100, "color": "#FFFFFF", "text": "点击领取优惠券 · 结算自动抵扣", "textColor": "#B3261E", "fontSize": 36, "fontWeight": 700, "textAlign": "center"}}
  ],
  "animations": [
    {"id": "an_headline_in", "targetElementId": "el_headline", "type": "scaleIn", "startFrame": 0, "durationFrames": 15, "fromValue": 0, "toValue": 1, "easing": "power2.out"},
    {"id": "an_confetti_fall", "targetElementId": "el_confetti", "type": "move", "startFrame": 0, "durationFrames": 600, "from": {"y": -40}, "to": {"y": 1080}, "easing": "linear", "params": {"loop": true}},
    {"id": "an_coupon1_flip", "targetElementId": "el_coupon1", "type": "scaleIn", "startFrame": 90, "durationFrames": 18, "fromValue": 0, "toValue": 1, "easing": "back.out", "params": {"flipAxis": "rotateY"}},
    {"id": "an_coupon2_flip", "targetElementId": "el_coupon2", "type": "scaleIn", "startFrame": 130, "durationFrames": 18, "fromValue": 0, "toValue": 1, "easing": "back.out", "params": {"flipAxis": "rotateY"}},
    {"id": "an_coupon3_flip", "targetElementId": "el_coupon3", "type": "scaleIn", "startFrame": 210, "durationFrames": 18, "fromValue": 0, "toValue": 1, "easing": "back.out", "params": {"flipAxis": "rotateY"}},
    {"id": "an_cta_in", "targetElementId": "el_cta", "type": "move", "startFrame": 450, "durationFrames": 14, "from": {"y": 940}, "to": {"y": 880}, "easing": "power2.out"}
  ],
  "effects": [
    {"id": "ef_countdown", "type": "counter", "targetElementId": "el_countdown", "anchor": {"wordId": "w18", "lastText": "十五秒", "lastIndex": 17, "resolvedFrom": "exact", "status": "resolved"}, "params": {"from": 15, "to": 0, "suffix": "s"}},
    {"id": "ef_coupon_pulse", "type": "pulse", "targetElementId": "el_coupon2", "anchor": {"wordId": "w08", "lastText": "第二张券", "lastIndex": 7, "occurrence": 1, "resolvedFrom": "exact", "status": "resolved"}, "params": {"scale": 1.05}},
    {"id": "ef_cta_hl", "type": "highlight", "targetElementId": "el_cta", "anchor": {"wordId": "w22", "lastText": "抵扣", "lastIndex": 21, "resolvedFrom": "exact", "status": "resolved"}, "params": {"color": "#FFD166"}}
  ],
  "assets": [
    {"key": "video/c08/bgm-festive-126.m4a", "kind": "audio", "bytes": 780000, "license": "商用订阅（示例）"},
    {"key": "video/c08/confetti-shapes.svg", "kind": "vector", "bytes": 12000, "license": "内部资产"}
  ],
  "render": {"width": 1080, "height": 1080, "fps": 30, "crf": 18, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "hard", "fontSizePx": 44, "maxLineRunes": 16, "maxLines": 2}, "thumbnail": {"atSec": 3.0}}
}
```

> 锚点：重复词"满" w05/w09/w13；券短语"第一张券/第二张券/第三张券" w04/w08/w12（occurrence 0/1/2）；跨词锚点"自动抵扣" w21+w22，ef_cta_hl 按 w22 解析。

#### 3.4.4 现状降级映射

| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-04 粒子与粒子替代 | `element.type=particles` + `params{count,origin,spread,velocity,gravity,life,opacityEnvelope,blendMode,seed,shapes,colors}`（§5.16 P2-6 规范命名） | 元素类型仅 image/text/shape（`[代码] ir.go:118-134`）；粒子只能由多个 shape 阵列近似，受 elements ≤64 上限约束（`[代码] ir.go:152-159`） | ⚠️ | 无粒子系统：18 片彩带/圆点为静态 shape 阵列，无重力加速度、无随机散布与旋转；`loop` 参数现实现无解析，下落只播一次；超 64 片必须减片降级 |
| T-10 倒计时与券面面额 | counter 支持 `format:"hh:mm:ss"`、前导零 + 元素内定位 | counter 参数仅 `{from,to,suffix}`（`[代码] ir.go:322-345`），无时间格式；容器无 x/y/w/h（`[代码] timeline-builder.js:232-241`） | ⚠️ | 倒计时为纯整数 15→0，无 `00:15` 格式与前导零；数字出现在左上原点，不在中轴 y=700；券面面额是静态 shape，不走 counter |
| T-09 卡点入场 | 动画 `startAnchor=beat`，挂 BGM 节拍点 | 锚点只挂 word（`[代码] ir.go:74`）；无 beat 轨道；入场时间手写 startFrame | ⚠️ | 券 1/2/3 间隔（90/130/210 帧）为静态帧号，不随 BGM 变速；预览无音频（`[代码] timeline-builder.js:36-40`），卡点无法对拍 |
| T-05 轻量伪 3D（优惠券翻转） | `params.transform{rotateY, backfaceSrc, perspective}` | 动画仅 move/scaleIn/rotate，rotate 为 2D（`[代码] ir.go:100-116`）；`flipAxis` 为目标参数，现实现无解析 | ⛔ | 翻转为 scaleX 1→0→1 平面近似（或整卡 scaleIn）；无 rotateY 纵深、无背面贴图，"翻过来"的立体观感不可复现 |
| T-02 粒子层 / 券面层 / CTA 层 | `tracks[]` 分组 + `trackId` | 现 IR 无 trackId；层级靠 `z` + append 顺序（`[代码] ir.go:118-134`） | ⚠️ | 粒子与券面可叠放，不能按层整体显隐；倒计时段粒子密度降低需逐片写动画或预置两套阵列 |
| T-13 BGM 循环与响度 | bgm 循环 + loudnorm -16 LUFS | MuxAV 无 loop/loudnorm/apad/aresample（`[代码] encode.go:147-185`） | ⛔ | 20 s BGM 截到人声时长；响度未归一；预览无声 |
| 动画参数位置（from/to/easing） | 目标 schema：`params.from/to/easing`；现实现：`ElementAnimation` 读顶层 `from/to/fromValue/toValue/easing`（`[代码] ir.go:100-116`） | 案例 IR 以顶层为准：move 用顶层 `from/to`，scaleIn/rotate 用顶层 `fromValue/toValue`，`easing` 顶层；`flipAxis/loop` 等 extras 仍进 `extra` | ⚠️ | 若把三键放回 `params`，入场/缩放静默落 0 帧；顶层写法与现实现一致 |
| 复合参数键（§5.16 P2-7/P2-8 提案） | `params.threshold/face/tag/badge/textColor/accent/suffix/gradient`（粒子规范键见 T-04 行） | 现 builder 仅消费 image/text/shape 标准坐标与字号字段，复合键落 `extra`（`[代码] ir.go:118-134`） | ⛔ 依赖 §5.16 P2-7/P2-8 提案 | 现 builder 不消费这些键，画面不出现对应效果（券面门槛/面额/角标、渐变背景须素材侧预置） |

#### 3.4.5 预期帧表

| 帧号 | 时刻(s) | 期望画面状态 | 断言类型 |
|---|---|---|---|
| F0 | 0.00 | 红底铺满；标题 scale=0；粒子阵列在顶部外；券面/倒计时/CTA 未入场 | DOM：8 元素挂载；帧：红通道均值 ≈ `#B3261E` |
| F15 | 0.50 | 标题落定；粒子开始下落（首片进入画面） | 帧：标题区 (60,90,960,140) 白文字 ≥15%；A-C08-01 |
| F90 | 3.00 | 券 1 翻转入场起始；左列显现 | DOM：el_coupon1 启动；帧：左列 (90,300,300,320) 浅底 `#FFF3E0` 出现 |
| F130 | 4.33 | 券 2 入场；券 1 落定；两券横排 | DOM：el_coupon2 启动；帧：中列浅底出现；A-C08-02 |
| F210 | 7.00 | 券 3 补齐三列；"仅限今天"标签在券 3 角 | 帧：三列等宽、间距 30 px；券 3 角金色标签可见 |
| F270 | 9.00 | 三券落定；面额"减 30 / 减 80 / 减 150"与 S2/S3 一致 | 帧：券面深面额字边缘密度达标；A-C08-03 |
| F330 | 11.00 | 倒计时入场；counter 起始 15；券面缩至上方保持 | DOM：el_countdown 挂载；帧：中轴 y=700 出现金色数字（现实现降级为原点位置，见 §3.4.4） |
| F390 | 13.00 | 倒计时中段（数值 ∈ [6,10]，`[待验证]` 缓动标定）；粒子密度降低 | 帧：数字字形存在；粒子像素占比较 F45 下降 ≥30% |
| F450 | 15.00 | CTA 入场起始；白底细红字条居中 | DOM：el_cta move；帧：底条 (190,880,700,100) 白底 ≥80% |
| F599 | 19.97 | 尾帧：三券 + CTA 同屏；bbox 不越界 | MP4：20.00 s / 30 fps / 600 帧；DOM：bbox 全在界内 |

#### 3.4.6 断言

**可量化视觉断言**

| ID | 判定对象 | 区域/通道 | 判据与阈值 | 失败含义 |
|---|---|---|---|---|
| A-C08-01 | 标题可读 | (60,90,960,140) 白通道 | F15 白文字 ≥15%；标题不被粒子遮挡 | 钩子在缩略图下不可读 |
| A-C08-02 | 券列等宽 | 三列 x 90/390/690，宽 300，间距 30 | 三券 bbox 宽差 ≤4 px；列间红底条带宽 ∈ [26,34] px | 券面挤压或错位 |
| A-C08-03 | 面额同源 | 三券面额字 | 文本"减 30 / 减 80 / 减 150"与 S2/S3 逐字一致 | 优惠口径错误 |
| A-C08-04 | 粒子不压中心 | 券面行 y300–620 | 粒子像素在券面浅底区内占比 ≤10% | 氛围粒子遮挡优惠信息 |
| A-C08-05 | 红底纯度 | 非券面/非文字区 | 红通道均值 ΔE ≤5（`[待验证]` 阈值 L1 标定） | 背景被粒子或特效污染 |

**自动化断言**：IR 层（L0）：meta 1080×1080/30/20.0；words 单调不重叠；`voice.durationSec` ≥ 末词 end=16.50；elements=8 ≤64；counter params 白名单；easing 白名单；粒子 count=18 展开为 shape 阵列时总数 ≤64（`[代码] ir.go:152-159`）。DOM 层（L4）：元素 8 个；粒子层展开后节点数 = 1+18，断言记录差异；counter 在原点（已知降级显式记录）；`flipAxis/loop/gradient` 为目标字段，现实现未知类型 skip + warn（`[代码] timeline-builder.js:183-185`、`:192-194`），warn 须进报告。帧层（L1）：F15/F90/F130/F210/F270/F330/F390/F450/F599 golden；坏图 decode 吞错单独断言空白占位（`[代码] timeline-builder.js:225-229`）。MP4 层（L2/L3）：30 fps、1080×1080、yuv420p、20.00 s ±1 帧；音频流存在；倒计时 F449 后数字不再变化。

**人工验收点**：① 三券门槛面额（199/30、399/80、699/150）与旁白顺序一致，无张冠李戴；② 倒计时 15→0 无跳帧、无负数、无格式残留；③ 粒子不遮挡券面额文字；④ CTA 文字与 S5 一致，"自动抵扣"不拆两行；⑤ 缩略图尺寸下首帧可读出"大促 + 八折"。

**失败注入**

| ID | 注入点 | 注入内容 | 期望错误码 / 降级行为 |
|---|---|---|---|
| F-C08-01 | 粒子数量 | el_confetti.count 提至 80，展开后 elements >64 | IR 校验 400 `E_VIDEO_INVALID_IR`（元素上限 `[代码] ir.go:152-159`）；超限负载另走 413 `E_VIDEO_PAYLOAD_TOO_LARGE`（架构文档 §10.5） |
| F-C08-02 | counter 锚点 | ef_countdown wordId 指向已删除词 | 目标：400 `E_VIDEO_ANCHOR_NOT_FOUND`；现实现：effect skip + warn（`[代码] timeline-builder.js:191`），倒计时不滚动 |
| F-C08-03 | schemaVersion | 未知版本 | 渲染拒绝 400 `E_VIDEO_UNSUPPORTED_SCHEMA`（架构文档 §5.2 不变量 6） |
| F-C08-04 | BGM 资产 | track assetKey 指向未上传 key | 渲染期 404 `E_VIDEO_ASSET_NOT_FOUND`（架构文档 §10.5）；不回退静音素材静默通过 |

#### 3.4.7 当前可实现性小结

**结论**：方形构图、三券横排、倒计时整数滚动与 CTA 可出 still 与基础 MP4；粒子系统、券面 rotateY 翻转、倒计时时间格式、元素级 counter 定位、beat 卡点为阻塞或降级项（§3.4.4）；现实现下"粒子"是静态 shape 阵列、"翻转"是平面缩放近似，验收不得写成"3D 翻券"或"物理粒子"。**阻塞项**：particles 元素类型与物理参数、transform rotateY/backface、counter 格式与坐标字段、beat 锚点轨道、track 分组显隐、BGM loop/loudnorm——对应基线 §1.8 矩阵 C08 行。

## 4. 案例集 B：解释与纪实

> 本节为 Video Studio「真实内容案例库」的解释 / 纪实部分，覆盖 VS-C03（知识科普）、VS-C04（数据可视化口播）、VS-C05（旅行 / 生活方式）、VS-C06（访谈 / 字幕）、VS-C09（产品功能演示）。
>
> **证据与边界**：本节所有 IR 均为**目标 schema 输入规格**，不代表当前 Player 已实现；技术现状结论逐条引自基线 `baseline-v0.md` §2（对应仓库 `example/internal/video/app/ir.go`、`timeline-builder.js`、`subtitle.go`、`platform/capx/encode.go`）。证据标记：`[实测]` 本轮跑过命令；`[代码]` 读代码得出并附文件:行号；`[外部]` 官方文档 / 规范并附 URL；`[待验证]` 推断，附验证方法。本轮**未跑**渲染流水线，所有帧级断言均为待执行计划，不表述为"已通过"。
>
> **帧数口径**：目标 schema 帧数 `ceil(durationSec × fps)`（架构文档 §5.2）；现实现 `Math.round(durationSec × fps)`（`[代码] timeline-builder.js:41`）。本批五个案例时长均为整数秒，两者结果相同；若出现 8.04s@30fps 这类值，round 与 ceil 会差 1 帧。
>
> **技术点 ID**（全文档统一，不自创）：T-01 复杂排版与 CJK 字距 / 换行；T-02 多图层与层级；T-03 遮罩 / 裁剪；T-04 粒子与粒子替代；T-05 伪 3D 透视；T-06 镜头推进 / 平移；T-07 转场；T-08 路径运动；T-09 错峰入场；T-10 数字滚动；T-11 图表生长；T-12 文字高亮 / 逐词动画；T-13 循环 BGM / 响度；T-14 软 / 硬字幕；T-15 缩略图 / 封面帧。

---

### 4.1 VS-C03「知识科普」：为什么天空是蓝色的

#### 4.1.1 案例头

| 字段 | 内容 |
|---|---|
| 案例 ID | VS-C03 |
| 名称 | 为什么天空是蓝色的（瑞利散射图解） |
| 内容类型 | 知识科普 / 原理图解 |
| 目标受众 | 12–18 岁学生及泛科学读者；竖屏刷到后停留理解一个物理概念 |
| 发布渠道 | 短视频信息流（竖屏）；首帧需在 1.5s 内给出"蓝天 + 问号"钩子 |
| 画幅 / 分辨率 | 1080×1920（9:16 竖屏） |
| fps | 30 |
| 时长 | 45.0s（目标帧数 ceil(45×30)=1350；现实现 round=1350） |
| 语言 | 普通话（中文配音 + 中文字幕） |
| 优先级 | P1 |
| 依赖案例 | 无（基础图层与逐词高亮能力依赖 §1 能力矩阵 L1 行） |

#### 4.1.2 创作规格
**一句话主张**：蓝天不是天空的颜色，而是短波长光被空气分子散射进眼睛的结果。
**受众与观看场景**：单手持机、竖屏、无外放（可能静音浏览），因此图解必须在静音状态下也能传递主结论；配音用于强化因果链。
**渠道硬规格**
- 时长 45s；竖屏 1080×1920；安全区：左右各留 72px，底部字幕区 y≥1620 避开平台 UI；顶部 y≤180 避开状态栏。
- 首帧钩子：蓝天渐变 + 标题"天空为什么是蓝色的？"，0.5s 内标题可读。
- 平台压缩预期：H.264 yuv420p，crf 18–22；蓝色梯度在压缩后不得出现条带（gradient banding），渐变步数 ≥256。
**完整逐句脚本（S1..S9，可直接配音）**
- S1 你有没有想过，晴天的天空为什么是蓝色的？
- S2 太阳发出的白光，其实是红、橙、黄、绿、蓝、紫等不同波长的光混合在一起。
- S3 空气里的氮、氧分子尺寸远小于可见光波长，会把照到它们的光向各个方向散射。
- S4 英国科学家瑞利发现，散射强度和波长的四次方成反比，也就是波长越短，散射越强。
- S5 红光波长约六百三十纳米，蓝光约四百三十纳米；按四次方估算，蓝光被散射的强度大约是红光的六倍。
- S6 于是蓝光在大气层里被反复散射，铺满整个天空；而红光沿直线传播，更多留在太阳附近。
- S7 到了傍晚，阳光斜穿更长的大气路径，短波蓝光沿途被散射掉，剩下长波的红与橙，这就是晚霞偏红的原因。
- S8 所以你看到的蓝天，不是天空本身有蓝色颜料，而是短波长的光被空气分子散射进了你的眼睛。
- S9 一句话总结：散射强度随波长四次方衰减，短波蓝光占优，天空因此呈现蓝色。
**科学事实与来源**
- 瑞利散射强度与波长四次方成反比（σ ∝ 1/λ⁴）；散射发生在尺寸远小于波长的分子上。`[外部]` NASA GISS, https://www.giss.nasa.gov/edu/icp/research/ppa/1997/reyes/
- 蓝光 λ≈430nm、红光 λ≈630nm 时，散射截面比 (630/430)⁴ ≈ 6.1。`[外部]` University of Rochester PHY218 Lecture 64, https://www.pas.rochester.edu/~dmw/phy218/Lectures/Lect_64p.pdf
- 蓝天成因与晚霞偏红的对照解释。`[外部]` 香港天文台教育资源, https://www.hko.gov.hk/sc/education/earth-science/optical-phenomena/00364-why-is-the-sky-blue.html
**分镜表**（帧号基于 30fps；帧范围可反推帧数 = 末帧 − 首帧 + 1）

| 镜号 | 帧范围 | 画面 | 图层 / 元素 | 动效与锚点词 | 字幕 / 音频 |
|---|---|---|---|---|---|
| 1 | 0–134 (0.0–4.5s) | 蓝天渐变背景 + 顶部标题 + 问号符号；太阳轮廓在左上 | tr_main: el_bg, el_sun；tr_annotation: el_title | el_title scaleIn 0→24 帧；锚点词"蓝色" | S1；BGM 淡入 0–3s |
| 2 | 135–314 (4.5–10.5s) | 白光分解为红橙黄绿蓝紫六条色带，横向排列 | tr_diagram: el_spectrum（六条 shape）；el_note 术语注释"波长" | 六条色带按 T-09 错峰入场，每条间隔 6 帧；锚点"波长" | S2 |
| 3 | 315–539 (10.5–18.0s) | 中部图解：空气分子点阵 + 一束入射光，光线被折向多个方向 | tr_diagram: el_molecules；tr_annotation: el_note | el_molecules 沿 move 路径错峰出现；锚点"空气分子"（跨词锚点） | S3 |
| 4 | 540–719 (18.0–24.0s) | 公式条浮现：散射强度 ∝ 1/λ⁴；旁注"瑞利" | tr_diagram: el_formula；tr_annotation: el_note | el_formula scaleIn；highlight 锚点"四次方" | S4 |
| 5 | 720–929 (24.0–31.0s) | 两根散射强度柱：红柱矮、蓝柱高，柱顶标注比值 ≈6.1；T-11 逐柱生长 | tr_diagram: el_bar_red, el_bar_blue；tr_annotation: el_note | 柱高自底部 scaleIn，先后相差 15 帧；counter 数字滚动 0→6.1 | S5；关键数字音效 |
| 6 | 930–1094 (31.0–36.5s) | 左右对照：白天天空散射蓝光；右侧小框画傍晚斜射路径 | tr_annotation: el_note；tr_caption: el_caption | 注释条 move 入场；highlight"蓝光" | S6–S7 |
| 7 | 1095–1319 (36.5–44.0s) | 结论卡：三行收束句 + 底部四季光色小注 | tr_annotation: el_note；tr_caption: el_caption | el_note scaleIn；T-12 关键词"短波长""散射"逐词高亮 | S8–S9 |
| 8 | 1320–1349 (44.0–45.0s) | 画面定格结论卡；BGM 淡出 | 全部元素保持；el_caption 淡出 | 无新入场 | 片尾无口播 |

**版式**
- 网格：3 列 × 6 行竖屏网格；图解居中行（y 560–1180），注释层贴图解下沿，字幕层固定底部。
- 字号层级：主标题 64px/700；图解标题 44px/600；正文注释 32px/400；字幕 40px/500；公式 56px/600。行高 1.45；CJK 字距 +10；术语注释层与正文层上下分离，不重叠（T-01 复杂排版：术语注释层 + 正文层）。
- 对齐：图解元素居中；注释左对齐贴图解；字幕水平居中。
**色彩**
- 主色 `#0B1B3A`（深蓝天）；辅色 `#E8F1FB`（浅白）；强调 `#4D96FF`（蓝光）、`#FF7A59`（红光）。
- 对比度：正文 `#E8F1FB` 对 `#0B1B3A`，WCAG 对比度 ≈13.5:1 `[待验证]`（用 Chrome DevTools Lighthouse contrast 面板复算；阈值 ≥4.5:1）。
**字体**
- 族名：思源黑体 / Noto Sans CJK SC（正文与标题同族不同字重）；公式与数字用 Inter。
- 缺字风险：λ、⁴、∝ 需确认 CJK 字体或 Inter 覆盖；`[待验证]` 验证方法：`document.fonts.check('600 56px Inter', '∝ λ⁴')`，失败则回退 DejaVu Sans 并在注释层用中文"四次方"兜底。
**素材清单**

| id | 用途 | 规格 | 生成 / 来源 | 许可 |
|---|---|---|---|---|
| as_bg_gradient | 蓝天渐变背景 | 1080×1920 PNG，24bit | Player 内 shape 渐变合成，无外部图 | 自有 |
| as_diagram_molecules | 分子点阵图解 | 1080×640 SVG→PNG | IR shape 元素合成 | 自有 |
| as_bgm_calm | 背景氛围乐 | m4a，约 46s，BPM 90，可循环 | 授权曲库 | 曲库商用授权（assets 内登记） |

**音频策略**
- voice：provider `http`，音色 zh-CN 女声，rate 1.0，单声道；voice 时长覆盖最后一个 word 的 end（基线 `[代码] ir.go:263-270` 强制）。
- BGM：BPM 90，音量 0.18，目标响度 −16 LUFS；现实现 mux 阶段无 loudnorm、无 BGM loop、无 aresample（`[代码] encode.go:147-185`），循环与响度归一化属待扩展。
**字幕策略**
- 中文硬字幕（烧录）；行长 ≤16 rune、≤2 行、单 cue ≤6s（`[代码] subtitle.go:16-20`）；静音可读，关键术语在图解注释层重复一次。不做逐词卡拉OK高亮，仅句内关键词变色（T-12）。

#### 4.1.3 IR 规格（目标 schema）

```json
{
  "schemaVersion": 1,
  "meta": {"width": 1080, "height": 1920, "fps": 30, "durationSec": 45.0, "background": "#0B1B3A"},
  "voice": {"provider": "http", "voice": "zh-CN-female-01", "rate": 1.0, "audioKey": null},
  "script": "S1 你有没有想过，晴天的天空为什么是蓝色的？S2 太阳发出的白光，其实是红、橙、黄、绿、蓝、紫等不同波长的光混合在一起。S3 空气里的氮、氧分子尺寸远小于可见光波长，会把照到它们的光向各个方向散射。S4 英国科学家瑞利发现，散射强度和波长的四次方成反比，也就是波长越短，散射越强。S5 红光波长约六百三十纳米，蓝光约四百三十纳米；按四次方估算，蓝光被散射的强度大约是红光的六倍。S6 于是蓝光在大气层里被反复散射，铺满整个天空；而红光沿直线传播，更多留在太阳附近。S7 到了傍晚，阳光斜穿更长的大气路径，短波蓝光沿途被散射掉，剩下长波的红与橙，这就是晚霞偏红的原因。S8 所以你看到的蓝天，不是天空本身有蓝色颜料，而是短波长的光被空气分子散射进了你的眼睛。S9 一句话总结：散射强度随波长四次方衰减，短波蓝光占优，天空因此呈现蓝色。",
  "words": [
    {"id": "w01", "index": 0, "start": 0.0, "end": 0.42, "text": "晴天", "source": "aligner", "confidence": 0.97, "scriptStart": 8, "scriptEnd": 10}, {"id": "w02", "index": 1, "start": 0.42, "end": 0.86, "text": "天空", "source": "aligner", "confidence": 0.96, "scriptStart": 11, "scriptEnd": 13}, {"id": "w03", "index": 2, "start": 0.86, "end": 1.18, "text": "蓝色", "source": "aligner", "confidence": 0.98, "scriptStart": 17, "scriptEnd": 19}, {"id": "w04", "index": 3, "start": 4.8, "end": 5.2, "text": "白光", "source": "aligner", "confidence": 0.95, "scriptStart": 24, "scriptEnd": 26},
    {"id": "w05", "index": 4, "start": 5.2, "end": 5.55, "text": "不同", "source": "aligner", "confidence": 0.94, "scriptStart": 38, "scriptEnd": 40}, {"id": "w06", "index": 5, "start": 5.55, "end": 5.86, "text": "波长", "source": "aligner", "confidence": 0.97, "scriptStart": 40, "scriptEnd": 42}, {"id": "w07", "index": 6, "start": 10.8, "end": 11.1, "text": "空气", "source": "aligner", "confidence": 0.96, "scriptStart": 59, "scriptEnd": 61}, {"id": "w08", "index": 7, "start": 11.1, "end": 11.46, "text": "分子", "source": "aligner", "confidence": 0.95, "scriptStart": 61, "scriptEnd": 63},
    {"id": "w09", "index": 8, "start": 11.46, "end": 11.82, "text": "尺寸", "source": "aligner", "confidence": 0.93, "scriptStart": 63, "scriptEnd": 65}, {"id": "w10", "index": 9, "start": 11.82, "end": 12.2, "text": "波长", "source": "aligner", "confidence": 0.97, "scriptStart": 70, "scriptEnd": 72}, {"id": "w11", "index": 10, "start": 12.2, "end": 12.55, "text": "散射", "source": "aligner", "confidence": 0.96, "scriptStart": 76, "scriptEnd": 78}, {"id": "w12", "index": 11, "start": 18.3, "end": 18.66, "text": "瑞利", "source": "aligner", "confidence": 0.95, "scriptStart": 89, "scriptEnd": 91},
    {"id": "w13", "index": 12, "start": 18.66, "end": 19.1, "text": "散射", "source": "aligner", "confidence": 0.97, "scriptStart": 94, "scriptEnd": 96}, {"id": "w14", "index": 13, "start": 19.1, "end": 19.52, "text": "波长", "source": "aligner", "confidence": 0.96, "scriptStart": 99, "scriptEnd": 101}, {"id": "w15", "index": 14, "start": 19.52, "end": 19.9, "text": "四次方", "source": "aligner", "confidence": 0.94, "scriptStart": 102, "scriptEnd": 105}, {"id": "w16", "index": 15, "start": 24.3, "end": 24.7, "text": "红光", "source": "aligner", "confidence": 0.96, "scriptStart": 119, "scriptEnd": 121},
    {"id": "w17", "index": 16, "start": 24.7, "end": 25.1, "text": "波长", "source": "aligner", "confidence": 0.95, "scriptStart": 121, "scriptEnd": 123}, {"id": "w18", "index": 17, "start": 25.4, "end": 25.78, "text": "蓝光", "source": "aligner", "confidence": 0.97, "scriptStart": 127, "scriptEnd": 129}, {"id": "w19", "index": 18, "start": 36.8, "end": 37.24, "text": "蓝色", "source": "aligner", "confidence": 0.96, "scriptStart": 232, "scriptEnd": 234}, {"id": "w20", "index": 19, "start": 37.24, "end": 37.66, "text": "颜料", "source": "aligner", "confidence": 0.93, "scriptStart": 237, "scriptEnd": 239}
  ],
  "tracks": [
    {"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_diagram", "kind": "overlay", "z": 5}, {"id": "tr_annotation", "kind": "overlay", "z": 10}, {"id": "tr_caption", "kind": "subtitle", "z": 20}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.18, "assetKey": "video/vs-c03/as_bgm_calm.m4a"}
  ],
  "elements": [
    {"id": "el_bg", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 1349, "params": {"x": 0, "y": 0, "w": 1080, "h": 1920, "color": "#0B1B3A", "gradient": "vertical:#0B1B3A→#1F4E8C"}}, {"id": "el_title", "type": "text", "trackId": "tr_annotation", "startFrame": 0, "endFrame": 539, "params": {"text": "天空为什么是蓝色的？", "x": 540, "y": 240, "fontSize": 64, "weight": 700, "color": "#E8F1FB", "align": "center"}}, {"id": "el_sun", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 539, "params": {"x": 120, "y": 120, "w": 180, "h": 180, "shape": "circle", "color": "#FFE9A8"}}, {"id": "el_spectrum", "type": "shape", "trackId": "tr_diagram", "startFrame": 135, "endFrame": 539, "params": {"x": 140, "y": 620, "w": 800, "h": 120, "bands": ["#E53935", "#FB8C00", "#FDD835", "#43A047", "#1E88E5", "#5E35B1"]}}, {"id": "el_molecules", "type": "shape", "trackId": "tr_diagram", "startFrame": 315, "endFrame": 929, "params": {"x": 240, "y": 820, "w": 600, "h": 300, "shape": "dotGrid", "dots": 12, "color": "#E8F1FB"}},
    {"id": "el_formula", "type": "text", "trackId": "tr_diagram", "startFrame": 540, "endFrame": 929, "params": {"text": "散射强度 ∝ 1/λ⁴", "x": 540, "y": 700, "fontSize": 56, "weight": 600, "color": "#4D96FF", "align": "center"}}, {"id": "el_bar_red", "type": "shape", "trackId": "tr_diagram", "startFrame": 720, "endFrame": 1094, "params": {"x": 300, "y": 1080, "w": 180, "h": 60, "color": "#FF7A59", "label": "红光 1.0×"}}, {"id": "el_bar_blue", "type": "shape", "trackId": "tr_diagram", "startFrame": 735, "endFrame": 1094, "params": {"x": 600, "y": 1000, "w": 180, "h": 140, "color": "#4D96FF", "label": "蓝光 ≈6.1×"}}, {"id": "el_note", "type": "text", "trackId": "tr_annotation", "startFrame": 315, "endFrame": 1094, "params": {"text": "术语注释：瑞利散射 = 光被远小于波长的分子向四周折散", "x": 72, "y": 1260, "fontSize": 32, "weight": 400, "color": "#BFD6EE", "align": "left", "maxWidth": 936}}, {"id": "el_caption", "type": "text", "trackId": "tr_caption", "startFrame": 0, "endFrame": 1349, "params": {"text": "", "x": 540, "y": 1700, "fontSize": 40, "weight": 500, "color": "#FFFFFF", "align": "center", "maxLines": 2, "maxLineRunes": 16}}
  ],
  "animations": [
    {"id": "an_title_in", "targetElementId": "el_title", "type": "scaleIn", "startFrame": 0, "durationFrames": 24, "easing": "power2.out", "fromValue": 0.8, "toValue": 1.0, "params": {}}, {"id": "an_spectrum_in", "targetElementId": "el_spectrum", "type": "scaleIn", "startFrame": 135, "durationFrames": 30, "easing": "power2.out", "params": {"staggerFrames": 200}}, {"id": "an_molecules", "targetElementId": "el_molecules", "type": "move", "startFrame": 315, "durationFrames": 45, "easing": "power1.out", "from": {"x": 240, "y": 880}, "to": {"x": 240, "y": 820}, "params": {}}, {"id": "an_formula_in", "targetElementId": "el_formula", "type": "scaleIn", "startFrame": 540, "durationFrames": 24, "easing": "power3.out", "params": {}}, {"id": "an_bar_red_grow", "targetElementId": "el_bar_red", "type": "scaleIn", "startFrame": 720, "durationFrames": 30, "easing": "power2.out", "params": {"axis": "vertical"}},
    {"id": "an_bar_blue_grow", "targetElementId": "el_bar_blue", "type": "scaleIn", "startFrame": 735, "durationFrames": 30, "easing": "power2.out", "params": {"axis": "vertical"}}, {"id": "an_note_in", "targetElementId": "el_note", "type": "move", "startFrame": 315, "durationFrames": 20, "easing": "power1.out", "from": {"x": 72, "y": 1290}, "to": {"x": 72, "y": 1260}, "params": {}}
  ],
  "effects": [
    {"id": "ef_hl_blue", "type": "highlight", "targetElementId": "el_caption", "anchor": {"wordId": "w03", "lastText": "蓝色", "lastIndex": 2, "occurrence": 0, "resolvedFrom": "exact", "status": "resolved"}, "params": {"color": "#4D96FF"}}, {"id": "ef_hl_cross", "type": "highlight", "targetElementId": "el_note", "anchor": {"wordId": "w07", "lastText": "分子", "lastIndex": 6, "occurrence": 0, "resolvedFrom": "crossWord", "status": "resolved"}, "params": {"color": "#FFD54A"}}, {"id": "ef_pulse_dot", "type": "pulse", "targetElementId": "el_molecules", "anchor": {"wordId": "w11", "lastText": "散射", "lastIndex": 10, "resolvedFrom": "exact", "status": "resolved"}, "params": {"scale": 1.12}}
  ],
  "assets": [
    {"key": "video/vs-c03/as_bgm_calm.m4a", "kind": "audio", "bytes": 2104000, "license": "曲库商用授权"}
  ],
  "render": {"width": 1080, "height": 1920, "fps": 30, "crf": 18, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "burn", "fontSizePx": 40, "maxLineRunes": 16}, "thumbnail": {"atSec": 25.0}}
}
```

#### 4.1.4 现状降级映射


| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-02 多图层（背景 / 图解 / 注释 / 字幕四层） | `tracks[].z`、`elements[].trackId` | 现 IR 无 trackId，元素统一 append 到 `#canvas`；层级仅靠 element 在数组中的顺序与 `el.z` 字段保留 `[代码] timeline-builder.js:143-180` | ⚠️ | 四层语义可由 DOM 顺序近似，但无法在重排轨道时按 track 整体调度；注释层与图解层在极端重叠时可能压错 |
| T-01 术语注释层 + 正文层排版 | `params.maxWidth`、`maxLines`、字距 / 行高字段 | 现 Element 仅 `fontSize/x/y/w/h/z/color`，无 maxWidth / 字距 / 行高 `[代码] ir.go:118-134`；折行由 CSS 容器承担 | ⚠️ | 长注释可能超出 936px 安全宽，需在元素 `w/h` 内手工断行；CJK 无空格时现字幕断行按 rune 中点硬切，可能切在词中间 `[代码] subtitle.go:66-96` |
| T-12 关键词逐词高亮 | `effects[].targetElementId` 指向具体词文本 | 现 `highlight` 作用于 `#canvas` 整层，不是某个元素 `[代码] timeline-builder.js:190`；词级高亮需额外实现词文本层 | ⛔ | 目标：仅关键词变色；现状：整屏底色闪现一次。字段提案：effect 增 `targetWordIds: string[]`，Player 把词渲染为独立 span 再上色 |
| T-11 图表生长（逐柱） | animation `axis:vertical` + stagger | 现动画类型仅 `move|scaleIn|rotate` `[代码] ir.go:100-116`；scaleIn 近似纵向生长，无独立 axis 字段 | ⚠️ | 柱体从中心等比放大而非从底部向上生长；柱顶标签与柱体缩放不同步 |
| 元素可见区间 | `elements[].startFrame/endFrame` | 现元素整片存在，入场只能靠动画 from 值；无 opacity 动画类型 `[代码] timeline-builder.js:143-180` | ⚠️ | 镜 1 的太阳若需在镜 2 消失，现实现只能 move 出屏或 scaleIn 到 0.01，不能真正卸载 |
| 词锚点稳定身份 | `words[].id`、effect `anchor.wordId` | 现 Word 无 wordId，锚点按 text+occurrence 解析 `[代码] ir.go:74`；重复词"蓝色"靠 occurrence 区分 | ⚠️ | 改稿后词序变化可能把效果挂到错误 occurrence；nearest 解析会静默移到最近词 `[代码] ir.go:500-575` |
| 数字滚动 0→6.1 | `counter{from,to,suffix}` 指向 el_bar_blue 标签 | 现 counter 自建 `<div id="counter-<fxId>">`，无 x/y/w/h，固定左上原点 `[代码] timeline-builder.js:232-241` | ⛔ | 目标：比值出现在蓝柱柱顶；现状：数字出现在画布左上角，无法定位到标签旁 |
| BGM 循环与响度归一 | `render.audio.loudness`、track `loop` | 现 mux 用 `amix` + 固定 `volume=`，无 loudnorm / apad / aresample / BGM loop `[代码] encode.go:147-185` | ⚠️ | 46s BGM 在 45s 短片内不需循环；响度目标无法在导出阶段保证，需前置音频母带 |
| 扩展草案键（params 内）：axis、bands、dots、gradient、maxWidth、shape（circle、dotGrid）、staggerFrames | 目标 schema 未定义 | 现 builder 不消费该键，无现实现替代 | ⛔ 依赖 §5.16 提案 | 现渲染会忽略这些键，画面不出现对应效果 |
| 动画参数层级 | 目标 schema 将 from/to、easing 置于 params | 现 `ElementAnimation` 读顶层 from/to、fromValue/toValue、easing；案例 IR 已按顶层书写 | ✅ 以顶层为准 | params 内仅保留扩展键（axis、staggerFrames、reveal、path 等），不承载运动参数 |
#### 4.1.5 预期帧表

| 帧号 | 时刻 | 期望画面状态 | 断言类型 |
|---|---|---|---|
| 0 | 0.00s | 深蓝天渐变铺满；标题"天空为什么是蓝色的？"位于 y≈240，居中 | 视觉 + DOM |
| 24 | 0.80s | 标题 scaleIn 结束，前景文字 bbox 宽度 ≥520px | 视觉 |
| 150 | 5.00s | 光谱六条色带至少 5 条可见，横向排列在 y 620 带 | 视觉 |
| 315 | 10.50s | 分子点阵 12 个点在 x 240–840、y 820–1120 区间内；注释层贴 y≈1260 | 视觉 + DOM |
| 540 | 18.00s | 公式条"散射强度 ∝ 1/λ⁴"可见；注释层与图解层不重叠（垂直区间不交叠） | 视觉 |
| 750 | 25.00s | 红柱高度 ≈60px、蓝柱 ≈140px；蓝柱柱顶标签"≈6.1×"可见；封面帧候选 | 视觉 + T-15 |
| 930 | 31.00s | 白天 / 傍晚两对照框并置；el_note 文本包含"瑞利散射" | DOM |
| 1100 | 36.67s | 结论卡三行收束句可见；底部字幕区无文字与图解重叠 | 视觉 |
| 1349 | 44.97s | 全部元素保持；字幕 cue 已在最后一个 word end 之前结束 | MP4 + IR |

#### 4.1.6 断言
**关键视觉断言（可量化）**
- A-C03-01：帧 750，蓝柱区域 `x 600–780, y 1000–1140`，蓝色通道均值 R≤90、G 120–180、B≥190；红柱区域 `x 300–480, y 1080–1140`，R≥200。阈值容差 ±15/±20/±20。
- A-C03-02：帧 315–1094 区间，注释层 bbox 上沿 ≥1240px，图解层 bbox 下沿 ≤1200px，垂直间距 ≥40px（防 T-02 两层压叠）。
- A-C03-03：字幕层位于 `y 1700–1800`，前景文字像素占字幕框面积 15%–70%；低于 15% 视为字幕未渲染，高于 70% 视为溢出。
- A-C03-04：帧 0 背景渐变在 `y 100` 与 `y 1800` 两处采样亮度差 ≥25（避免被压成纯色）。
**自动化断言（分层）**
- IR 层：`words` 20 条、index 等于数组下标、start/end 单调不重叠；`elements=10`、`animations=7`、`effects=3`；script ≤5000 字符；所有 src/key 以 `video/` 前缀、无 `://` 或 `data:`（`[代码] ir.go:152-159`、`:355-365`）。
- DOM 层：#canvas 子节点数 ≥ elements 数；title 文本 TextMetrics 宽度 ≤1080−144=936px；公式字符 ∝、λ、⁴ 实际字体已加载（`document.fonts.check`）。
- 帧层：L1 golden 帧 24 / 150 / 750 / 1100 与基线图 SSIM ≥0.95；帧间差在入场 24 帧内 >0.1，静止段相邻帧差 ≤0.02。
- MP4 层：时长 45.0s ±0.1s；分辨率 1080×1920；30fps；音频流存在且时长覆盖视频；首帧缩略图可由 `ExtractThumbnail` 产出单帧 JPEG（`[代码] encode.go:240`）。
**人工验收点**
1. 静音播放全片，仅看图解能否复述"短波更容易被散射"这一结论。
2. 镜 5 两根柱的高度比目测 ≈6:1，标签数字与柱高一致。
3. 术语注释与正文无重叠、无行首标点卡在注释行第一字。
4. 科学表述无超出来源的断言（不出现"紫色最容易散射所以天空应是紫色"这类未解释内容）。
**失败注入**
- F-C03-01：注入不可解析锚点（effect 锚定词"极光"，script 中不存在）。期望：现实现 `reason=missing` 的 effect 直接 skip + console.warn，不阻断渲染（`[代码] timeline-builder.js:191-194`）；目标 schema 应返回 `E_VIDEO_ANCHOR_NOT_FOUND`（架构 §10.5）。
- F-C03-02：注入未知 animation 类型 `particleBurst`。期望：读时宽容 skip + warn；不产生未定义节点（`[代码] timeline-builder.js:183-185`）。
- F-C03-03：注入坏图 asset（decode 失败）。期望：`img.decode().catch()` 吞错不阻断 ready（`[代码] timeline-builder.js:158-160`）；帧层对应区域为背景色，人工验收记为素材缺失而非渲染崩溃。
- F-C03-04：把 `meta.durationSec` 改为 8.04。期望：目标 schema 帧数 ceil=242；现实现 round=241，落帧差 1；断言帧表在 241/242 边界显式标注口径差异。

#### 4.1.7 当前可实现性小结
**结论**：构图、图解层与注释层分离、逐柱生长近似可在现 IR + Player 上跑通；**词级高亮与可定位数字滚动是阻塞项**（依赖 effect 目标化扩展与 counter 布局字段）。阻塞项对应 §1 能力矩阵：effect target 行、counter 布局行、元素时间区间行。
---

### 4.2 VS-C04「数据可视化口播」：中国经济三年切面（2022–2024）

#### 4.2.1 案例头

| 字段 | 内容 |
|---|---|
| 案例 ID | VS-C04 |
| 名称 | 经济总量、增速与服务业占比（柱状 + 折线 + 占比环） |
| 内容类型 | 数据可视化口播 / 行业数据解读 |
| 目标受众 | 财经内容读者、职场人群；横屏观看，配合口播理解三组指标关系 |
| 发布渠道 | 横屏视频号 / B 站 / 官网内嵌；1920×1080，底部留字幕安全区 |
| 画幅 / 分辨率 | 1920×1080（16:9 横屏） |
| fps | 30 |
| 时长 | 60.0s（目标帧数 ceil(60×30)=1800；现实现 round=1800） |
| 语言 | 普通话（中文配音 + 中文硬字幕） |
| 优先级 | P0 |
| 依赖案例 | VS-C03（图层与图表生长基础） |

#### 4.2.2 创作规格
**一句话主张**：用三组官方统计图表，把"总量台阶、增速水平、服务业结构"讲成一条可核对的因果链。
**数据来源、口径与时间范围（写入口播片尾说明卡）**

| 指标 | 2022 | 2023 | 2024 | 口径 | 来源 |
|---|---|---|---|---|---|
| GDP 总量（现价，亿元） | 1,210,207 | 1,260,582 | 1,349,084 | 现价核算；各年初步核算公报数 | 国家统计局 2022 公报 https://www.gov.cn/xinwen/2023-02/28/content_5743623.htm ；2023 公报 https://www.stats.gov.cn/xxgk/sjfb/tjgb2020/202402/t20240229_1947923.html ；2024 公报 https://www.stats.gov.cn/sj/zxfb/202502/t20250228_1958817.html |
| GDP 增速（不变价，%） | 3.0 | 5.2 | 5.0 | 按不变价格计算，剔除价格变动 | 同上各年公报 |
| 第三产业增加值占 GDP 比重（2024，%） | — | — | 56.7 | 三次产业增加值占当年 GDP 比重；2024 一产 6.8%、二产 36.5% | 2024 公报（同上链接） |

`[外部]` 上述数值均摘自公报原文；2023 及以后总量经第五次全国经济普查结果同步修订，本片不与修订前口径混用。`[待验证]` 复核方法：下载公报 PDF，检索"国内生产总值"与"第三产业增加值比重"两数与本表逐字比对。
**完整逐句脚本（S1..S9，可直接配音）**
- S1 这组数据讲中国经济的三个切面：经济总量、实际增速，以及服务业占比。
- S2 先看总量。二零二二年国内生产总值十二万一千零二十亿元，二零二三年十二万六千零五十八亿元，二零二四年十三万四千九百零八亿元。
- S3 总量按现价计算，单位亿元，来自国家统计局各年国民经济和社会发展统计公报。
- S4 再看实际增速。二零二二年增长百分之三点零，二零二三年百分之五点二，二零二四年百分之五点零。
- S5 增速按不变价格计算，剔除价格变动，反映的是实际产出变化。
- S6 第三组图是二零二四年产业结构：第三产业增加值占国内生产总值百分之五十六点七。
- S7 同年第一产业占百分之六点八，第二产业占百分之三十六点五，三者相加为百分之百。
- S8 三组图合在一起看：总量台阶抬升，增速保持在百分之五上下，服务业贡献超过一半。
- S9 数据口径、发布时间与原始公报链接，列在片尾说明卡。
**分镜表**（30fps；横屏 1920×1080）

| 镜号 | 帧范围 | 画面 | 图层 / 元素 | 动效与锚点词 | 字幕 / 音频 |
|---|---|---|---|---|---|
| 1 | 0–179 (0.0–6.0s) | 标题卡：三组指标名称 + 年份范围 2022–2024；背景浅灰 | tr_main: el_bg, el_title；tr_caption: el_caption | el_title scaleIn 0–24 帧；锚点"总量" | S1；BGM 淡入 |
| 2 | 180–539 (6.0–18.0s) | 左侧柱状图：三根柱（2022/2023/2024）自底部逐柱生长；柱顶标签为现价亿元 | tr_chart: el_bar22, el_bar23, el_bar24（横轴刻度为静态文本） | T-11 逐柱生长，柱间间隔 12 帧；counter 滚动柱顶金额；T-06 镜头沿柱状图区从左向右平移 | S2–S3；数字音效随柱出现 |
| 3 | 540–899 (18.0–30.0s) | 右上折线图：三个增速点 3.0 / 5.2 / 5.0，点间连线逐段生长；纵轴 0–6% | tr_chart: el_line（三点 + 连线；纵轴刻度为静态文本） | T-11 逐点 + 逐段生长；T-06 镜头在折线图区向上推进一档；counter 滚动百分比 | S4–S5 |
| 4 | 900–1259 (30.0–42.0s) | 右侧占比环：三产 56.7% 扇区生长，其余 43.3% 为灰色；环心标注"56.7%" | tr_chart: el_ring, el_ring_num；tr_note: el_note | 环扇区 scaleIn 自中心；highlight"百分之五十六点七"；counter 滚动环心数字 | S6–S7 |
| 5 | 1260–1619 (42.0–54.0s) | 三图同屏缩略并置；底部一行结论句；镜头平移回全图概览 | tr_chart 全部；tr_note: el_note | 三图同时 move 缩到 60% 宽；T-09 结论词错峰入场 | S8 |
| 6 | 1620–1799 (54.0–60.0s) | 片尾说明卡：口径行、来源链接行（URL 见 §4.2.2 来源表）、发布年份；无图表 | tr_note: el_note | el_note scaleIn；字幕列出公报名称 | S9；BGM 淡出 |

**版式**
- 网格：16:9 横向三栏（柱图栏 x 80–760；折线栏 x 800–1240；环图栏 x 1280–1840）；字幕条 y 950–1010。
- 字号层级：标题 56px/700；轴标签 28px/400；柱顶 / 环心数字 44px/600；注释 26px/400；字幕 36px/500。行高 1.4；数字用 Inter，中文用思源黑体。
- 对齐：图表元素按网格基线对齐；数值标签右对齐贴柱顶。
**色彩**
- 主色 `#1F3A5F`（深蓝）；辅色 `#F2F5F9`（浅灰底）；强调 `#2E86DE`（柱 / 线主色）、`#F5A623`（环图扇区）；中性灰 `#C9D2DC`（对照部分）。
- 对比度：正文 `#1F3A5F` 对 `#F2F5F9` ≈11:1 `[待验证]`，阈值 ≥4.5:1。
**字体**：思源黑体 / Noto Sans CJK SC；数字 Inter。缺字风险：百分号与小数点无缺字风险；`[待验证]` 同上用 `document.fonts.check` 复核。
**素材清单**

| id | 用途 | 规格 | 生成 / 来源 | 许可 |
|---|---|---|---|---|
| as_chart_bg | 浅灰网格背景 | 1920×1080 PNG | IR shape 合成 | 自有 |
| as_bgm_corporate | 背景节奏乐 | m4a，约 61s，BPM 100 | 授权曲库 | 曲库商用授权 |

**音频策略**：voice zh-CN 男声 rate 1.0；BPM 100，BGM 音量 0.16，目标 −16 LUFS；现实现无 loudnorm / loop（同 §4.1.2）。口播与图表生长节拍对齐：每根柱 / 每个点的入场帧锚定对应年份词。
**字幕策略**：中文硬字幕；行长 ≤16 rune、≤2 行、≤6s；数字在字幕中用中文读法（与配音一致），图表上用阿拉伯数字。不做双语。
**封面帧策略（T-15）**：候选帧 540（折线图首点刚出现，三栏结构已可辨认）与 900（环图扇区 + 56.7% 数字最具信息密度）；选 900，理由：单一占比环在缩略图中识别度高于柱 + 线组合，且环心数字构成视觉焦点。

#### 4.2.3 IR 规格（目标 schema）

> **⚠️ [修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 M-C04-07 / example/internal/video/testdata/spec-audit-report.json M-C04-07）此 JSON 块为目标 schema 示意，不能直接提交现实现**：现实现动画必须内嵌在 `elements[].animations`（ir.go:129；timeline-builder.js:162 只遍历 `el.animations`），下列顶层 `animations[]` 数组会被 projector 整个丢弃（静默无效）；同时现 IR 无 `targetElementId`（动画随元素自带、effect 无目标概念），照抄时须删除各处 `targetElementId` 键。可运行的降级转换版本见 `example/internal/video/testdata/ir/c04.degraded.json`（过 `videoapp.Validate`，DurationFrames=1800），转换规则全录于 spec-audit-report.json X-3。下块原文保留，不改写历史。
```json
{
  "schemaVersion": 1,
  "meta": {"width": 1920, "height": 1080, "fps": 30, "durationSec": 60.0, "background": "#F2F5F9"},
  "voice": {"provider": "http", "voice": "zh-CN-male-01", "rate": 1.0, "audioKey": null},
  "script": "S1 这组数据讲中国经济的三个切面：经济总量、实际增速，以及服务业占比。S2 先看总量。二零二二年国内生产总值十二万一千零二十亿元，二零二三年十二万六千零五十八亿元，二零二四年十三万四千九百零八亿元。S3 总量按现价计算，单位亿元，来自国家统计局各年国民经济和社会发展统计公报。S4 再看实际增速。二零二二年增长百分之三点零，二零二三年百分之五点二，二零二四年百分之五点零。S5 增速按不变价格计算，剔除价格变动，反映的是实际产出变化。S6 第三组图是二零二四年产业结构：第三产业增加值占国内生产总值百分之五十六点七。S7 同年第一产业占百分之六点八，第二产业占百分之三十六点五，三者相加为百分之百。S8 三组图合在一起看：总量台阶抬升，增速保持在百分之五上下，服务业贡献超过一半。S9 数据口径、发布时间与原始公报链接，列在片尾说明卡。",
  "words": [
    {"id": "w01", "index": 0, "start": 0.0, "end": 0.6, "text": "数据", "source": "aligner", "confidence": 0.97, "scriptStart": 2, "scriptEnd": 4}, {"id": "w02", "index": 1, "start": 0.6, "end": 0.95, "text": "总量", "source": "aligner", "confidence": 0.96, "scriptStart": 12, "scriptEnd": 14}, {"id": "w03", "index": 2, "start": 0.95, "end": 1.35, "text": "增速", "source": "aligner", "confidence": 0.96, "scriptStart": 15, "scriptEnd": 17}, {"id": "w04", "index": 3, "start": 1.35, "end": 1.75, "text": "占比", "source": "aligner", "confidence": 0.95, "scriptStart": 21, "scriptEnd": 23},
    {"id": "w05", "index": 4, "start": 6.2, "end": 6.6, "text": "总量", "source": "aligner", "confidence": 0.97, "scriptStart": 27, "scriptEnd": 29}, {"id": "w06", "index": 5, "start": 6.6, "end": 7.05, "text": "二零二二", "source": "aligner", "confidence": 0.94, "scriptStart": 31, "scriptEnd": 36}, {"id": "w07", "index": 6, "start": 7.05, "end": 7.6, "text": "生产", "source": "aligner", "confidence": 0.95, "scriptStart": 39, "scriptEnd": 41}, {"id": "w08", "index": 7, "start": 8.7, "end": 9.1, "text": "二零二三", "source": "aligner", "confidence": 0.95, "scriptStart": 49, "scriptEnd": 54},
    {"id": "w09", "index": 8, "start": 10.1, "end": 10.5, "text": "二零二四", "source": "aligner", "confidence": 0.96, "scriptStart": 62, "scriptEnd": 67}, {"id": "w10", "index": 9, "start": 12.3, "end": 12.65, "text": "现价", "source": "aligner", "confidence": 0.95, "scriptStart": 78, "scriptEnd": 80}, {"id": "w11", "index": 10, "start": 18.3, "end": 18.7, "text": "增速", "source": "aligner", "confidence": 0.97, "scriptStart": 103, "scriptEnd": 105}, {"id": "w12", "index": 11, "start": 18.7, "end": 19.15, "text": "二零二二", "source": "aligner", "confidence": 0.94, "scriptStart": 107, "scriptEnd": 112},
    {"id": "w13", "index": 12, "start": 19.65, "end": 20.1, "text": "二零二三", "source": "aligner", "confidence": 0.95, "scriptStart": 116, "scriptEnd": 121}, {"id": "w14", "index": 13, "start": 20.6, "end": 21.0, "text": "二零二四", "source": "aligner", "confidence": 0.96, "scriptStart": 125, "scriptEnd": 130}, {"id": "w15", "index": 14, "start": 24.3, "end": 24.75, "text": "不变价", "source": "aligner", "confidence": 0.93, "scriptStart": 141, "scriptEnd": 144}, {"id": "w16", "index": 15, "start": 30.3, "end": 30.75, "text": "产业", "source": "aligner", "confidence": 0.96, "scriptStart": 168, "scriptEnd": 170},
    {"id": "w17", "index": 16, "start": 30.75, "end": 31.3, "text": "第三产业", "source": "aligner", "confidence": 0.95, "scriptStart": 173, "scriptEnd": 177}, {"id": "w18", "index": 17, "start": 31.9, "end": 32.4, "text": "五十六点七", "source": "aligner", "confidence": 0.92, "scriptStart": 188, "scriptEnd": 193}, {"id": "w19", "index": 18, "start": 42.3, "end": 42.8, "text": "总量", "source": "aligner", "confidence": 0.96, "scriptStart": 224, "scriptEnd": 226}, {"id": "w20", "index": 19, "start": 43.3, "end": 43.75, "text": "服务业", "source": "aligner", "confidence": 0.95, "scriptStart": 235, "scriptEnd": 238}
  ],
  "tracks": [
    {"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_chart", "kind": "overlay", "z": 5}, {"id": "tr_note", "kind": "overlay", "z": 10}, {"id": "tr_caption", "kind": "subtitle", "z": 20}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.16, "assetKey": "video/vs-c04/as_bgm_corporate.m4a"}
  ],
  "elements": [
    {"id": "el_bg", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 1799, "params": {"x": 0, "y": 0, "w": 1920, "h": 1080, "color": "#F2F5F9"}}, {"id": "el_title", "type": "text", "trackId": "tr_main", "startFrame": 0, "endFrame": 179, "params": {"text": "经济总量 · 增速 · 服务业占比", "x": 960, "y": 180, "fontSize": 56, "weight": 700, "color": "#1F3A5F", "align": "center"}}, {"id": "el_bar22", "type": "shape", "trackId": "tr_chart", "startFrame": 180, "endFrame": 1259, "params": {"x": 180, "y": 620, "w": 120, "h": 180, "color": "#2E86DE", "label": "1,210,207 亿元"}}, {"id": "el_bar23", "type": "shape", "trackId": "tr_chart", "startFrame": 192, "endFrame": 1259, "params": {"x": 360, "y": 560, "w": 120, "h": 240, "color": "#2E86DE", "label": "1,260,582 亿元"}}, {"id": "el_bar24", "type": "shape", "trackId": "tr_chart", "startFrame": 204, "endFrame": 1259, "params": {"x": 540, "y": 470, "w": 120, "h": 330, "color": "#2E86DE", "label": "1,349,084 亿元"}},
    {"id": "el_line", "type": "shape", "trackId": "tr_chart", "startFrame": 540, "endFrame": 1259, "params": {"x": 800, "y": 360, "w": 440, "h": 300, "shape": "lineChart", "points": [[0, 250], [1, 90], [2, 100]], "labels": ["3.0%", "5.2%", "5.0%"]}}, {"id": "el_ring", "type": "shape", "trackId": "tr_chart", "startFrame": 900, "endFrame": 1259, "params": {"x": 1380, "y": 380, "w": 280, "h": 280, "shape": "donut", "segments": [{"pct": 56.7, "color": "#F5A623"}, {"pct": 43.3, "color": "#C9D2DC"}]}}, {"id": "el_ring_num", "type": "text", "trackId": "tr_chart", "startFrame": 900, "endFrame": 1259, "params": {"text": "56.7%", "x": 1520, "y": 500, "fontSize": 44, "weight": 600, "color": "#1F3A5F", "align": "center"}}, {"id": "el_note", "type": "text", "trackId": "tr_note", "startFrame": 540, "endFrame": 1619, "params": {"text": "口径：总量现价 / 增速不变价；来源：国家统计局各年统计公报", "x": 80, "y": 830, "fontSize": 26, "weight": 400, "color": "#5B6B7F", "align": "left"}}, {"id": "el_caption", "type": "text", "trackId": "tr_caption", "startFrame": 0, "endFrame": 1799, "params": {"text": "", "x": 960, "y": 980, "fontSize": 36, "weight": 500, "color": "#1F3A5F", "align": "center", "maxLines": 2, "maxLineRunes": 16}}
  ],
  "animations": [
    {"id": "an_title_in", "targetElementId": "el_title", "type": "scaleIn", "startFrame": 0, "durationFrames": 24, "easing": "power2.out", "params": {}}, {"id": "an_bar22_grow", "targetElementId": "el_bar22", "type": "scaleIn", "startFrame": 180, "durationFrames": 24, "easing": "power2.out", "params": {"axis": "vertical"}}, {"id": "an_bar23_grow", "targetElementId": "el_bar23", "type": "scaleIn", "startFrame": 192, "durationFrames": 24, "easing": "power2.out", "params": {"axis": "vertical"}}, {"id": "an_bar24_grow", "targetElementId": "el_bar24", "type": "scaleIn", "startFrame": 204, "durationFrames": 24, "easing": "power2.out", "params": {"axis": "vertical"}}, {"id": "an_line_draw", "targetElementId": "el_line", "type": "move", "startFrame": 540, "durationFrames": 60, "easing": "power1.out", "params": {"reveal": "leftToRight"}},
    {"id": "an_ring_in", "targetElementId": "el_ring", "type": "scaleIn", "startFrame": 900, "durationFrames": 30, "easing": "power3.out", "params": {}}, {"id": "an_camera_pan", "targetElementId": "el_bg", "type": "move", "startFrame": 180, "durationFrames": 360, "easing": "linear", "from": {"x": 0, "y": 0}, "to": {"x": -60, "y": 0}, "params": {}}
  ],
  "effects": [
    {"id": "ef_bar24_cnt", "type": "counter", "targetElementId": "el_bar24", "anchor": {"wordId": "w09", "lastText": "二零二四", "lastIndex": 8, "resolvedFrom": "exact", "status": "resolved"}, "params": {"from": 0, "to": 1349084, "suffix": " 亿元"}}, {"id": "ef_ring_cnt", "type": "counter", "targetElementId": "el_ring_num", "anchor": {"wordId": "w18", "lastText": "五十六点七", "lastIndex": 17, "resolvedFrom": "exact", "status": "resolved"}, "params": {"from": 0, "to": 56.7, "suffix": "%"}}, {"id": "ef_hl_growth", "type": "highlight", "targetElementId": "el_caption", "anchor": {"wordId": "w16", "lastText": "产业", "lastIndex": 15, "occurrence": 0, "resolvedFrom": "crossWord", "status": "resolved"}, "params": {"color": "#F5A623"}}
  ],
  "assets": [
    {"key": "video/vs-c04/as_bgm_corporate.m4a", "kind": "audio", "bytes": 2860000, "license": "曲库商用授权"}
  ],
  "render": {"width": 1920, "height": 1080, "fps": 30, "crf": 19, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "burn", "fontSizePx": 36, "maxLineRunes": 16}, "thumbnail": {"atSec": 30.0}}
}
```

#### 4.2.4 现状降级映射


| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-11 图表生长（逐柱 / 逐点 / 逐段） | animation `axis:vertical`、lineChart `reveal` | 现仅 `move|scaleIn|rotate`；柱用 scaleIn 近似，折线无"逐段描线"类型，只能整线淡入 | ⚠️ | 折线不能像描线一样逐段生长；三个点与连线的出现顺序不可控 |
| T-10 数字滚动（柱顶金额、环心百分比） | `counter{from,to,suffix}` + targetElementId | counter 自建 div、无定位字段，固定左上原点 `[代码] timeline-builder.js:232-241` | ⛔ | 目标：数字贴柱顶 / 环心；现状：滚动数字全部堆在画布左上角，图表标签需另用静态 text 元素兜底 |
| T-06 镜头平移（图表区内推进） | animation `chartGroup` move，整组位移 | 现元素独立 append，无 group 容器；只能对各图表元素分别写相同 move 轨迹 | ⚠️ | 多元素平移轨迹必须逐条复制参数；不同步时出现层间滑移；无独立"镜头"对象 |
| 图表数据与渲染绑定 | `elements[].params` 内数据点 | 现 Element 类型仅 image/text/shape，无 chart 类型；数据点需在合成期算好柱高 / 扇区角度，IR 只放结果 shape | ⚠️ | 改数据要重算几何；IR 内不保留"源数据 → 图形"的映射，审计时不能从图反推口径 |
| 元素时间区间 | `startFrame/endFrame` | 整片存在；镜 6 片尾说明卡与前面图表需靠入场动画分区，不能卸载旧图 | ⚠️ | 三图在片尾卡仍残留在 DOM，只是被新卡覆盖；叠层顺序错误时会透出旧柱边 |
| 口播—图表节拍锚定 | effect/animation `anchor.wordId` | 现锚点按 text 解析；重复词"总量"出现三次（w02/w05/w19），靠 occurrence 区分 | ⚠️ | 改稿重排词序可能挂错 occurrence；nearest 会静默落到相邻词 `[代码] ir.go:500-575` |
| 多 track 调度 | `tracks[]` z 层级 | 现无 trackId；图表 / 注释 / 字幕靠 DOM 顺序 | ⚠️ | 与 §4.1.4 同：轨道级重排不支持；z 值仅作字段保留 |
| 扩展草案键（params 内）：axis、labels、pct、points、reveal、segments、shape（donut、lineChart） | 目标 schema 未定义 | 现 builder 不消费该键，无现实现替代 | ⛔ 依赖 §5.16 提案 | 现渲染会忽略这些键，画面不出现对应效果 |
| 动画参数层级 | 目标 schema 将 from/to、easing 置于 params | 现 `ElementAnimation` 读顶层 from/to、fromValue/toValue、easing；案例 IR 已按顶层书写 | ✅ 以顶层为准 | params 内仅保留扩展键（axis、staggerFrames、reveal、path 等），不承载运动参数 |

> **[修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 M-C04-04 / example/internal/video/testdata/spec-audit-report.json M-C04-04）上表行"T-15 封面帧选择"已从表中移出（其 ✅ 判定过时；为保表格完整不再以表行形式保留，原文划线存证如下）**：
>
> ~~| T-15 封面帧选择 | `render.thumbnail.atSec` | 现 `ExtractThumbnail` 取单帧 JPEG，参数来自 render recipe `[代码] encode.go:240` | ✅ | 封面帧选取可落地；"候选帧对比"需渲染两帧人工比选，现流水线未提供候选集接口 |~~
>
> 按 §8.2 两列口径重判：
>
> | 口径 | 判定 | 依据 |
> |---|---|---|
> | 结构可表达性（包内 `ExtractThumbnail` 函数） | ✅ | `platform/capx/encode.go:245-263`：函数在位，可出单帧 JPEG——但 `-ss 00:00:01` 写死，`atSec` 没有任何通路（并非"参数来自 render recipe"） |
> | 视觉达标性（端到端管线） | ⛔ | `example/internal/video/render/render_pipeline.go:268-273`：`firstThumb` 是返回 `nil, nil` 的 stub，缩略图当前完全不产出（非致命） |
>
> 对本案断言的后果：§4.2.6 MP4 层"缩略图 atSec=30.0 可解码"在现实现下必然失败，须排除；帧 900 封面候选需 L1 用帧渲染器单独截取；"候选帧对比"无管线接口。

#### 4.2.5 预期帧表

> **[口径 round2]（依据 §7.0 时钟基准裁定 + delivery-audit-video-studio-round2 §2 + l1-c04-report.json）本表按词锚重算**：现实现动画锚定 `words[].start`（降级 IR `testdata/ir/c04.degraded.json`），帧号 = `ceil(词.start × 30)`；原表按目标 schema `startFrame` 编排，两套时钟并存导致锚点差 9 帧上下（镜界恰与词锚对齐的行）到 111 帧（三柱行），C06 侧另有 105 帧案例（见 §4.4.5）。下表第 4 列给出推导值，第 5 列列差异；差异 >±30 帧的行加 ⚠️（M2 重新验收重点）。第 2 批实测锚点见 §7.0 校准锚点 1。

| 帧号（原表） | 词锚推导 `[口径 round2]` | 时刻 | 期望画面状态 | 断言类型 |
|---|---|---|---|---|
| 0 | **0**（推导=0） | 0.00s | 标题卡可见，三指标名称一行；背景浅灰 | 视觉 + DOM |
| 180 | **198**（柱生长锚；180→198，+18） | 6.60s | 柱状图区激活；2022 柱开始生长。an_bar22_grow 锚"二零二二"第 1 次@6.6s：6.6×30=198→**198**（l1 探针首可见采样 F200，含阈值步长 ±2）；an_camera_pan_bar22 锚"总量"第 2 次@6.2s→186。原表 180 为镜号边界；round2 的 frames.json 曾按"总量@6.2s→186"标注柱生长锚，与降级 IR 实际锚"二零二二@6.6s→198"不一致（l1-c04 报告 M2 输入）——按 §7.0 裁定以 IR 词锚 198 为准 | 视觉 |
| ⚠️ 216 | **327**（216→327，+111） | 10.90s | 三根柱全部可见，柱高比例 ≈180:240:330（A-C04-01 帧号改按 327；y/宽度判据不变）。算式：三柱生长锚分别为"二零二二"@6.6s→198（6.6×30=198）、"二零二三"@8.7s→261（8.7×30=261）、"二零二四"@10.1s→303（10.1×30=303）；末柱 24 帧落定 → 303+24=**327**。原 F216 处实测仅 bar22 在生长（198+24 的 75%，§7.0 校准锚点 1） | 视觉 |
| 540 | **549**（540→549，+9） | 18.30s | 折线图区出现；首点 3.0% 在左下（an_line_draw / an_note_in 锚"增速"第 2 次@18.3s：18.3×30=549→549）；60 帧淡入完成于 F609 | 视觉 + DOM |
| ⚠️ 720 | **609**（720→609，−111） | 20.30s | 折线三点与连线完整；纵轴刻度 0–6% 可见（549+60=609 落定）。原 720 是目标 schema 24s 编排帧，词锚下 24.3s 仅对应"不变价"词（与折线无锚定关系） | 视觉 |
| ⚠️ 900 | **909**（900→909，+9） | 30.30s | 占比环出现（an_ring_in / an_ring_num_in 锚"产业"@30.3s：30.3×30=909→909）；扇区橙 56.7%、灰 43.3% 目标语义（现实现为整圆单色，C04-D7）；环心数字 56.7%。封面帧候选同步改按 909（l1 实测环 F909 才入场，F900 不含主图） | 视觉 + T-15 |
| 960 | **957**（960→957，−3） | 31.90s | 环心数字 56.7% 可见；ef_ring_cnt counter 开始滚动（锚"五十六点七"@31.9s：31.9×30=957→957）。原表 960 已含此锚算式注释，推导坐实 | 视觉 |
| ⚠️ 1260 | **1269**（1260→1269，+9；词表节拍） | 42.30s | 三图同屏缩略并置（降级未实现，三图保持原尺寸，C04 降级映射）；结论句在底部字幕区。"总量"第 3 次@42.3s：42.3×30=1269→1269 是 S8 结论句的词表节拍参考；注意降级 IR 三条 an_camera_pan_* 均锚"总量"occurrence=1@6.2s→F186（同刻起移，非本行），本行在词锚时钟下无专属锚点动画 | 视觉 |
| 1620 | **1620**（无词锚，行不变） | 54.00s | 片尾说明卡覆盖；图表元素被完全遮挡，无柱边 / 环弧透出。注意：降级 IR 中 el_note 的入场锚是"增速"@18.3s→F549（非片尾 54s），本行的"说明卡覆盖"期望在词锚时钟下无对应锚点动画，M2 需补片尾锚词或改 IR | 视觉 |
| 1799 | **1799**（尾帧，行不变） | 59.97s | 说明卡保持；音频流时长 ≥59.9s | MP4 |

推导锚词全表（`frame = ceil(word.start × 30)`，词表见 §4.2.3 / `c04.degraded.json`）：数据@0.0→0、总量@0.6→18、增速@0.95→29、占比@1.35→41、总量@6.2→186、二零二二@6.6→198、生产@7.05→212、二零二三@8.7→261、二零二四@10.1→303、现价@12.3→369、增速@18.3→549、二零二二@18.7→561、二零二三@19.65→590、二零二四@20.6→618、不变价@24.3→729、产业@30.3→909、第三产业@30.75→923、五十六点七@31.9→957、总量@42.3→1269、服务业@43.3→1299。

#### 4.2.6 断言
**关键视觉断言（可量化）**
- A-C04-01：帧 216（**[口径 round2] 帧号改按 §4.2.5 推导列 327 执行**——F216 处实测仅 bar22 在生长），三柱顶 y 坐标分别 ≈620、560、470（容差 ±10px），柱宽均 120px；柱高与 GDP 数值单调一致（2024 ≥ 2023 ≥ 2022）。
- A-C04-02：帧 900–1259，环图橙扇区弧长占整圆 ≈56.7%（像素采样：橙色弧段周长 / 全圆周长 ∈ [54.7%, 58.7%]）；环心数字文本宽度 ≤200px。
- A-C04-03：折线三点在 `x 800–1240, y 360–660` 区域内；点 2（5.2%）y 位置高于点 1（3.0%）与点 3（5.0%）。
- A-C04-04：帧 1620 起，柱图区 `x 80–760, y 300–800` 内蓝色像素占比 ≤2%（旧图被片尾卡遮挡）。

> **[修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 X-4 / example/internal/video/testdata/spec-audit-report.json X-4、C04 degradations"highlight 作用于整个 #canvas"）本节特效类断言按现实现重述**：`ef_hl_growth`（highlight"产业"）在现实现下不产生字幕词内上色，而是**整个 `#canvas` 背景（`#F2F5F9`→`#F5A623`）闪现约 0.25s**（timeline-builder.js:97-100 目标为 canvas）——X-4 实测 pulse/shake/fade 与 highlight 同样全画布作用，本案 IR 若按目标 schema 补 pulse 类特效（如镜头 4 的 counter 宿主脉冲设想）也会全画布缩放。帧差断言应改为检查"全画布背景色抬升"这一实际可见差异；"字幕词变色"断言在现实现下判 ⛔（词级高亮需逐词 text 元素替代路径，§5.12）。

**自动化断言（分层）**
- IR 层：`words=20`、单调不重叠；`elements=10`、`animations=7`、`effects=3`；每条 counter 的 to 值与 §4.2.2 表内数字一致（1349084、56.7）；无 src 含 `://` / `data:`。
- DOM 层：三柱、折线、环图节点存在；图表文本标签与 script 中数字一致；说明卡包含"国家统计局"字样。
- 帧层：L1 golden 帧 216 / 720 / 900 / 1620 SSIM ≥0.95；counter 帧序列（柱顶数字）在 24 帧内单调递增，不倒退。
- MP4 层：时长 60.0s ±0.1s；1920×1080；30fps；音视频流均存在；缩略图 atSec=30.0 可解码。
**人工验收点**
1. 三组图的数值与公报表逐一对得上，无四舍五入造成的量级错误。
2. 柱、线、环的出现顺序与口播 S2→S4→S6 一致，不提前露出后组图表。
3. 片尾说明卡能看出口径（现价 / 不变价）与来源类型，不出现具体外链字符溢出。
4. 静音状态下，仅靠图形高度、折线高低、扇区大小能判断"总量上升、增速 5% 上下、服务业过半"。
**失败注入**
- F-C04-01：注入越界数据点（折线 y 超出 0–6% 纵轴范围）。期望：渲染层裁切到轴区；IR 校验层应在 L0 单测拒绝越界坐标（`E_VIDEO_INVALID_PARAMS`，架构 §10.5）。
- F-C04-02：counter 的 to 值与柱标签静态文本不一致（如 to=1300000 而标签 1,349,084）。期望：L1 帧断言检出数字与标签不一致；目标 schema 应加"标签—counter 同源"校验。
- F-C04-03：锚定词"总量"出现三次，注入时遗漏 occurrence。期望：现实现按 same_text 候选解析，歧义时记 `E_VIDEO_ANCHOR_AMBIGUOUS`；现状代码在歧义下取首个匹配，需在断言中标注该差异。
- F-C04-04：asset key 非 `video/` 前缀。期望：IR 校验拒绝（`[代码] ir.go:355-365`），返回 `E_VIDEO_INVALID_IR`，不进入渲染。

#### 4.2.7 当前可实现性小结
**结论**：三组静态图表的几何与逐柱生长近似可落地；**折线逐段描线、counter 定位到标签旁、图表数据—几何绑定**是阻塞项。T-06 镜头平移现只能用元素级位移近似，无 group/镜头对象。阻塞项对应 §1 能力矩阵：counter 布局行、chart 元素类型行、group 镜头行。
---

### 4.3 VS-C05「旅行 / 生活方式」：十一月京都红叶步行线

#### 4.3.1 案例头

| 字段 | 内容 |
|---|---|
| 案例 ID | VS-C05 |
| 名称 | 京都红叶季步行线（哲学之道 → 东福寺通天桥） |
| 内容类型 | 旅行 / 生活方式短片 |
| 目标受众 | 计划秋季日本旅行的人群；竖屏沉浸观看，重氛围与取景参考 |
| 发布渠道 | 短视频信息流竖屏；前 3s 需给出红叶大图与地点钩子 |
| 画幅 / 分辨率 | 1080×1920（9:16 竖屏） |
| fps | 30 |
| 时长 | 30.0s（目标帧数 ceil(30×30)=900；现实现 round=900） |
| 语言 | 普通话旁白 + 中文字幕 |
| 优先级 | P2 |
| 依赖案例 | 无 |

#### 4.3.2 创作规格
**一句话主张**：十一月中旬沿一条步行路径看京都红叶，用统一色调和取景框把季节、光线和场景交给观众。
**场景真实性说明**：哲学之道（左大路通至银阁寺方向的水渠步道）与东福寺通天桥均为京都公开观光地；红叶最佳观赏期通常在十一月中下旬，具体年份随气温浮动 `[待验证]`，验证方法：出发前核对京都市观光协会或东福寺官方当年红叶见顷预报。本片不标注具体日期承诺。
**完整逐句脚本（S1..S5，可直接配音）**
- S1 十一月中旬，京都的红叶进入最佳观赏期。
- S2 从哲学之道沿水渠北行，两侧枫树把天光滤成橙红与金褐。
- S3 东福寺通天桥上，红叶层层叠进山谷，桥栏与树冠构成上下两道水平线。
- S4 午后光线偏暖，画面统一压低饱和度，保留红叶的橙红与苔藓的绿。
- S5 三十秒短片不做地图跳转，只沿一条步行路径推进，把季节、光线和一处处取景框留给观众。
**分镜表**（30fps；竖屏 1080×1920）

| 镜号 | 帧范围 | 画面 | 图层 / 元素 | 动效与锚点词 | 字幕 / 音频 |
|---|---|---|---|---|---|
| 1 | 0–149 (0.0–5.0s) | 钩子大图：水渠 + 两侧红叶；上下信箱遮罩条；标题卡 | tr_main: el_photo1；tr_mask: el_bar_top, el_bar_bot；tr_overlay: el_title | T-09 标题与地点卡错峰入场（间隔 10 帧）；T-03 信箱条固定上下各 120px | S1；BGM 淡入 0–3s |
| 2 | 150–329 (5.0–11.0s) | 水渠场景沿水平方向缓慢位移（路径运动近似）；地点名"哲学之道"浮现 | tr_main: el_photo1；tr_overlay: el_place1 | T-08：el_photo1 沿 move 轨迹 x −40→0 往返近似路径平移；锚点"水渠" | S2 |
| 3 | 330–539 (11.0–18.0s) | 切东福寺通天桥；局部取景遮罩：中央 720×1080 取景框，框外压暗 | tr_main: el_photo2；tr_mask: el_vignette；tr_overlay: el_place1 | T-03 取景框 scaleIn；T-09 地点卡与取景框错峰 8 帧；锚点"通天桥" | S3 |
| 4 | 540–719 (18.0–24.0s) | 色调叠层：底部色卡小条（橙红 / 金褐 / 苔藓绿）；压暗大图 | tr_overlay: el_palette；tr_main: el_photo2 | 色卡三块 scaleIn 错峰；highlight"橙红""苔藓" | S4 |
| 5 | 720–899 (24.0–30.0s) | 收束画面：步道方向线 + 片尾地点行；BGM 淡出 | tr_overlay: el_path_line, el_place1；tr_caption: el_caption | T-08 路径线沿 move 自左向右生长；无新场景图 | S5；BGM 27s 起淡出 |

**版式**
- 大图铺满 1080×1920；信箱条高 120px（y 0–120、y 1800–1920）；地点卡位于 y 300 带；字幕 y 1660–1760。
- 字号：标题 58px/700；地点名 40px/600；旁白字幕 38px/500；色卡标注 26px/400。行高 1.4；地点卡左对齐贴安全边 72px。
**色彩**
- 画面色调：橙红 `#C8553D`、金褐 `#D9A441`、苔藓绿 `#5E7A52`；遮罩压暗层 `#0E1418` 透明度 55%。
- 全片统一饱和度：HSL S 通道相对原图 −15% `[待验证]`，验证方法：抽帧对比原图与成片 S 通道均值，差值落在 ±5% 内。
**字体**：思源黑体 / Noto Sans CJK SC；地点名可搭配衬线感字重 600。无特殊符号，缺字风险低。
**素材清单**

| id | 用途 | 规格 | 生成 / 来源 | 许可 |
|---|---|---|---|---|
| as_photo_path | 哲学之道水渠红叶 | 1080×1920 JPEG，sRGB | 实拍 / 授权图库 | 图库商用授权（assets 登记） |
| as_photo_bridge | 东福寺通天桥红叶 | 1080×1920 JPEG，sRGB | 实拍 / 授权图库 | 图库商用授权 |
| as_bgm_walk | 氛围环境乐 | m4a，约 31s，BPM 84 | 授权曲库 | 曲库商用授权 |

**音频策略（T-13）**
- voice zh-CN 女声 rate 1.0；BGM BPM 84，音量 0.20，目标氛围：环境铺底、不压旁白。现实现 mux 无 loudnorm、无 BGM loop、无 apad（`[代码] encode.go:147-185`）；30s 短片 BGM 长度 ≥30s 即可，循环与响度归一属待扩展。旁白段 BGM 相对垫音 −6dB 的 ducking 现实现不支持，需在素材母带阶段预混。
**字幕策略**：中文硬字幕；行长 ≤16 rune、≤2 行、≤6s；地点名在画面卡与字幕中各出现一次。不做双语。

#### 4.3.3 IR 规格（目标 schema）

```json
{
  "schemaVersion": 1,
  "meta": {"width": 1080, "height": 1920, "fps": 30, "durationSec": 30.0, "background": "#0E1418"},
  "voice": {"provider": "http", "voice": "zh-CN-female-02", "rate": 1.0, "audioKey": null},
  "script": "S1 十一月中旬，京都的红叶进入最佳观赏期。S2 从哲学之道沿水渠北行，两侧枫树把天光滤成橙红与金褐。S3 东福寺通天桥上，红叶层层叠进山谷，桥栏与树冠构成上下两道水平线。S4 午后光线偏暖，画面统一压低饱和度，保留红叶的橙红与苔藓的绿。S5 三十秒短片不做地图跳转，只沿一条步行路径推进，把季节、光线和一处处取景框留给观众。",
  "words": [
    {"id": "w01", "index": 0, "start": 0.0, "end": 0.45, "text": "十一月", "source": "aligner", "confidence": 0.97, "scriptStart": 2, "scriptEnd": 5}, {"id": "w02", "index": 1, "start": 0.45, "end": 0.85, "text": "京都", "source": "aligner", "confidence": 0.96, "scriptStart": 7, "scriptEnd": 9}, {"id": "w03", "index": 2, "start": 0.85, "end": 1.15, "text": "红叶", "source": "aligner", "confidence": 0.98, "scriptStart": 10, "scriptEnd": 12}, {"id": "w04", "index": 3, "start": 1.15, "end": 1.55, "text": "观赏期", "source": "aligner", "confidence": 0.94, "scriptStart": 15, "scriptEnd": 18},
    {"id": "w05", "index": 4, "start": 5.2, "end": 5.6, "text": "哲学", "source": "aligner", "confidence": 0.95, "scriptStart": 23, "scriptEnd": 25}, {"id": "w06", "index": 5, "start": 5.6, "end": 5.85, "text": "之道", "source": "aligner", "confidence": 0.95, "scriptStart": 25, "scriptEnd": 27}, {"id": "w07", "index": 6, "start": 5.85, "end": 6.15, "text": "水渠", "source": "aligner", "confidence": 0.96, "scriptStart": 29, "scriptEnd": 31}, {"id": "w08", "index": 7, "start": 6.5, "end": 6.8, "text": "枫树", "source": "aligner", "confidence": 0.93, "scriptStart": 34, "scriptEnd": 36},
    {"id": "w09", "index": 8, "start": 7.2, "end": 7.55, "text": "橙红", "source": "aligner", "confidence": 0.96, "scriptStart": 39, "scriptEnd": 41}, {"id": "w10", "index": 9, "start": 7.55, "end": 7.85, "text": "金褐", "source": "aligner", "confidence": 0.95, "scriptStart": 42, "scriptEnd": 44}, {"id": "w11", "index": 10, "start": 11.2, "end": 11.6, "text": "东福寺", "source": "aligner", "confidence": 0.95, "scriptStart": 49, "scriptEnd": 52}, {"id": "w12", "index": 11, "start": 11.6, "end": 11.95, "text": "通天桥", "source": "aligner", "confidence": 0.94, "scriptStart": 52, "scriptEnd": 55},
    {"id": "w13", "index": 12, "start": 11.95, "end": 12.3, "text": "红叶", "source": "aligner", "confidence": 0.97, "scriptStart": 57, "scriptEnd": 59}, {"id": "w14", "index": 13, "start": 13.1, "end": 13.4, "text": "桥栏", "source": "aligner", "confidence": 0.93, "scriptStart": 66, "scriptEnd": 68}, {"id": "w15", "index": 14, "start": 13.4, "end": 13.7, "text": "树冠", "source": "aligner", "confidence": 0.94, "scriptStart": 69, "scriptEnd": 71}, {"id": "w16", "index": 15, "start": 18.3, "end": 18.7, "text": "饱和度", "source": "aligner", "confidence": 0.92, "scriptStart": 88, "scriptEnd": 91},
    {"id": "w17", "index": 16, "start": 19.3, "end": 19.6, "text": "橙红", "source": "aligner", "confidence": 0.96, "scriptStart": 95, "scriptEnd": 97}, {"id": "w18", "index": 17, "start": 19.6, "end": 19.95, "text": "苔藓", "source": "aligner", "confidence": 0.95, "scriptStart": 98, "scriptEnd": 100}, {"id": "w19", "index": 18, "start": 24.3, "end": 24.7, "text": "路径", "source": "aligner", "confidence": 0.94, "scriptStart": 119, "scriptEnd": 121}, {"id": "w20", "index": 19, "start": 25.6, "end": 26.0, "text": "取景框", "source": "aligner", "confidence": 0.93, "scriptStart": 130, "scriptEnd": 133}
  ],
  "tracks": [
    {"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_mask", "kind": "overlay", "z": 5}, {"id": "tr_overlay", "kind": "overlay", "z": 10}, {"id": "tr_caption", "kind": "subtitle", "z": 20}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.2, "assetKey": "video/vs-c05/as_bgm_walk.m4a"}
  ],
  "elements": [
    {"id": "el_photo1", "type": "image", "trackId": "tr_main", "startFrame": 0, "endFrame": 329, "params": {"x": 0, "y": 0, "w": 1080, "h": 1920, "crop": "center"}, "src": "video/vs-c05/as_photo_path.jpg"}, {"id": "el_photo2", "type": "image", "trackId": "tr_main", "startFrame": 330, "endFrame": 899, "params": {"x": 0, "y": 0, "w": 1080, "h": 1920, "crop": "center"}, "src": "video/vs-c05/as_photo_bridge.jpg"}, {"id": "el_bar_top", "type": "shape", "trackId": "tr_mask", "startFrame": 0, "endFrame": 899, "params": {"x": 0, "y": 0, "w": 1080, "h": 120, "color": "#0E1418"}}, {"id": "el_bar_bot", "type": "shape", "trackId": "tr_mask", "startFrame": 0, "endFrame": 899, "params": {"x": 0, "y": 1800, "w": 1080, "h": 120, "color": "#0E1418"}}, {"id": "el_vignette", "type": "shape", "trackId": "tr_mask", "startFrame": 330, "endFrame": 719, "params": {"x": 180, "y": 420, "w": 720, "h": 1080, "shape": "frame", "stroke": "#F2F5F9", "strokeW": 3, "outsideDim": true}},
    {"id": "el_title", "type": "text", "trackId": "tr_overlay", "startFrame": 0, "endFrame": 329, "params": {"text": "京都 · 十一月红叶步行线", "x": 540, "y": 300, "fontSize": 58, "weight": 700, "color": "#FFFFFF", "align": "center"}}, {"id": "el_place1", "type": "text", "trackId": "tr_overlay", "startFrame": 150, "endFrame": 329, "params": {"text": "哲学之道 · 水渠", "x": 72, "y": 1500, "fontSize": 40, "weight": 600, "color": "#F2F5F9", "align": "left"}}, {"id": "el_palette", "type": "shape", "trackId": "tr_overlay", "startFrame": 540, "endFrame": 719, "params": {"x": 180, "y": 1560, "w": 720, "h": 60, "swatches": ["#C8553D", "#D9A441", "#5E7A52"]}}, {"id": "el_path_line", "type": "shape", "trackId": "tr_overlay", "startFrame": 720, "endFrame": 899, "params": {"x": 120, "y": 1620, "w": 840, "h": 4, "shape": "line", "color": "#D9A441"}}, {"id": "el_caption", "type": "text", "trackId": "tr_caption", "startFrame": 0, "endFrame": 899, "params": {"text": "", "x": 540, "y": 1690, "fontSize": 38, "weight": 500, "color": "#FFFFFF", "align": "center", "maxLines": 2, "maxLineRunes": 16}}
  ],
  "animations": [
    {"id": "an_title_in", "targetElementId": "el_title", "type": "scaleIn", "startFrame": 0, "durationFrames": 24, "easing": "power2.out", "params": {}}, {"id": "an_photo1_pan", "targetElementId": "el_photo1", "type": "move", "startFrame": 150, "durationFrames": 120, "easing": "power1.out", "from": {"x": -40, "y": 0}, "to": {"x": 0, "y": 0}, "params": {"path": "linear-horizontal"}}, {"id": "an_place1_in", "targetElementId": "el_place1", "type": "scaleIn", "startFrame": 160, "durationFrames": 18, "easing": "power2.out", "params": {}}, {"id": "an_vignette_in", "targetElementId": "el_vignette", "type": "scaleIn", "startFrame": 330, "durationFrames": 24, "easing": "power2.out", "params": {}}, {"id": "an_place2_in", "targetElementId": "el_palette", "type": "scaleIn", "startFrame": 548, "durationFrames": 18, "easing": "power1.out", "params": {"staggerFrames": 120}},
    {"id": "an_path_grow", "targetElementId": "el_path_line", "type": "move", "startFrame": 720, "durationFrames": 40, "easing": "power2.out", "from": {"w": 0}, "to": {"w": 840}, "params": {}}
  ],
  "effects": [
    {"id": "ef_hl_maple", "type": "highlight", "targetElementId": "el_caption", "anchor": {"wordId": "w03", "lastText": "红叶", "lastIndex": 2, "occurrence": 0, "resolvedFrom": "exact", "status": "resolved"}, "params": {"color": "#C8553D"}}, {"id": "ef_pulse_frame", "type": "pulse", "targetElementId": "el_vignette", "anchor": {"wordId": "w05", "lastText": "之道", "lastIndex": 4, "occurrence": 0, "resolvedFrom": "crossWord", "status": "resolved"}, "params": {"scale": 1.03}}, {"id": "ef_fade_bars", "type": "fade", "targetElementId": "el_bar_top", "anchor": {"wordId": "w20", "lastText": "取景框", "lastIndex": 19, "resolvedFrom": "exact", "status": "resolved"}, "params": {"opacity": 0.9}}
  ],
  "assets": [
    {"key": "video/vs-c05/as_photo_path.jpg", "kind": "image", "bytes": 1480000, "license": "图库商用授权"}, {"key": "video/vs-c05/as_photo_bridge.jpg", "kind": "image", "bytes": 1560000, "license": "图库商用授权"}, {"key": "video/vs-c05/as_bgm_walk.m4a", "kind": "audio", "bytes": 1420000, "license": "曲库商用授权"}
  ],
  "render": {"width": 1080, "height": 1920, "fps": 30, "crf": 20, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "burn", "fontSizePx": 38, "maxLineRunes": 16}, "thumbnail": {"atSec": 12.0}}
}
```

#### 4.3.4 现状降级映射


| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-08 路径运动（沿路径位移近似） | animation `path` + move from/to | 现仅 `move|scaleIn|rotate`，move 为直线双端点插值，无曲线路径 | ⚠️ | 目标：沿步道弧线平移；现状：水平 / 直线往返，弧线弯道被拉直；位移量与方向需手工拆成多段 move 拼接 |
| T-03 遮罩裁剪（信箱条 / 局部取景框） | shape `frame`、`outsideDim`、image `crop` | 现 Element 类型仅 image/text/shape，无 mask / clip-path 节点；信箱条用两个不透明 shape 覆盖近似 | ⚠️ | 取景框"框外压暗"需半透明覆盖层叠加，不能做真正的 alpha 遮罩；大图裁切位置只支持 center，不支持自由取景框坐标 |
| T-09 错峰入场 | animation `staggerFrames`、各元素错峰 startFrame | 现无元素级延迟容器；错峰靠逐条写不同 startFrame + scaleIn from 0 近似 | ✅ | 帧级错峰可落地；缺点：入场动画类型只有 scaleIn/move/rotate，无 opacity 淡入，元素在 0 帧已存在于 DOM |
| T-13 BGM 氛围与音量 | track `volume`、render loudness、ducking | 现 AudioTrack 有 `volume` 字段 `[代码] ir.go:136-146`；mux 阶段固定 `volume=`，无 loudnorm、无旁白侧 ducking、无 loop `[代码] encode.go:147-185` | ⚠️ | 整体音量可设；旁白出现时 BGM 自动压低做不到，需素材预混；响度 −16 LUFS 无法在导出阶段保证 |
| 大图裁切构图 | image `crop` 参数 + 取景坐标 | 现 image src 仅加载元素框，裁切由 CSS object-fit 承担，IR 不记录取景坐标 | ⚠️ | 换图后取景构图需手工重算 x/y/w/h；IR 内不保存"原图 → 取景框"的映射 |
| 场景切换 | 元素 startFrame/endFrame 卸载旧图 | 现元素整片存在；两张照片叠放靠 z 顺序与遮罩覆盖 | ⚠️ | 镜 1→镜 2 切换时 el_photo1 在 DOM 中残留，若遮罩未完全覆盖会透出旧图边缘 |
| 色彩统一（饱和度 / 色调） | render 全局调色参数 | 现渲染管线无颜色滤镜节点；色调统一需在素材预处理阶段完成 | ⛔ | IR 阶段无法表达 S −15%、暖调偏移；成片色彩断言只能比对预处理后的素材，不能在渲染期校正 |
| 元素时间区间 | `startFrame/endFrame` | 整片存在，靠动画 from 值入场 | ⚠️ | 与 §4.1.4 同；无真正的元素卸载 |
| 扩展草案键（params 内）：crop、opacity、outsideDim、path、shape（frame、line）、staggerFrames、stroke、swatches | 目标 schema 未定义 | 现 builder 不消费该键，无现实现替代 | ⛔ 依赖 §5.16 提案 | 现渲染会忽略这些键，画面不出现对应效果 |
| 动画参数层级 | 目标 schema 将 from/to、easing 置于 params | 现 `ElementAnimation` 读顶层 from/to、fromValue/toValue、easing；案例 IR 已按顶层书写 | ✅ 以顶层为准 | params 内仅保留扩展键（axis、staggerFrames、reveal、path 等），不承载运动参数 |
#### 4.3.5 预期帧表

| 帧号 | 时刻 | 期望画面状态 | 断言类型 |
|---|---|---|---|
| 0 | 0.00s | 水渠红叶大图铺满；上下信箱条可见；标题在 y≈300 | 视觉 + DOM |
| 24 | 0.80s | 标题 scaleIn 结束；地点卡尚未入场（T-09 错峰） | 视觉 |
| 150 | 5.00s | el_photo1 开始水平位移；地点名"哲学之道 · 水渠"出现 | 视觉 |
| 329 | 10.97s | 水渠场景结束；el_photo2 在 330 帧切入 | DOM |
| 330 | 11.00s | 通天桥画面；中央取景框 720×1080；框外压暗层可见 | 视觉 |
| 548 | 18.27s | 色卡三块（橙红 / 金褐 / 苔藓绿）错峰出现 | 视觉 + DOM |
| 720 | 24.00s | 路径线开始自左向右生长；片尾地点行就位 | 视觉 |
| 800 | 26.67s | 路径线满宽 840px；画面无第三张场景图 | 视觉 |
| 899 | 29.97s | 片尾卡保持；音频时长 ≥29.9s；BGM 已淡出 | MP4 |

#### 4.3.6 断言
**关键视觉断言（可量化）**
- A-C05-01：帧 0–329，上下信箱条区域 `y 0–120` 与 `y 1800–1920` 平均亮度 ≤30（深色条）；中央区 `y 420–1500` 暖色像素（R>G>B 且 R−B≥25）占比 ≥30%。
- A-C05-02：帧 330–719，取景框内 `x 180–900, y 420–1500` 亮度 ≥ 框外对称区域亮度 1.2 倍（框外压暗生效）。
- A-C05-03：帧 548–719，色卡三块颜色分别匹配 `#C8553D / #D9A441 / #5E7A52`，容差 ΔE ≤8；三块水平并排，无重叠。
- A-C05-04：帧 150–270，el_photo1 的 x 位移在 −40→0 之间单调变化；相邻帧位移差 ≤3px（避免跳变）。
**自动化断言（分层）**
- IR 层：`words=20` 单调不重叠；`elements=10`、`animations=6`、`effects=3`；两张图片 assetKey 均以 `video/` 前缀；BGM asset 字节数 >0。
- DOM 层：两张 image 节点均存在；信箱条 shape 覆盖全屏宽；地点卡文本与 script 地点一致。
- 帧层：L1 golden 帧 24 / 330 / 548 / 800 SSIM ≥0.95；场景切换帧 329→330 整帧差 >0.25（确有换图）。
- MP4 层：时长 30.0s ±0.1s；1080×1920；30fps；音频流存在；缩略图 atSec=12.0 可解码。
**人工验收点**
1. 两张场景图的色温与饱和度统一，看不出两张素材来自不同拍摄日期 / 设备。
2. 取景框构图保留了桥栏与树冠两道水平线，没有把主体切在框边。
3. 旁白与地点卡出现顺序一致，字幕不挡取景主体。
4. 全片无地图跳转、无多余场景；30s 内只呈现一条步行线。
**失败注入**
- F-C05-01：注入图片 asset 不可解码。期望：`img.decode().catch()` 吞错，画面留背景色不崩溃 `[代码] timeline-builder.js:158-160`；帧层断言检出中央区无暖色像素，人工验收记素材缺失。
- F-C05-02：BGM assetKey 缺失或为空。期望：现实现 audio 仅作时长基准、预览不创建 audio 节点 `[代码] timeline-builder.js:36-40`；MP4 层视频流仍可出片，音频流缺失记为降级而非渲染失败。
- F-C05-03：取景框坐标越界（x 为负或 w 超出画布）。期望：IR 校验 L0 单测拒绝非法元素框（`E_VIDEO_INVALID_PARAMS`）；现状代码对元素框无强制裁剪，需在断言中标注该缺口。
- F-C05-04：锚定词"红叶"在 script 中出现两次，注入时 occurrence 缺失。期望：现实现按 same_text 取候选；目标 schema 歧义应返回 `E_VIDEO_ANCHOR_AMBIGUOUS`。

#### 4.3.7 当前可实现性小结
**结论**：信箱遮罩近似、帧级错峰、直线位移与整体音量可在现管线落地；**曲线路径运动、真正 alpha 遮罩、全局调色与旁白 ducking** 是阻塞项。旅行类氛围与构图判断主要依赖人工验收，帧级断言只能覆盖遮罩亮度与色块匹配。
---

### 4.4 VS-C06「访谈 / 字幕」：双人对谈——小团队怎么做工具产品

#### 4.4.1 案例头

| 字段 | 内容 |
|---|---|
| 案例 ID | VS-C06 |
| 名称 | 双人访谈：独立开发者谈窄场景与功能边界 |
| 内容类型 | 访谈 / 对话纪实 |
| 目标受众 | 初创团队、独立开发者；横屏观看，依赖字幕理解对白 |
| 发布渠道 | 横屏视频号 / B 站 / 官网内嵌；可导出软字幕供剪辑复用 |
| 画幅 / 分辨率 | 1920×1080（16:9 横屏） |
| fps | 25 |
| 时长 | 90.0s（目标帧数 ceil(90×25)=2250；现实现 round=2250） |
| 语言 | 普通话原声；中文硬字幕 + 英文软字幕（双语策略） |
| 优先级 | P0 |
| 依赖案例 | 无 |

#### 4.4.2 创作规格
**一句话主张**：用一段双人对谈，讲清小团队"先选窄场景、再卡功能边界"的产品判断。
**人物与画面**
- A 林澈：独立开发者 / 全栈工程师，画面左半 `x 0–960`；B 沈屿：主持人，画面右半 `x 960–1920`。
- 静态分屏：两人同时在画；说话方一侧姓名条亮起，另一侧压暗 20%。无正反打镜头切换（素材为双机位同框）。
**完整逐句脚本（S1..S11，可直接配音；括注说话人）**
- S1（A）很多人问，两个人的小团队怎么做工具产品。我们的答案是先选窄场景，再谈功能。
- S2（B）你说的窄场景，具体指什么？
- S3（A）比如文件重命名这种需求，用户要的不是一个全能管理器，而是把一批文件名一次改对。
- S4（B）那团队规模怎么决定功能边界？
- S5（A）我们按"一周内能否完整交付"来卡：超过一周的需求先记进清单，不进当前版本。
- S6（B）小团队最容易被什么拖住？
- S7（A）是自己加功能。用户没提的精致设置，往往最后只有设计者自己会用。
- S8（B）长期怎么做决策？
- S9（A）数据只回答"用户用不用"，不回答"该不该做"；方向还是靠自己对场景的判断。
- S10（B）最后给同类团队一句话？
- S11（A）先把一件小事做到不返工，再谈下一件。
**分镜表**（25fps；横屏 1920×1080）

| 镜号 | 帧范围 | 画面 | 图层 / 元素 | 动效与锚点词 | 字幕 / 音频 |
|---|---|---|---|---|---|
| 1 | 0–224 (0.0–9.0s) | 双机位同框淡入；左 A 右 B；A 说话，左侧姓名条亮 | tr_main: el_shotA, el_shotB；tr_name: el_nameA, el_nameB；tr_sub_zh: el_captionZh；tr_sub_en: el_captionEn | el_shotA/B scaleIn 0–20 帧；el_nameA 随 S1 锚点词亮起；T-07 开场淡入近似 | S1；中文硬字幕 + 英文软字幕 cue 1 |
| 2 | 225–449 (9.0–18.0s) | B 提问；右侧姓名条亮，左侧压暗 | tr_name: el_nameB；tr_sub_zh: el_captionZh；tr_sub_en: el_captionEn | el_nameB scaleIn；caption 切到 B 侧对齐；锚点"窄场景" | S2；双语 cue 2 |
| 3 | 450–674 (18.0–27.0s) | A 回答；左侧姓名条亮；示例句字幕两行内 | 同镜 1 | 说话人切换：caption move 到左半下方；锚点"重命名" | S3；双语 cue 3 |
| 4 | 675–899 (27.0–36.0s) | B 提问；右侧亮 | el_nameB；caption | 姓名条切换；T-07 段落间转场近似（两侧亮度交叉过渡 12 帧） | S4；cue 4 |
| 5 | 900–1124 (36.0–45.0s) | A 回答；左侧亮；引号"一周内能否完整交付"在字幕中保留 | el_nameA；captionZh | highlight"一周"；captionEn 同步切换 | S5；cue 5 |
| 6 | 1125–1349 (45.0–54.0s) | B 提问；右侧亮 | el_nameB；caption | 姓名条切换 | S6；cue 6 |
| 7 | 1350–1574 (54.0–63.0s) | A 回答；左侧亮 | el_nameA；caption | highlight"自己加功能" | S7；cue 7 |
| 8 | 1575–1799 (63.0–72.0s) | B 提问；右侧亮 | el_nameB；caption | 姓名条切换 | S8；cue 8 |
| 9 | 1800–2024 (72.0–81.0s) | A 回答；左侧亮；长句断为两行 | el_nameA；captionZh/En | T-01 断行在句读处；captionEn 软字幕独立轨 | S9；cue 9 |
| 10 | 2025–2249 (81.0–90.0s) | B 收尾提问 → A 结论句；片尾姓名条保持 | el_nameA, el_nameB；el_endline | 结论句 scaleIn；无新素材 | S10–S11；cue 10–11；BGM 淡出 |

**版式**
- 分屏中线 `x=960`；姓名条位于各自半屏底部 `y 860–910`，高 50px；字幕区 `y 950–1030`，跨中线居中；英文软字幕位于中文下方预留行（仅软字幕轨，不烧录）。
- 字号：姓名 30px/600；职位 24px/400；中文字幕 36px/500；英文字幕 28px/400。行高 1.4；中文 ≤16 rune/行、≤2 行（`[代码] subtitle.go:16-20`）。
**色彩**：背景 `#14181F`；A 侧强调 `#2E86DE`、B 侧强调 `#7E57C2`；字幕白 `#FFFFFF`；压暗侧遮罩 `#000000` 透明度 20%。对比度：白字对深底 ≥12:1 `[待验证]`。
**字体**：中文思源黑体；英文 Inter / Roboto。缺字风险：引号""与破折号 — 在 CJK 字体内覆盖；`[待验证]` 用 `document.fonts.check` 复核。
**素材清单**

| id | 用途 | 规格 | 生成 / 来源 | 许可 |
|---|---|---|---|---|
| as_shot_a | A 机位画面（左半） | 1920×1080（裁切左半 960×1080） | 双机位录制 | 肖像授权（录制合同登记） |
| as_shot_b | B 机位画面（右半） | 同上 | 双机位录制 | 肖像授权 |
| as_bgm_interview | 低音量背景垫乐 | m4a，约 91s，BPM 76 | 授权曲库 | 曲库商用授权 |

**音频策略**：voice 双人两条音轨（A/B 分别对齐 words）；BGM 音量 0.12，目标 −16 LUFS；现实现 mux 仅单 voice + 单 bgm 两路（`[代码] encode.go:147-185`），双人对白轨混合需在素材前置完成。预览不播放音频（`[代码] timeline-builder.js:36-40`）。
**字幕策略（T-14）**
- 中文：硬字幕，烧录进画面（libass 可用时走 `BurnSubtitles`；无 libass 返回 `ErrNoLibass` 降级为软字幕轨，`[代码] encode.go:188-238`）。
- 英文：软字幕 SRT sidecar，不烧录；与中文 cue 同时间码，供播放器开关。
- 逐句切分：一句一 cue；单 cue ≤6s；最短显示时长目标 ≥1.2s（短问句不压成一闪而过）；cue 起止与说话人切换帧同步：姓名条切换帧 = cue 切换帧 ±1 帧。
- T-01 断行：优先在句读（，。？！）处折行；禁止行首出现标点。现状 `layoutLines` 只在空格处折行，纯中文按 rune 中点硬切，可能切在词中间且行首可能出现标点 `[代码] subtitle.go:66-96`——本案例在脚本写作时即按 16 rune 预断行，把风险压到最低。

#### 4.4.3 IR 规格（目标 schema）

> **⚠️ [修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 M-C04-07（同款差异）/ example/internal/video/testdata/spec-audit-report.json M-C04-07、X-3 ⑥）此 JSON 块为目标 schema 示意，不能直接提交现实现**：现实现动画必须内嵌在 `elements[].animations`，下列顶层 `animations[]`（an_shotA_in … an_endline_in）会被 projector 整个丢弃；照抄时须删除各处 `targetElementId` 键。可运行的降级转换版本见 `example/internal/video/testdata/ir/c06.degraded.json`（过 `videoapp.Validate`，DurationFrames=2250），转换规则全录于 spec-audit-report.json X-3。下块原文保留，不改写历史。
```json
{
  "schemaVersion": 1,
  "meta": {"width": 1920, "height": 1080, "fps": 25, "durationSec": 90.0, "background": "#14181F"},
  "voice": {"provider": "http", "voice": "mixed-two-speakers", "rate": 1.0, "audioKey": null},
  "script": "S1（A）很多人问，两个人的小团队怎么做工具产品。我们的答案是先选窄场景，再谈功能。S2（B）你说的窄场景，具体指什么？S3（A）比如文件重命名这种需求，用户要的不是一个全能管理器，而是把一批文件名一次改对。S4（B）那团队规模怎么决定功能边界？S5（A）我们按一周内能否完整交付来卡：超过一周的需求先记进清单，不进当前版本。S6（B）小团队最容易被什么拖住？S7（A）是自己加功能。用户没提的精致设置，往往最后只有设计者自己会用。S8（B）长期怎么做决策？S9（A）数据只回答用户用不用，不回答该不该做；方向还是靠自己对场景的判断。S10（B）最后给同类团队一句话？S11（A）先把一件小事做到不返工，再谈下一件。",
  "words": [
    {"id": "w01", "index": 0, "start": 0.0, "end": 0.45, "text": "很多人", "source": "aligner", "confidence": 0.97, "scriptStart": 5, "scriptEnd": 8}, {"id": "w02", "index": 1, "start": 0.45, "end": 0.95, "text": "两个人", "source": "aligner", "confidence": 0.95, "scriptStart": 10, "scriptEnd": 13}, {"id": "w03", "index": 2, "start": 0.95, "end": 1.25, "text": "团队", "source": "aligner", "confidence": 0.96, "scriptStart": 14, "scriptEnd": 16}, {"id": "w04", "index": 3, "start": 1.25, "end": 1.65, "text": "工具", "source": "aligner", "confidence": 0.95, "scriptStart": 18, "scriptEnd": 20},
    {"id": "w05", "index": 4, "start": 2.3, "end": 2.65, "text": "窄场景", "source": "aligner", "confidence": 0.96, "scriptStart": 28, "scriptEnd": 31}, {"id": "w06", "index": 5, "start": 9.2, "end": 9.55, "text": "窄场景", "source": "aligner", "confidence": 0.97, "scriptStart": 38, "scriptEnd": 41}, {"id": "w07", "index": 6, "start": 18.2, "end": 18.55, "text": "文件", "source": "aligner", "confidence": 0.95, "scriptStart": 51, "scriptEnd": 53}, {"id": "w08", "index": 7, "start": 18.55, "end": 18.95, "text": "重命名", "source": "aligner", "confidence": 0.96, "scriptStart": 53, "scriptEnd": 56},
    {"id": "w09", "index": 8, "start": 19.6, "end": 20.0, "text": "文件名", "source": "aligner", "confidence": 0.94, "scriptStart": 63, "scriptEnd": 66}, {"id": "w10", "index": 9, "start": 27.2, "end": 27.55, "text": "团队", "source": "aligner", "confidence": 0.96, "scriptStart": 76, "scriptEnd": 78}, {"id": "w11", "index": 10, "start": 27.55, "end": 27.95, "text": "规模", "source": "aligner", "confidence": 0.93, "scriptStart": 78, "scriptEnd": 80}, {"id": "w12", "index": 11, "start": 36.2, "end": 36.6, "text": "一周", "source": "aligner", "confidence": 0.95, "scriptStart": 94, "scriptEnd": 96},
    {"id": "w13", "index": 12, "start": 37.6, "end": 38.0, "text": "清单", "source": "aligner", "confidence": 0.94, "scriptStart": 105, "scriptEnd": 107}, {"id": "w14", "index": 13, "start": 45.2, "end": 45.6, "text": "团队", "source": "aligner", "confidence": 0.96, "scriptStart": 118, "scriptEnd": 120}, {"id": "w15", "index": 14, "start": 54.2, "end": 54.6, "text": "功能", "source": "aligner", "confidence": 0.97, "scriptStart": 133, "scriptEnd": 135}, {"id": "w16", "index": 15, "start": 55.6, "end": 56.0, "text": "设置", "source": "aligner", "confidence": 0.93, "scriptStart": 142, "scriptEnd": 144},
    {"id": "w17", "index": 16, "start": 72.2, "end": 72.6, "text": "数据", "source": "aligner", "confidence": 0.96, "scriptStart": 166, "scriptEnd": 168}, {"id": "w18", "index": 17, "start": 73.6, "end": 74.0, "text": "场景", "source": "aligner", "confidence": 0.95, "scriptStart": 178, "scriptEnd": 180}, {"id": "w19", "index": 18, "start": 81.2, "end": 81.6, "text": "团队", "source": "aligner", "confidence": 0.96, "scriptStart": 195, "scriptEnd": 197}, {"id": "w20", "index": 19, "start": 85.2, "end": 85.7, "text": "返工", "source": "aligner", "confidence": 0.94, "scriptStart": 207, "scriptEnd": 209}
  ],
  "tracks": [
    {"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_name", "kind": "overlay", "z": 5}, {"id": "tr_sub_zh", "kind": "subtitle", "z": 20, "mode": "burn"}, {"id": "tr_sub_en", "kind": "subtitle", "z": 19, "mode": "soft", "assetKey": "video/vs-c06/subtitles-en.srt"}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.12, "assetKey": "video/vs-c06/as_bgm_interview.m4a"}
  ],
  "elements": [
    {"id": "el_shotA", "type": "image", "trackId": "tr_main", "startFrame": 0, "endFrame": 2249, "params": {"x": 0, "y": 0, "w": 960, "h": 1080, "crop": "left-half"}, "src": "video/vs-c06/as_shot_a.jpg"}, {"id": "el_shotB", "type": "image", "trackId": "tr_main", "startFrame": 0, "endFrame": 2249, "params": {"x": 960, "y": 0, "w": 960, "h": 1080, "crop": "right-half"}, "src": "video/vs-c06/as_shot_b.jpg"}, {"id": "el_divider", "type": "shape", "trackId": "tr_main", "startFrame": 0, "endFrame": 2249, "params": {"x": 958, "y": 0, "w": 4, "h": 1080, "color": "#2A313B"}}, {"id": "el_nameA", "type": "text", "trackId": "tr_name", "startFrame": 0, "endFrame": 2249, "params": {"text": "林澈 · 独立开发者", "x": 60, "y": 860, "fontSize": 30, "weight": 600, "color": "#2E86DE", "align": "left"}}, {"id": "el_nameB", "type": "text", "trackId": "tr_name", "startFrame": 0, "endFrame": 2249, "params": {"text": "沈屿 · 主持人", "x": 1020, "y": 860, "fontSize": 30, "weight": 600, "color": "#7E57C2", "align": "left"}},
    {"id": "el_captionZh", "type": "text", "trackId": "tr_sub_zh", "startFrame": 0, "endFrame": 2249, "params": {"text": "", "x": 960, "y": 960, "fontSize": 36, "weight": 500, "color": "#FFFFFF", "align": "center", "maxLines": 2, "maxLineRunes": 16}}, {"id": "el_captionEn", "type": "text", "trackId": "tr_sub_en", "startFrame": 0, "endFrame": 2249, "params": {"text": "", "x": 960, "y": 1010, "fontSize": 28, "weight": 400, "color": "#C9D2DC", "align": "center", "maxLines": 1}}, {"id": "el_endline", "type": "text", "trackId": "tr_name", "startFrame": 2025, "endFrame": 2249, "params": {"text": "先把一件小事做到不返工", "x": 960, "y": 760, "fontSize": 34, "weight": 600, "color": "#FFFFFF", "align": "center"}}
  ],
  "animations": [
    {"id": "an_shotA_in", "targetElementId": "el_shotA", "type": "scaleIn", "startFrame": 0, "durationFrames": 20, "easing": "power2.out", "params": {}}, {"id": "an_shotB_in", "targetElementId": "el_shotB", "type": "scaleIn", "startFrame": 0, "durationFrames": 20, "easing": "power2.out", "params": {}}, {"id": "an_nameA_on", "targetElementId": "el_nameA", "type": "scaleIn", "startFrame": 0, "durationFrames": 12, "easing": "power1.out", "params": {}}, {"id": "an_nameB_on", "targetElementId": "el_nameB", "type": "scaleIn", "startFrame": 225, "durationFrames": 12, "easing": "power1.out", "params": {}}, {"id": "an_caption_move", "targetElementId": "el_captionZh", "type": "move", "startFrame": 450, "durationFrames": 10, "easing": "power1.out", "from": {"x": 480}, "to": {"x": 960}, "params": {}},
    {"id": "an_endline_in", "targetElementId": "el_endline", "type": "scaleIn", "startFrame": 2025, "durationFrames": 20, "easing": "power2.out", "params": {}}
  ],
  "effects": [
    {"id": "ef_hl_turn", "type": "highlight", "targetElementId": "el_captionZh", "anchor": {"wordId": "w02", "lastText": "团队", "lastIndex": 1, "occurrence": 0, "resolvedFrom": "crossWord", "status": "resolved"}, "params": {"color": "#2E86DE"}}, {"id": "ef_pulse_nameA", "type": "pulse", "targetElementId": "el_nameA", "anchor": {"wordId": "w08", "lastText": "重命名", "lastIndex": 7, "resolvedFrom": "exact", "status": "resolved"}, "params": {"scale": 1.06}}, {"id": "ef_fade_turn", "type": "fade", "targetElementId": "el_shotB", "anchor": {"wordId": "w10", "lastText": "团队", "lastIndex": 9, "occurrence": 1, "resolvedFrom": "exact", "status": "resolved"}, "params": {"opacity": 0.8}}
  ],
  "assets": [
    {"key": "video/vs-c06/as_shot_a.jpg", "kind": "image", "bytes": 1820000, "license": "录制肖像授权"}, {"key": "video/vs-c06/as_shot_b.jpg", "kind": "image", "bytes": 1790000, "license": "录制肖像授权"}, {"key": "video/vs-c06/subtitles-en.srt", "kind": "subtitle", "bytes": 26000, "license": "自有译稿"}, {"key": "video/vs-c06/as_bgm_interview.m4a", "kind": "audio", "bytes": 4200000, "license": "曲库商用授权"}
  ],
  "render": {"width": 1920, "height": 1080, "fps": 25, "crf": 20, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "burn+soft", "soft": ["en"], "fontSizePx": 36, "maxLineRunes": 16, "minCueSec": 1.2, "burn": "zh"}, "thumbnail": {"atSec": 6.0}}
}
```

#### 4.4.4 现状降级映射


| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-14 软 / 硬字幕 | track `mode: burn/soft`、render `subtitle.burn/soft`、asset SRT | 现 `BurnSubtitles` 仅做硬字幕烧录；无 libass 返回 `ErrNoLibass` 降级软字幕 `[代码] encode.go:188-238`；IR 内无独立字幕轨对象 | ⚠️ | 英文软字幕 sidecar 可作为独立 asset 交付，但 Player 时间轴不渲染软字幕轨；硬 / 软双轨在成片内不能同时由管线合成 |
| T-01 CJK 断行与行首标点 | `maxLineRunes`、断行点规则、行首标点禁止 | 现 `BuildCues` 限 16 rune / 2 行 / 6s；`layoutLines` 只在空格折行，纯中文按 rune 中点硬切，可能切词、行首可能出现标点 `[代码] subtitle.go:16-20`、`:66-96` | ⚠️ | 长句在无空格中文上可能出现词中断行或行首标点；本案例靠脚本预断行规避，但 IR 校验不拒绝行首标点 |
| T-02 字幕层与画面层层级 | track z：画面 z0、姓名条 z5、字幕 z20 | 现无 trackId；层级靠 DOM append 顺序；字幕元素在数组后即压在画面上 | ✅ | 同框分层可由 DOM 顺序近似；轨道级重排与整体显隐不支持 |
| T-07 段落间转场（近似方案） | 转场类型字段（crossfade / cut） | 现动画类型仅 move/scaleIn/rotate；段落切换用两侧遮罩亮度交叉 + 姓名条 scaleIn 近似，无独立转场节点 | ⚠️ | 目标：12 帧交叉淡化；现状：只能靠元素 scaleIn / move 拼出近似过渡，无 opacity 动画类型，不能做真正的透明度交叉 |
| 说话人—字幕同步 | caption 元素锚定说话人词；姓名条切换帧 = cue 切换帧 | 现锚点按 text 解析；caption 位置切换靠 move 动画；无"说话人"字段 | ⚠️ | 台词顺序改动后，姓名条与字幕可能错位一帧；重复词"团队"靠 occurrence 区分，改稿有挂错风险 |
| 双人音轨 | voice 多轨数组 | 现 `Audio{voice,bgm}` 单 voice 轨 `[代码] ir.go:136-146`；双人对白需前置混为一条 | ⛔ | IR 不能表达 A/B 两条独立音轨；各自的音量、静音、替换需在素材阶段完成 |
| 元素时间区间 | `startFrame/endFrame` | 整片存在；姓名条 / 字幕在 0 帧已在 DOM | ⚠️ | 非说话侧姓名条不能真正隐藏，只能靠颜色 / 压暗区分 |
| 字幕最短显示时长 | `render.subtitle.minCueSec` | 现 `BuildCues` 只限制单 cue ≤6s，无最短时长校验 `[代码] subtitle.go:16-20` | ⛔ | 极短问句可能被压成 <1s 的一闪而过；需在对齐阶段过滤或在 L0 单测补校验 |
| 扩展草案键（params 内）：crop、opacity | 目标 schema 未定义 | 现 builder 不消费该键，无现实现替代 | ⛔ 依赖 §5.16 提案 | 现渲染会忽略这些键，画面不出现对应效果 |
| 动画参数层级 | 目标 schema 将 from/to、easing 置于 params | 现 `ElementAnimation` 读顶层 from/to、fromValue/toValue、easing；案例 IR 已按顶层书写 | ✅ 以顶层为准 | params 内仅保留扩展键（axis、staggerFrames、reveal、path 等），不承载运动参数 |
| 双语双轨字幕 | render `subtitle.mode: burn+soft`（中文 burn + 英文 soft sidecar） | 现实现无双轨，仅单一硬字幕轨；英文以 SRT sidecar 交付 | ⛔ 现实现无双轨，需扩展 | 英文轨不参与画面渲染，需播放器或剪辑侧挂载；现降级为中文 burn 单轨 |
#### 4.4.5 预期帧表

> **[口径 round2]（依据 §7.0 时钟基准裁定 + delivery-audit-video-studio-round2 §2 + l1-c06-report.json）本表按词锚重算**：现实现动画锚定 `words[].start`（降级 IR `testdata/ir/c06.degraded.json`），帧号 = `ceil(词.start × 25)`。差异 >±30 帧的行加 ⚠️（M2 重新验收重点）。

| 帧号（原表） | 词锚推导 `[口径 round2]` | 时刻 | 期望画面状态 | 断言类型 |
|---|---|---|---|---|
| 0 | **0**（推导=0） | 0.00s | 双机位画面淡入；中线 x=960；A 姓名条亮（an_shotA/B_in、an_nameA_on 无锚点，从 t=0 起——与推导 0 一致） | 视觉 + DOM |
| 20 | **20**（无锚，行不变） | 0.80s | 两侧画面 scaleIn 结束；字幕 cue 1 中文可见。注意：cue 内容是 IR 手填静态 text（非 BuildCues 动态轮换，l1 实测整片 90s 字幕不再切换） | 视觉 |
| 225 | **230**（225→230，+5） | 9.20s | 切换 B：右侧姓名条亮；左侧压暗目标语义（降级不适用，C06-D4）；cue 2 就位。an_nameB_on 锚"窄场景"第 2 次@9.2s：9.2×25=229.999…→**230**。帧差探针实测 229→230 起 strip MAE 抬升、首个超阈值采样帧 onset=232（230±2 窗口 in-window，§7.0 校准锚点 2） | 视觉 |
| ⚠️ 450 | **464**（450→464，+14） | 18.55s | 切回 A；左侧姓名条亮；字幕含"重命名"。an_caption_move 与 ef_pulse_nameA 同锚"重命名"@18.55s：18.55×25=463.75→**464**（10 帧移动 →474 完成；pulse 464–476 全画布 1.06 缩放，非姓名条，见 §4.4.6 修正框）。原 450 为镜号边界，词锚下该帧无任何驱动 | DOM + 视觉 |
| 675 | **680**（675→680，+5；仅词表节拍） | 27.20s | B 提问帧；两侧亮度差与镜 2 方向一致（右亮左暗）。注意：镜 4 的姓名条切换**无锚点动画**（fade effect 已移除，C06-D5），"团队"@27.2s→680 只是词表节拍参考，画面保持镜 3 状态 | 视觉 |
| 900 | **906**（900→906，+6；仅词表节拍） | 36.20s | A 回答；字幕长句 ≤2 行，行首无标点（人工 + 文本断言）。"一周"@36.2s→906 是词表节拍参考（highlight"一周"未入降级 IR effects，无动画驱动） | DOM |
| 1350 | **1355**（1350→1355，+5；仅词表节拍） | 54.20s | A 回答；"自己加功能"关键词高亮色出现。"功能"@54.2s→1355 是词表节拍参考；降级 IR 无此 highlight effect（原 ef_hl_turn 锚"团队"@0.95s→F24），现实现高亮是整屏底色闪现（§4.4.6 修正框），本行帧差断言按全画布色抬升口径 | 视觉 |
| 1800 | **1805**（1800→1805，+5；仅词表节拍） | 72.20s | A 长句断两行；英文软字幕轨 cue 9 时间码与中文对齐。"数据"@72.2s→1805 是词表节拍参考。软字幕轨完全不渲染（C06-D2，round2 实测 soft 模式整体不存在） | IR + MP4 |
| ⚠️ 2025 | **2130**（2025→2130，+105） | 85.20s | 结论句片尾行出现；双姓名条保持。an_endline_in 锚"返工"@85.2s：85.2×25=2130→**2130**，20 帧落定 → F2150。原 2025 对应 S10 起点（81.2s"团队"→2030）附近，但 S10 无入选词表词、无可用锚——**按 §7.0 裁定收口为词锚 F2130**（定稿记录见下方 round1 标注的收口框，§7.0 校准锚点 3） | 视觉 |
| 2249 | **2249**（尾帧，行不变） | 89.96s | 画面保持；音频时长 ≥89.9s；SRT cue 数 = 11 | MP4 |

推导锚词全表（`frame = ceil(word.start × 25)`，词表见 §4.4.3 / `c06.degraded.json`）：很多人@0.0→0、两个人@0.45→12、团队@0.95→24、工具@1.25→32、窄场景@2.3→58、窄场景@9.2→230、文件@18.2→455、重命名@18.55→464、文件名@19.6→491、团队@27.2→680、规模@27.55→689、一周@36.2→906、清单@37.6→940、团队@45.2→1130、功能@54.2→1355、设置@55.6→1390、数据@72.2→1805、场景@73.6→1840、团队@81.2→2030、返工@85.2→2130。

> **[修正 2026-11-15 round1]（依据 example/internal/video/testdata/spec-audit-report.json M-C06-07，medium；round1 实测登记）上方帧表"帧 2025 / 81.00s 结论句 scaleIn 出现"与本文档自己的 words 表存在内部矛盾，二选一定稿（此处标注，不擅自定稿）**：§4.4.3 words 表中 S11 结论句台词"先把一件小事做到不返工"唯一入选词表的锚点词是"返工"（w19，85.2s→帧 2130）——若严格按词表锚定（an_endline_in 锚"返工"），结论句入场应在帧 2130，比帧表晚 105 帧（4.2s）；帧 2025 对应 S10"最后给同类团队一句话"起点附近，但该句无入选词表词、无可用锚。**L1 执行时按 L1 裁定采用词锚帧 2130**（与降级 IR `c06.degraded.json` 的 an_endline_in 锚一致）；要回到帧 2025 须改词表（把"先"或"一件"加入 words 表）而不是改帧表。
>
> **[口径 round2 定稿]（依据 §7.0 时钟基准裁定 + delivery-audit-video-studio-round2 §2；l1-c06 全帧渲染坐实）上框二选一按 §7.0 收口：词锚 F2130 胜出，歧义标注改为定稿记录**。算式：85.2s × 25fps = 2130.0 → ceil = **F2130**（an_endline_in 锚"返工"@85.2s，20 帧落定 → F2150）。L1 实测事实链：el_endline 在帧表原值 F2025 处未出现（锚未到），入场发生在 F2130，帧表与渲染的 105 帧偏差由此坐实。帧 2025 保留为 S10 节拍参考（"团队"@81.2s→2030 附近），但不再是结论句入场断言帧——结论句入场断言帧改为 **F2130**（M2 重新验收按推导列执行）。若未来要把入场提前到 S10 起点，正路是把锚词改挂"团队"@81.2s（词表已有，→F2030）或把"先"/"一件"加入词表，而不是把帧表写回 2025。

#### 4.4.6 断言
**关键视觉断言（可量化）**
- A-C06-01：帧 225（**[口径 round2] 帧号改按 §4.4.5 推导列 230 执行**——词锚"窄场景"@9.2s→F230），右半 `x 960–1920` 平均亮度 ≥ 左半 `x 0–960` 亮度 ×1.15；帧 450（同按推导列 464）方向相反。压暗侧遮罩透明度 20%。
- A-C06-02：字幕文本框 `y 950–1030` 内文字像素占比 10%–65%；中文字幕 ≤2 行、每行 ≤16 rune；行首字符不属于 `，。？！、；：`。
- A-C06-03：姓名条 bbox：A 在 `x 60–500, y 860–910`，B 在 `x 1020–1500, y 860–910`；两条不跨中线重叠。
- A-C06-04：中线 divider `x 958–962` 整列颜色 `#2A313B`，无画面像素穿透。

> **[修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 X-4 / example/internal/video/testdata/spec-audit-report.json X-4）本节两条按目标 schema 元素级语义写的 effect 断言，在现实现下全画布生效，按原断言会误判**：
> - `ef_pulse_nameA`（脉冲 A 姓名条，scale 1.06）：pulse 无元素目标（timeline-builder.js:182 非 counter 一律 `#canvas`），实际**整个画布缩放 1.06 倍**——A-C06-03 的姓名条 bbox 断言在该锚帧将因全画布放大而整体偏移；降级 IR（testdata/ir/c06.degraded.json）已移除该 effect。
> - `ef_fade_turn`（压暗 B 侧至 opacity 0.8）：fade 同样作用于 `#canvas` 整层，实际是**全画面压到 0.8 透明度且不复原**（牺牲全画面），而非"B 侧遮罩 20% 压暗"——A-C06-01 的"右/左亮度 ≥1.15"方向性断言在降级渲染下不可判定；降级 IR 已移除该 effect，改靠姓名条颜色区分说话人（C06-D4）。保留 `ef_hl_turn` 的现实现表现是整屏 `#2E86DE` 底色闪现（同 §4.2.6 修正框的 highlight 口径），非字幕词变色。

**自动化断言（分层）**
- IR 层：`words=20` 单调不重叠；`elements=8`、`animations=6`、`effects=3`；软字幕 asset kind=subtitle；render.subtitle.minCueSec=1.2；11 条 cue 时间码单调递增。
- DOM 层：两条画面 image + 两条字幕 text + 两条姓名 text 节点存在；中文文本与 script 对应句一致；英文 cue 数与中文一致。
- 帧层：L1 golden 帧 20 / 225 / 450 / 1350 / 2025 SSIM ≥0.95；说话人切换帧 224→225 姓名条颜色发生变化（帧差在姓名条区域 >0.1）。
- MP4 层：时长 90.0s ±0.1s；1920×1080；25fps；硬字幕烧录帧内可 OCR 出中文；软字幕 SRT sidecar 随产物交付；音频流存在。
**人工验收点**
1. 每条 cue 的说话人与亮灯侧一致，无 A 说话却显示 B 姓名条。
2. 中文断行不切在词中间，行首无标点；英文翻译语义与中文一致，无漏句。
3. 短问句（S2/S4/S6/S8/S10）字幕显示时长 ≥1.2s，不一闪而过。
4. 非说话侧压暗程度不影响看清人物；姓名条颜色与说话人强调色一致。
5. 片尾结论句与 S11 台词逐字一致。
**失败注入**
- F-C06-01：注入无 libass 环境。期望：`BurnSubtitles` 返回 `ErrNoLibass`，管线降级为软字幕轨交付，不报错崩溃 `[代码] encode.go:188-238`。
- F-C06-02：注入一条 <1.2s 的极短 cue。期望：目标 schema L0 校验拒绝或告警（`E_VIDEO_INVALID_PARAMS`）；现状代码无最短时长校验，断言需标注该缺口。
- F-C06-03：锚定词"团队"出现三次，注入时 occurrence 缺失。期望：目标 schema 返回 `E_VIDEO_ANCHOR_AMBIGUOUS`；现状取首个匹配，可能挂错说话人侧。
- F-C06-04：SRT assetKey 非 `video/` 前缀。期望：IR 校验拒绝（`[代码] ir.go:355-365`），返回 `E_VIDEO_INVALID_IR`。

> **[修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 M-C06-01 / example/internal/video/testdata/spec-audit-report.json M-C06-01）上方 F-C06-01 的期望行为描述过时，原文划线保留如下**：
>
> ~~F-C06-01：注入无 libass 环境。期望：`BurnSubtitles` 返回 `ErrNoLibass`，管线降级为软字幕轨交付，不报错崩溃 `[代码] encode.go:188-238`。~~
>
> 按 §8.2 两列口径修正后的期望：
>
> | 口径 | 判定 | 依据 |
> |---|---|---|
> | 结构可表达性（capx 层） | ✅（能力在位） | `BurnSubtitles` 无 libass 时返回 `ErrNoLibass`（encode.go:193，现 :211-240 行号区间），调用方**可以**据此自行选择降级——单测 `TestBurnSubtitles_NoLibassDegrades` 证明哨兵在位 |
> | 视觉达标性（管线层自动降级） | ⛔（不存在） | `example/internal/video/render/render_pipeline.go:220-223`：burn 分支把 `BurnSubtitles` 的错误（含 `ErrNoLibass`）**原样上抛为渲染失败**——"管线自动降级为软字幕轨交付、不报错崩溃"的选择逻辑在管线层不存在；soft 模式也只落盘 SRT sidecar，mov_text 封装未实现（render_pipeline.go:212 注释自承 follow-up） |
>
> 修正后 F-C06-01 应表述为：注入无 libass 环境，期望**渲染失败**（错误信息含 `ErrNoLibass`），而非"降级软字幕交付"；§4.4.2 字幕策略第一行"无 libass 返回 ErrNoLibass 降级为软字幕轨"同受此修正约束（现读法应为"仅返回 ErrNoLibass，降级由调用方负责，管线未做"）。

#### 4.4.7 当前可实现性小结
**结论**：分屏构图、DOM 层级、姓名条与字幕同框可落地；**双音轨、真正交叉淡化转场、软字幕轨时间轴渲染、字幕最短时长校验、行首标点 / 词中断行校验** 是阻塞项。访谈类"说话人—字幕同步"在改稿后最易错位，需靠锚点 occurrence 与帧级断言兜底。
---

### 4.5 VS-C09「产品功能演示」：文件管理器批量重命名流程

#### 4.5.1 案例头

| 字段 | 内容 |
|---|---|
| 案例 ID | VS-C09 |
| 名称 | 批量重命名四步流程演示（选文件 → 菜单 → 面板 → 确认） |
| 内容类型 | 产品功能演示 / 操作录屏图解 |
| 目标受众 | 工具产品用户、新手上手；横屏观看，依赖步骤编号与光标路径理解操作 |
| 发布渠道 | 官网帮助中心 / 视频教程 / 产品内嵌；1920×1080，UI 文字需可读 |
| 画幅 / 分辨率 | 1920×1080（16:9 横屏） |
| fps | 30 |
| 时长 | 50.0s（目标帧数 ceil(50×30)=1500；现实现 round=1500） |
| 语言 | 普通话旁白 + 中文硬字幕 |
| 优先级 | P1 |
| 依赖案例 | 无 |

#### 4.5.2 创作规格
**一句话主张**：用四步编号、光标路径和局部放大，把"批量重命名"从框选到确认的操作链路讲清楚。
**演示流程（与脚本逐句对应；UI 为通用文件管理器示意，不绑定具体厂商界面）**
1. 框选 12 个照片文件，状态栏显示选中数量。
2. 右键打开上下文菜单，选择"批量重命名"。
3. 重命名面板输入前缀"旅行-2026"，规则：前缀 + 原序号；预览区逐条显示新文件名。
4. 点击"重命名"确认，状态栏提示 12 项完成；文件未被移动，目录结构不变。
**完整逐句脚本（S1..S6，可直接配音）**
- S1 这段演示展示文件管理器里的批量重命名流程，共四步。
- S2 第一步，在文件列表框选需要重命名的照片，状态栏显示已选中十二个文件。
- S3 第二步，右键打开上下文菜单，选择批量重命名。
- S4 第三步，在面板里输入新前缀"旅行-2026"，规则为前缀加原序号，预览区逐条显示新文件名。
- S5 第四步，确认预览无误后点击重命名，状态栏提示十二项已完成。
- S6 流程结束：文件未被移动，目录结构保持不变。
**分镜表**（30fps；横屏 1920×1080）

| 镜号 | 帧范围 | 画面 | 图层 / 元素 | 动效与锚点词 | 字幕 / 音频 |
|---|---|---|---|---|---|
| 1 | 0–119 (0.0–4.0s) | 标题 + 左侧四步编号列；UI 背景图淡入 | tr_main: el_ui；tr_overlay: el_title, el_steps | el_steps 四个编号 badge T-09 错峰入场（间隔 12 帧）；锚点"四步" | S1；BGM 淡入 |
| 2 | 120–359 (4.0–12.0s) | 步骤 1：光标沿路径移动到文件列表，框选 12 项；局部放大取景框罩住列表区 | tr_main: el_ui；tr_mask: el_zoom；tr_overlay: el_cursor | T-08 光标沿 move 路径自左上到列表；T-03 取景框 scaleIn 罩住 `x 300–1500, y 240–720`；锚点"框选" | S2；选中音效 |
| 3 | 360–599 (12.0–20.0s) | 步骤 2：右键菜单弹出；"批量重命名"菜单项高亮 | tr_overlay: el_menu, el_cursor | 菜单 scaleIn；T-12 操作名"批量重命名"逐词高亮；光标移到菜单项 | S3；菜单音效 |
| 4 | 600–959 (20.0–32.0s) | 步骤 3：重命名面板；前缀输入框 + 预览列表逐条出现 | tr_overlay: el_panel, el_cursor | 预览条目 T-09 错峰入场；highlight"前缀""原序号"；取景框切到面板区 | S4 |
| 5 | 960–1259 (32.0–42.0s) | 步骤 4：确认按钮；counter 状态栏 0→12 项完成 | tr_overlay: el_status, el_cursor | 光标 move 到确认按钮；pulse 按钮；counter 滚动完成数 | S5；完成音效 |
| 6 | 1260–1499 (42.0–50.0s) | 结果校验：目录树保持不变；片尾说明行 | tr_main: el_ui；tr_overlay: el_status | el_status scaleIn；无新 UI 截图 | S6；BGM 淡出 |

**版式**
- UI 截图居中 `x 240–1680, y 160–900`；左侧步骤编号列 `x 60–220`；取景框描边 3px；状态栏 `y 820–870`；字幕 `y 950–1020`。
- 字号：标题 48px/700；步骤编号 32px/600；UI 标注 26px/400；字幕 36px/500。UI 截图内文字不重排，保证与真实界面一致。
**色彩**：背景 `#1B2129`；UI 截图区 `#F2F5F9`；强调蓝 `#2E86DE`（光标 / 取景框 / 确认按钮）；高亮黄 `#FFD54A`（菜单项 / 关键词）；完成绿 `#3FA66A`。对比度：白字对深底 ≥12:1 `[待验证]`。
**字体**：UI 标注与中文用思源黑体；界面内等宽文件名用 JetBrains Mono。缺字风险：连字符 `-`、数字、中文前缀均覆盖；`[待验证]` 用 `document.fonts.check` 复核。
**素材清单**

| id | 用途 | 规格 | 生成 / 来源 | 许可 |
|---|---|---|---|---|
| as_ui_list | 文件列表 + 目录树截图 | 1440×740 PNG | 通用管理器示意截图（自绘） | 自有 |
| as_ui_menu | 右键菜单浮层 | 360×280 PNG | 自绘 | 自有 |
| as_ui_panel | 重命名面板 + 预览 | 640×520 PNG | 自绘 | 自有 |
| as_bgm_guide | 教程垫乐 | m4a，约 51s，BPM 92 | 授权曲库 | 曲库商用授权 |

**音频策略**：voice zh-CN 男声 rate 1.0；BPM 92，BGM 音量 0.14；选中 / 菜单 / 完成音效为短促提示音（在 IR effects 层以 pulse / counter 时间点对齐）。现实现 mux 无多音效轨，提示音需前置混入 voice 轨 `[代码] encode.go:147-185`。
**字幕策略**：中文硬字幕；操作名在字幕与菜单高亮中一致（"批量重命名"）；行长 ≤16 rune、≤2 行、≤6s。不做双语。

#### 4.5.3 IR 规格（目标 schema）

```json
{
  "schemaVersion": 1,
  "meta": {"width": 1920, "height": 1080, "fps": 30, "durationSec": 50.0, "background": "#1B2129"},
  "voice": {"provider": "http", "voice": "zh-CN-male-02", "rate": 1.0, "audioKey": null},
  "script": "S1 这段演示展示文件管理器里的批量重命名流程，共四步。S2 第一步，在文件列表框选需要重命名的照片，状态栏显示已选中十二个文件。S3 第二步，右键打开上下文菜单，选择批量重命名。S4 第三步，在面板里输入新前缀旅行-2026，规则为前缀加原序号，预览区逐条显示新文件名。S5 第四步，确认预览无误后点击重命名，状态栏提示十二项已完成。S6 流程结束：文件未被移动，目录结构保持不变。",
  "words": [
    {"id": "w01", "index": 0, "start": 0.0, "end": 0.5, "text": "演示", "source": "aligner", "confidence": 0.97, "scriptStart": 2, "scriptEnd": 4}, {"id": "w02", "index": 1, "start": 0.95, "end": 1.35, "text": "批量", "source": "aligner", "confidence": 0.96, "scriptStart": 11, "scriptEnd": 13}, {"id": "w03", "index": 2, "start": 1.35, "end": 1.75, "text": "重命名", "source": "aligner", "confidence": 0.97, "scriptStart": 13, "scriptEnd": 16}, {"id": "w04", "index": 3, "start": 1.75, "end": 2.1, "text": "流程", "source": "aligner", "confidence": 0.95, "scriptStart": 16, "scriptEnd": 18},
    {"id": "w05", "index": 4, "start": 4.2, "end": 4.55, "text": "第一步", "source": "aligner", "confidence": 0.96, "scriptStart": 25, "scriptEnd": 28}, {"id": "w06", "index": 5, "start": 4.95, "end": 5.3, "text": "框选", "source": "aligner", "confidence": 0.95, "scriptStart": 33, "scriptEnd": 35}, {"id": "w07", "index": 6, "start": 5.75, "end": 6.1, "text": "重命名", "source": "aligner", "confidence": 0.97, "scriptStart": 39, "scriptEnd": 42}, {"id": "w08", "index": 7, "start": 6.8, "end": 7.2, "text": "状态栏", "source": "aligner", "confidence": 0.94, "scriptStart": 48, "scriptEnd": 51},
    {"id": "w09", "index": 8, "start": 12.2, "end": 12.55, "text": "第二步", "source": "aligner", "confidence": 0.96, "scriptStart": 62, "scriptEnd": 65}, {"id": "w10", "index": 9, "start": 13.4, "end": 13.75, "text": "批量", "source": "aligner", "confidence": 0.96, "scriptStart": 73, "scriptEnd": 75}, {"id": "w11", "index": 10, "start": 13.75, "end": 14.15, "text": "重命名", "source": "aligner", "confidence": 0.97, "scriptStart": 75, "scriptEnd": 78}, {"id": "w12", "index": 11, "start": 20.2, "end": 20.55, "text": "第三步", "source": "aligner", "confidence": 0.96, "scriptStart": 89, "scriptEnd": 92},
    {"id": "w13", "index": 12, "start": 21.1, "end": 21.5, "text": "前缀", "source": "aligner", "confidence": 0.95, "scriptStart": 98, "scriptEnd": 100}, {"id": "w14", "index": 13, "start": 22.3, "end": 22.7, "text": "原序号", "source": "aligner", "confidence": 0.93, "scriptStart": 108, "scriptEnd": 111}, {"id": "w15", "index": 14, "start": 23.2, "end": 23.55, "text": "预览", "source": "aligner", "confidence": 0.95, "scriptStart": 114, "scriptEnd": 116}, {"id": "w16", "index": 15, "start": 32.2, "end": 32.55, "text": "第四步", "source": "aligner", "confidence": 0.96, "scriptStart": 128, "scriptEnd": 131},
    {"id": "w17", "index": 16, "start": 33.4, "end": 33.8, "text": "重命名", "source": "aligner", "confidence": 0.97, "scriptStart": 141, "scriptEnd": 144}, {"id": "w18", "index": 17, "start": 34.3, "end": 34.7, "text": "状态栏", "source": "aligner", "confidence": 0.94, "scriptStart": 148, "scriptEnd": 151}, {"id": "w19", "index": 18, "start": 35.2, "end": 35.6, "text": "完成", "source": "aligner", "confidence": 0.95, "scriptStart": 156, "scriptEnd": 158}, {"id": "w20", "index": 19, "start": 42.3, "end": 42.8, "text": "目录", "source": "aligner", "confidence": 0.94, "scriptStart": 168, "scriptEnd": 170}
  ],
  "tracks": [
    {"id": "tr_main", "kind": "main", "z": 0}, {"id": "tr_mask", "kind": "overlay", "z": 5}, {"id": "tr_overlay", "kind": "overlay", "z": 10}, {"id": "tr_caption", "kind": "subtitle", "z": 20}, {"id": "tr_bgm", "kind": "bgm", "z": -1, "volume": 0.14, "assetKey": "video/vs-c09/as_bgm_guide.m4a"}
  ],
  "elements": [
    {"id": "el_ui", "type": "image", "trackId": "tr_main", "startFrame": 0, "endFrame": 1499, "params": {"x": 240, "y": 160, "w": 1440, "h": 740, "crop": "center"}, "src": "video/vs-c09/as_ui_list.png"}, {"id": "el_title", "type": "text", "trackId": "tr_overlay", "startFrame": 0, "endFrame": 119, "params": {"text": "批量重命名 · 四步流程", "x": 960, "y": 70, "fontSize": 48, "weight": 700, "color": "#FFFFFF", "align": "center"}}, {"id": "el_steps", "type": "shape", "trackId": "tr_overlay", "startFrame": 0, "endFrame": 1259, "params": {"x": 60, "y": 240, "w": 100, "h": 580, "shape": "badgeColumn", "badges": ["1", "2", "3", "4"], "color": "#2E86DE"}}, {"id": "el_zoom", "type": "shape", "trackId": "tr_mask", "startFrame": 120, "endFrame": 959, "params": {"x": 300, "y": 240, "w": 1200, "h": 480, "shape": "frame", "stroke": "#2E86DE", "strokeW": 3, "zoom": 1.25}}, {"id": "el_cursor", "type": "shape", "trackId": "tr_overlay", "startFrame": 120, "endFrame": 1259, "params": {"x": 300, "y": 200, "w": 36, "h": 36, "shape": "cursor", "color": "#FFFFFF"}},
    {"id": "el_menu", "type": "image", "trackId": "tr_overlay", "startFrame": 360, "endFrame": 599, "params": {"x": 700, "y": 300, "w": 360, "h": 280}, "src": "video/vs-c09/as_ui_menu.png"}, {"id": "el_panel", "type": "image", "trackId": "tr_overlay", "startFrame": 600, "endFrame": 1259, "params": {"x": 700, "y": 240, "w": 640, "h": 520}, "src": "video/vs-c09/as_ui_panel.png"}, {"id": "el_status", "type": "text", "trackId": "tr_overlay", "startFrame": 960, "endFrame": 1259, "params": {"text": "0 项已完成", "x": 1500, "y": 830, "fontSize": 28, "weight": 500, "color": "#3FA66A", "align": "right"}}, {"id": "el_caption", "type": "text", "trackId": "tr_caption", "startFrame": 0, "endFrame": 1499, "params": {"text": "", "x": 960, "y": 960, "fontSize": 36, "weight": 500, "color": "#FFFFFF", "align": "center", "maxLines": 2, "maxLineRunes": 16}}
  ],
  "animations": [
    {"id": "an_badges_in", "targetElementId": "el_steps", "type": "scaleIn", "startFrame": 0, "durationFrames": 18, "easing": "power2.out", "params": {"staggerFrames": 400}}, {"id": "an_cursor_1", "targetElementId": "el_cursor", "type": "move", "startFrame": 120, "durationFrames": 90, "easing": "power1.out", "from": {"x": 300, "y": 200}, "to": {"x": 520, "y": 420}, "params": {"path": "polyline"}}, {"id": "an_zoom_in", "targetElementId": "el_zoom", "type": "scaleIn", "startFrame": 120, "durationFrames": 18, "easing": "power2.out", "params": {}}, {"id": "an_menu_in", "targetElementId": "el_menu", "type": "scaleIn", "startFrame": 360, "durationFrames": 16, "easing": "power2.out", "params": {}}, {"id": "an_cursor_2", "targetElementId": "el_cursor", "type": "move", "startFrame": 960, "durationFrames": 60, "easing": "power1.out", "from": {"x": 1080, "y": 560}, "to": {"x": 1180, "y": 660}, "params": {"path": "polyline"}},
    {"id": "an_panel_in", "targetElementId": "el_panel", "type": "scaleIn", "startFrame": 600, "durationFrames": 20, "easing": "power2.out", "params": {}}, {"id": "an_endline_in", "targetElementId": "el_status", "type": "scaleIn", "startFrame": 1260, "durationFrames": 18, "easing": "power2.out", "params": {}}
  ],
  "effects": [
    {"id": "ef_hl_op", "type": "highlight", "targetElementId": "el_menu", "anchor": {"wordId": "w10", "lastText": "重命名", "lastIndex": 9, "resolvedFrom": "crossWord", "status": "resolved"}, "params": {"color": "#FFD54A"}}, {"id": "ef_pulse_btn", "type": "pulse", "targetElementId": "el_panel", "anchor": {"wordId": "w17", "lastText": "重命名", "lastIndex": 16, "occurrence": 2, "resolvedFrom": "exact", "status": "resolved"}, "params": {"scale": 1.05}}, {"id": "ef_cnt_done", "type": "counter", "targetElementId": "el_status", "anchor": {"wordId": "w19", "lastText": "完成", "lastIndex": 18, "resolvedFrom": "exact", "status": "resolved"}, "params": {"from": 0, "to": 12, "suffix": " 项已完成"}}
  ],
  "assets": [
    {"key": "video/vs-c09/as_ui_list.png", "kind": "image", "bytes": 980000, "license": "自有自绘"}, {"key": "video/vs-c09/as_ui_menu.png", "kind": "image", "bytes": 260000, "license": "自有自绘"}, {"key": "video/vs-c09/as_ui_panel.png", "kind": "image", "bytes": 520000, "license": "自有自绘"}, {"key": "video/vs-c09/as_bgm_guide.m4a", "kind": "audio", "bytes": 2380000, "license": "曲库商用授权"}
  ],
  "render": {"width": 1920, "height": 1080, "fps": 30, "crf": 18, "preset": "medium", "pixFmt": "yuv420p", "audio": {"bitrate": "128k", "loudness": "-16LUFS"}, "subtitle": {"mode": "burn", "fontSizePx": 36, "maxLineRunes": 16}, "thumbnail": {"atSec": 24.0}}
}
```

#### 4.5.4 现状降级映射


| 能力点 | 目标字段 | 现实现替代方案 | 标记 | 可见差异 |
|---|---|---|---|---|
| T-03 遮罩裁剪（局部放大取景框） | shape `frame` + `zoom:1.25`，框内放大 | 现无 mask / clip-path 节点；取景框用描边 shape 覆盖近似；"框内 1.25× 放大"无图像缩放区域概念，只能前置截好放大图作为 image 素材 | ⚠️ | 目标：框内 UI 局部放大；现状：取景框只画框不放大局部；放大后的像素清晰度需在素材阶段保证 |
| T-08 路径运动（光标移动） | animation `path:"polyline"` + 多点轨迹 | 现 move 为直线双端点插值，无多点折线 / 曲线路径；多段路径需拆成多条 move 动画顺序拼接 | ⚠️ | 光标转角在单条 move 内被拉直；两段 move 之间若 startFrame 衔接不当会出现停顿或跳点 |
| T-09 步骤错峰入场 | badge `staggerFrames`、各 badge 错峰 startFrame | 现错峰靠逐条写 startFrame + scaleIn from 0；无组内 stagger 容器 | ✅ | 帧级错峰可落地；badge 在 0 帧已存在于 DOM，只是缩放为 0.01 |
| T-12 操作名逐词强调 | effect 指向菜单项文本元素，逐词变色 | 现 highlight 作用于 `#canvas` 整层，不是某个元素 / 某个词 `[代码] timeline-builder.js:190`；词级强调需词文本层 | ⛔ | 目标：仅"批量重命名"菜单项变黄；现状：整屏底色闪现一次。字段提案：effect 增 `targetWordIds` + 词 span 渲染 |
| 局部放大图素材绑定 | image src + zoom 参数 | 现 image 只加载整图到元素框；放大倍率不进 IR | ⚠️ | 改截图后放大区域需重新自绘素材；IR 不记录"原截图 → 放大区域"映射 |
| 元素时间区间 | `startFrame/endFrame` | 整片存在；菜单 / 面板截图在未到步骤时已在 DOM，靠 z 顺序与遮挡隐藏 | ⚠️ | 菜单浮层若遮挡关系错误，会在步骤 1 提前透出边角 |
| counter 定位到状态栏 | counter targetElementId=el_status | counter 自建 div 无 x/y/w/h，固定左上原点 `[代码] timeline-builder.js:232-241` | ⛔ | 目标：完成数出现在右下状态栏；现状：滚动数字堆在画布左上角，状态栏文本需静态 text 兜底 |
| 操作音效对齐 | effect 时间点 + 音效轨 | 现无独立音效轨；提示音需前置混入 voice `[代码] encode.go:147-185` | ⚠️ | 音效与光标 / 按钮的帧级对齐在素材预混阶段完成，IR 内不可调 |
| 扩展草案键（params 内）：badges、crop、path、shape（badgeColumn、cursor、frame）、staggerFrames、stroke、zoom | 目标 schema 未定义 | 现 builder 不消费该键，无现实现替代 | ⛔ 依赖 §5.16 提案 | 现渲染会忽略这些键，画面不出现对应效果 |
| 动画参数层级 | 目标 schema 将 from/to、easing 置于 params | 现 `ElementAnimation` 读顶层 from/to、fromValue/toValue、easing；案例 IR 已按顶层书写 | ✅ 以顶层为准 | params 内仅保留扩展键（axis、staggerFrames、reveal、path 等），不承载运动参数 |
#### 4.5.5 预期帧表

| 帧号 | 时刻 | 期望画面状态 | 断言类型 |
|---|---|---|---|
| 0 | 0.00s | 标题 + 四步编号列；UI 背景淡入 | 视觉 + DOM |
| 36 | 1.20s | 四个 badge 错峰入场完成；编号 1–4 均可见 | 视觉 |
| 120 | 4.00s | 取景框出现；光标从左上向文件列表移动 | 视觉 |
| 240 | 8.00s | 框选完成；列表区高亮 12 项；状态栏选中数可见 | 视觉 + DOM |
| 360 | 12.00s | 右键菜单弹出；"批量重命名"项处于高亮色 | 视觉 |
| 600 | 20.00s | 重命名面板出现；前缀输入框含"旅行-2026"；预览列表 ≥4 条 | DOM + 视觉 |
| 800 | 26.67s | 预览条目错峰入场完成；规则文字"前缀 + 原序号"可见 | 视觉 |
| 960 | 32.00s | 步骤 4；光标移向确认按钮；状态栏 counter 开始滚动 | 视觉 |
| 1140 | 38.00s | counter 到达 12；状态栏"12 项已完成"绿色 | 视觉 |
| 1260 | 42.00s | 目录树保持不变；片尾说明行出现；无文件被移动的图示 | 视觉 + DOM |
| 1499 | 49.97s | 画面保持；音频时长 ≥49.9s | MP4 |

#### 4.5.6 断言
**关键视觉断言（可量化）**
- A-C09-01：帧 120–959，取景框描边在 `x 300–1500, y 240–720` 边界，蓝色通道主导（B≥150，R≤120）；框外 UI 区不被描边覆盖。
- A-C09-02：帧 360–599，菜单项高亮行 `y 360–410` 背景为黄 `#FFD54A`（容差 ΔE≤10）；其余菜单项背景为浅灰。
- A-C09-03：帧 1140，状态栏文本"12 项已完成"绿色（G≥140, R≤120, B≤120）；counter 帧序列 24 帧内单调递增，不倒退、不跳变。
- A-C09-04：四个 badge bbox 均在左侧列 `x 60–160`，y 分别 ≈240 / 380 / 520 / 660，垂直间距 140px ±10；badge 之间无重叠。
**自动化断言（分层）**
- IR 层：`words=20` 单调不重叠；`elements=9`、`animations=7`、`effects=3`；三张 UI 截图 assetKey 以 `video/` 前缀；counter to=12 与脚本"十二项"一致。
- DOM 层：菜单、面板、状态栏节点存在；badge 编号文本 1–4；面板预览条目数 ≥4；前缀文本"旅行-2026"可在面板文本中检出。
- 帧层：L1 golden 帧 36 / 240 / 360 / 800 / 1140 SSIM ≥0.95；光标相邻帧位移连续（单帧 ≤60px，无跨屏跳点）。
- MP4 层：时长 50.0s ±0.1s；1920×1080；30fps；音频流存在；缩略图 atSec=24.0 可解码。
**人工验收点**
1. 四步顺序与旁白 S2→S5 一致，菜单 / 面板不提前出现。
2. 光标落点与被操作对象一致（框选落列表、菜单落"批量重命名"、确认落按钮）。
3. 预览文件名规则可读：前缀"旅行-2026" + 序号，与 S4 描述一致。
4. 片尾目录树与开头一致，无文件移动 / 重排的误导图示。
5. UI 截图内文字在 1080p 下可读（不依赖放大也能辨认按钮与菜单项）。
**失败注入**
- F-C09-01：注入菜单截图 asset 不可解码。期望：decode catch 吞错不阻断 ready `[代码] timeline-builder.js:158-160`；帧层菜单区域留背景色，人工验收记素材缺失。
- F-C09-02：counter to 值注入为 13（与脚本"十二项"不一致）。期望：帧断言检出状态栏数字与旁白 / 脚本不一致；目标 schema 应加"counter 值—脚本数字同源"校验。
- F-C09-03：锚定词"重命名"出现三次，注入时遗漏 occurrence。期望：目标 schema 返回 `E_VIDEO_ANCHOR_AMBIGUOUS`；现状取首个匹配，可能把高亮挂到步骤 1 而非步骤 3 菜单项。
- F-C09-04：取景框坐标越界（w 超出画布）。期望：L0 单测拒绝非法元素框（`E_VIDEO_INVALID_PARAMS`）；现状代码无元素框裁剪校验，需在断言中标注缺口。

#### 4.5.7 当前可实现性小结
**结论**：步骤编号错峰、直线光标移动、取景框描边与静态 UI 分层可落地；**框内局部放大、词级操作名高亮、counter 定位到状态栏、多段折线路径** 是阻塞项。演示类案例的关键风险是"菜单 / 面板提前透出"与"光标落点错位"，靠元素区间约束与帧级位置断言兜底。
---
**边界声明**：本节为文档产出，未修改任何业务代码、Go / JS / TSX / OpenAPI / SQL 文件；IR 均为目标 schema 输入规格，不代表当前 Player 已实现；帧级断言为待执行计划，未表述为已通过实测。外部数据来源见 §4.2.2 表内链接与 §4.1.2 科学事实链接。

## 5. 动画与渲染技术专题

> 本章逐项评审 Video Studio 渲染链（IR → 自包含 HTML + GSAP → Chrome 固定帧截图 → H.264）在 15 类典型视觉技术上的现状、降级路径、扩展提案与断言方法。
> 证据标记：`[实测]` 本轮命令实跑；`[代码]` 读源码（附 `文件:行号`）；`[外部]` 官方规范/文档（附 URL）；`[待验证]` 推断未取证（附验证方法）。
> 能力词汇沿用基线 §3：✅ 现 IR + 现 Player 直接可做；⚠️ 可做近似但存在已知误差；⛔ 现 IR 做不了，需扩展；🚫 v1 非目标。
> **判定口径（两列）**：每个技术项按两列判定——**结构可表达性**：不改代码、仅用现 IR 字段能否把该效果的结构（元素、动画、锚点、素材）表达出来；**视觉达标性**：上述降级近似能否通过量化验收断言（区域、阈值、帧差、DOM 判据）。架构文档 §1.8 能力矩阵与本节判定统一按这两列阅读；单列档位在本文档内不再使用。
> 代码基线时点：2026-11-15 13:15（`git status` clean）；本轮期间仓库有并发提交，行号与行为以该时点源码为准。
> 所有"提案（未实现）"字段在当前 `ir.go` 白名单中不存在，写入现 IR 会被校验拒绝或在读时被静默丢弃。

### 5.1 T-01 CJK 文本排版（字距 / 对齐 / 行高 / 避头尾 / 缺字）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ 纯静态文本可上屏，文本结构（内容/字号/颜色/坐标）可表达；排版控制字段基本缺失 | ⚠️ 手工定位与文案层断行可近似，但居中、字距、行距、避头尾无法通过受控排版断言 |

- 证据 `[代码]`：`Element` 仅 `text/color/fontSize/x/y/w/h/z`，无 `align/letterSpacing/lineHeight/weight` 字段（`example/internal/video/app/ir.go:116-130`）；模板 CSS `.el-text` 固定 `line-height: 1.35`，无 `text-align`、无 `letter-spacing`、无 `word-break/line-break`（`example/internal/video/app/projector.go:297-300`）；`elementMap` 透传的文本字段只有 text/color/fontSize（`projector.go:234-242`）。
- 结论：左对齐、单行文本可做；居中对齐、字距、行距调整、避头尾（行首不出现句号逗号等）在现 IR 上做不了受控设定。

**2) 现 IR 降级配方**
- 居中标题：用 `x = (canvasW − 估算文本宽) / 2` 手工定位。估算宽：`fontSize` × CJK 字符数（CJK 全宽 ≈ 1em），英文/数字按 0.5em 计；例：1080 宽画布、`fontSize=64`、8 个 CJK 字，文本宽 ≈ 512px，`x = (1080−512)/2 = 284`。误差来源：实测字宽与 1em 近似偏差 ±3–6%（受字体字腔影响）；无 `text-align` 时多行文本每行左对齐，无法居中。
- 行距：多行文本靠 `\n` 分行（CSS `white-space: pre-wrap`，`projector.go:299`），行高锁 1.35，不能调；两行以上字幕须把行高换算进 `h`（`h ≈ 2 × fontSize × 1.35`）。
- 避头尾：现 CSS 默认行断行允许任意 CJK 字符出现在行首/行尾 `[外部] https://www.w3.org/TR/css-text-3/#line-breaking`；日语/中文禁则（kinsoku）见 `[外部] https://www.w3.org/TR/jlreq/`。降级：在脚本撰写阶段人工把标点留在行内（分词时把标点并入前一词），把禁则问题前移到文案层。
- 文本框宽与换行：`w` 赋值时 `width: wpx` 触发 `pre-wrap` 换行；`w` 留 0 时不写宽度（`timeline-builder.js:64`），文本按内容单行延伸、超出 `#stage` 被整体裁剪（`projector.go:286-293`）。长文案必须显式给 `w`，并把文案按 ≤ `floor(w / fontSize)` 个 CJK 字符手工断行。
- 缺字检测（现 IR 无字段，只能在 DOM 测试层做）：`document.fonts.check("64px 'Noto Sans SC'", "字")` 逐字检测 `[外部] https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check`；返回 `false` 的字符记入缺字清单。注意 `check` 只查字体是否在已加载集合内，不保证字形非 `.notdef`，后者需 L4 像素断言（见下）。

**3) 目标实现所需扩展（提案，未实现）**
- `Element` 增加：`align: left|center|right`、`verticalAlign: top|middle|bottom`、`letterSpacing`(px)、`lineHeight`(倍数或 px)、`fontWeight`、`maxWidth`、`lineBreak: normal|strict-cjk`（开启避头尾）。
- 元素增加 `fonts[]` 引用（配合 `assets[]` 子集字体登记），并在 ready 阶段做缺字 fail-closed；图片资源的 decode fail-closed 已实现（见 T-02），缺字校验是尚缺的同源缺口。

**4) 视觉断言方法**
- **L1 单帧 golden**：取标题所在区域，例 `x∈[284,796], y∈[300,380]`，与 golden PNG 做像素差，均值误差 ≤ 2/255，标题前景像素占比与 golden 偏差 ≤ 3%。
- **L2 短片段**：对 2s 内标题文本元素逐帧重截，断言区域内前景像素数逐帧差 ≤ 2%（静态文本不应闪烁）；若有 `scaleIn`，只允许缩放导致的面积变化。
- **L4 浏览器逐像素/DOM**：
  - 字宽断言：离屏 canvas `ctx.font = "64px 'Noto Sans SC'"; ctx.measureText(text).width`，与 IR 布局反算值偏差 ≤ 2px；`TextMetrics.actualBoundingBoxLeft/Right/Top/Bottom` 与元素 `w/h` 比对 `[外部] https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics`、`https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText`。
  - 缺字断言：`document.fonts.check(...)` 全字通过；再对每个字形截 32×32 区域，若该区域像素方差低于阈值（`.notdef` 通常为空框/横线）判缺字。
  - 对齐断言：`el.getBoundingClientRect()` 左/右边界与 `x`、`x+w` 偏差 ≤ 1px；居中断言文本盒水平中心 = `canvasW/2`，偏差 ≤ 1px。

### 5.2 T-02 多图层与层级与素材适配

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ✅ 静态图层次：`z` 字段与图片元素结构在位；图片 decode fail-closed 已实现 | ⚠️ 轨道级整组重排（统一移动/显隐/转场）不可达；contain 留白为近似；服务端素材预检缺失（见 §5.16 P0-5） |

- 层级证据 `[代码]`：`Element.z` 字段存在（`ir.go:127`）；builder 写 `zIndex = String(1 + (el.z || 0))`（`timeline-builder.js:66`）；DOM 按 `elements` 数组顺序 append（`timeline-builder.js:144-170`），同 z 时顺序即文档序；无 `trackId`、无轨道层（基线 §2.3，`ir.go:116-130`）。
- 素材证据 `[代码]`：图片元素 `<img>`，CSS `width:100%;height:100%;object-fit: contain`（`projector.go:296`）；`src` 必须是 `video/...` storage key，拒绝绝对 URL 与 data URI（`ir.go:365-371`）；图片 `decode()` 失败时 catch 记录根因到 `__player.error` 并**重新抛出**（`timeline-builder.js:148-160`），`Promise.all(decodePromises)` 拒绝 → `ready` 保持 false（`:211`）；`awaitReady` 轮询读到非空 `__player.error` 即带根因中止渲染（`platform/capx/renderer.go:234-239`）。
- 结论：背景 / 主体 / 字幕的前后遮挡用 `z` 数值可控制；图片等比留白可做；坏图在 Player 侧已 fail-closed；填满裁切（cover）、轨道级整组显隐/位移、服务端素材预检（magic bytes / 像素总量上限 / 解码校验）做不了受控配置。

**2) 现 IR 降级配方**
- 层级构图约定：背景 `z=0`，主体 `z=10`，强调文字 `z=20`，字幕 `z=30`；数值在元素间显式错开，避免同 z 依赖 append 顺序（脚本重排数组顺序会改变遮挡）。误差：同 z 叠放遮挡关系由 DOM 顺序决定，IR 校验不检查同 z 冲突（`ir.go:221-298,352-414` 未含 z 唯一性规则）；动画期间元素用 transform 移动，transform 不改变 zIndex，叠放关系全程固定。
- 图片 contain 留白：CSS 统一 `object-fit: contain`；cover 近似在现 CSS 下不成立（contain 模式放大盒子不会填满图片），只能改为图片按 contain 显示、两侧留白用纯色 `shape` 元素补背景。误差：留白区是纯色，与原图景深/纹理不一致；渐变背景无法用 shape 复现。
- 坏图（fail-closed，已实现）：断链/解码失败的图片使对应 decode promise 拒绝；根因写入 `__player.error`，`ready` 不翻转，渲染在 `awaitReady` 阶段带根因中止（`timeline-builder.js:148-160,211`；`renderer.go:234-239`）；网络锁定下破图图标本身不出现（`renderer.go:155-166`）。案例不得承诺"图片缺失仍出片"；素材在上传/编排阶段的预检（格式 magic bytes、像素总量上限、可解码性校验）仍未实现。
- 多图层组合误差：无 `trackId`，一组元素无法作为整体轨道统一移动、显隐或转场；组内元素须各自挂动画，同步误差来自各自动画的锚点解析时间（`anchorTime`，`timeline-builder.js:72-76,168`），未解析的动画静默落到第 0 帧。图片元素本身不挂词锚，入场靠元素动画 `move/scaleIn`（`timeline-builder.js:115-134`）。

**3) 目标实现所需扩展（提案，未实现）**
- `tracks[]`（id/kind/z/volume）与 `Element.trackId`；轨道级显隐、轨道级位移与转场；同 z 冲突在写时校验报错。
- `Element` 增加 `objectFit: contain|cover|fill`、`objectPosition`、`placeholderColor`；`assets[]` 登记图片宽高比与字节数。图片 decode fail-closed 在 Player/Renderer 侧已实现（见上证据）；剩余提案缺口为**服务端素材预检**：magic bytes 校验、像素总量（宽×高）上限、上传前解码校验，在素材进入编排前拦截不可用文件（对齐架构 §9.1，`docs/plan-agent-video-studio-architecture-2026-11-14.md:477-478`）。

**4) 视觉断言方法**
- **L1**：前景元素边界盒内采样前景色占比 ≥ 90%；被遮挡元素在交叠区域不出现其像素；contain 留白边距用背景色采样（四角像素 = 背景 HEX，容差 4/255）。
- **L2**：片段内 z 序不变（无元素穿插翻转），逐帧比较交叠区域前景归属一致；2s 片段内图片区域前景占比逐帧差 ≤ 2%。
- **L4**：`el.style.zIndex` 与 IR `z+1` 一致；同层元素 `compareDocumentPosition` 顺序与 IR 数组顺序一致；`img.naturalWidth/naturalHeight` > 0 且 `getBoundingClientRect()` 与 IR 盒子偏差 ≤ 1px；坏图注入（当前行为断言）：断链 key 时 `window.__player.error` 非空且含素材标识、`__player.ready === false`、`awaitReady` 返回带根因的错误；服务端预检拦截为提案落地后断言。

### 5.3 T-03 局部裁剪 / 遮罩 / 圆角异形（mask / clip-path / overflow）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⛔ 无元素级裁剪字段；唯一裁剪边界是 `#stage` 的整体 `overflow: hidden` | ⛔ shape 叠边伪遮罩无法通过圆弧/异形边界断言 |

- 证据 `[代码]`：模板 CSS 只有 `#stage { overflow: hidden }`（`projector.go:286-293`）；`.el` 无 `mask/clip-path/overflow` 声明（`projector.go:295`）；`Element` 无 `clipPath/mask/borderRadius` 字段（`ir.go:116-130`）；`.el-shape` 仅有固定 `border-radius: 8px`（`projector.go:302`），不可配。
- 结论：圆形头像、异形遮罩、局部抠图、元素超出自身盒裁剪，现 IR 做不了。

**2) 现 IR 降级配方（shape 叠边伪遮罩）**
- 做法：被遮罩元素正常铺满，再用若干与背景同色的 `shape` 矩形压在需要裁掉的边侧（例：四角矩形条盖住方形头像的四个角，模拟圆形外的四角区域）。误差来源与量级：
  1. 遮罩边只能是轴对齐矩形，无法跟随圆弧/斜线；圆弧边界在 8px 圆角尺度上可见锯齿状台阶，圆半径越小台阶越明显。
  2. 压边用纯色，若底层是图片、渐变或动态背景，压边与底纹不匹配，接缝在 L1 像素断言中表现为边界两侧颜色阶跃 > 30/255。
  3. 压边元素计入 64 元素上限（`ir.go:183,270-272`），每条边/每个角至少 1 个 shape。
- 替代：把裁剪前移到素材生产阶段（图片在上传前裁好圆形/异形），IR 只摆放成品图；这是现 IR 下唯一无接缝路径。

**3) 目标实现所需扩展（提案，未实现）**
- `Element` 增加 `clipPath`（矩形 / 圆角 / 圆 / 椭圆 / SVG path 引用）、`mask`（图片 luminance mask）、`borderRadius`（四边可分别设定）；`.el` 对应 `overflow: hidden` + CSS `clip-path`。

**4) 视觉断言方法**
- **L1**：异形目标边界带（例圆头像外接盒四角 20×20 区域）断言为背景色；圆周边界采样 16 个点，到圆心距离与半径偏差 ≤ 2px。
- **L2**：遮罩区域在片段内不出现底层元素像素泄漏（边界带前景占比 ≤ 1%）。
- **L4**：`el.style.clipPath` / `getComputedStyle(el).clipPath` 非空；`el.scrollWidth/Height` 与盒尺寸一致（裁剪未导致内部滚动）；伪遮罩方案下断言压边 shape 的 `z` 高于被遮元素（`timeline-builder.js:66`，zIndex = 1 + z）。

### 5.4 T-04 粒子与粒子替代

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⛔ 无发射器 / 生命期 / 速度重力 / 透明度包络 / 混合模式字段；只能用 shape/text 元素阵列手工模拟 | ⛔ 阵列近似无渐隐、无光斑叠加、无运动模糊，无法通过真粒子密度与轨迹断言 |

- 证据 `[代码]`：元素类型仅 `image|text|shape`（`ir.go:31-34,195`）；动画仅 `move|scaleIn|rotate`（`ir.go:197`）；`Element` 无 `opacity/blur/blendMode/particle` 字段（`ir.go:116-130`）；builder 全文无 `Math.random`、`Date.now` 或 wall-clock 计时（`timeline-builder.js:1-262`）；确定性要求见架构 §9.1（`docs/plan-agent-video-studio-architecture-2026-11-14.md:479`）：画面来源禁用随机数与 wall-clock timer。
- 结论：连续粒子流、烟雾/光斑扩散、带淡入淡出的粒子阵列在现 IR 做不了；离散的"小圆点阵列 + 错峰入场"可作为静态/准静态替代。

**2) 现 IR 降级配方（元素阵列模拟）**
- 数量上限换算：`elements ≤ 64`（`ir.go:183,270-272`）。固定 chrome（背景 1、标题 1、字幕 1、UI 层 1）占 4；预留 20 个元素给后续覆盖层与强调元素后，**粒子数 ≤ 40**。每个粒子的错峰入场占 1 条动画（`scaleIn` 或 `move`）；单元素 ≤ 16 动画（`ir.go:373-375`）在此不构成约束；特效预算 `effects ≤ 128`（`ir.go:182,249-251`）与其他技术项共享。
- 错峰锚点写法：每个粒子元素挂一条入场动画，`startAnchor` 指向不同锚点；现 IR `Anchor` 只有 `text + occurrence`（`ir.go:74-76`，无 `wordId` 字段），同一锚点词重复出现时用 `occurrence`（0-based 序号）区分；锚点解析为 `missing` 的动画静默落帧 0（`timeline-builder.js:72-76,168`），粒子锚点必须在 words 表中可解析。
- 确定性：粒子初始 `x/y/w/h`、颜色、入场延迟帧全部写死在 IR JSON 里；Builder 侧不生成任何随机值。若需散布随机性，必须在 IR 生成阶段由固定 seed 算出坐标后写入，Builder 不持有 RNG。
- 误差（相对真粒子模拟）：
  1. 形变能力只有 rotation；无缩放以外的形状形变，无 opacity 淡入淡出（动画白名单无 opacity，`ir.go:197`），粒子只能"出现"或"位移/旋转"，不能渐隐。
  2. 无混合模式（`mix-blend-mode`）、无模糊/辉光；粒子间叠盖为普通 z 序遮挡，无光斑叠加提亮。
  3. 无运动模糊；高速位移粒子在帧间呈离散跳变。
  4. 密度感来自错峰入场的时间编排，不是物理速度/重力模拟；阵列位置是手工布局，无自动散布。

**3) 目标实现所需扩展（提案，未实现）**
- 新增粒子发射器元素类型：`count`、`origin{x,y}`、`spread{angleMin,angleMax}`、`velocity{min,max}`、`gravity`、`life`、`size{min,max}`、`opacityEnvelope{in,out}`、`blendMode`、`seed`；发射器内部粒子由 Player 按 seed 确定性生成，坐标不逐个进 IR。
- `Element` 补 `opacity`、`blendMode`、`filter`（blur/brightness）字段；动画类型增加 `particleLife`（透明度 + 位置包络）。

**4) 视觉断言方法**
- **L1**：粒子 ROI（例 `x∈[100,980], y∈[400,1400]`）内前景像素占比 ≥ 规格下限（例 ≥ 5%）；粒子点尺寸与 IR `w/h` 偏差 ≤ 2px。
- **L2**：帧差 `d(k)` = 帧 k 与 k−1 的全图平均绝对像素差；错峰入场应表现为多个小幅 `d`；若某帧 `d(k) ≥ 5·median(d)`，判定为粒子同时弹出（错峰失效）。元素计数断言：DOM 粒子节点数 = IR 声明数；距 64 元素上限余量 = `64 − 当前元素数`，记录进测试报告。
- **L4**：每个粒子节点 `getBoundingClientRect()` 与 IR 字面坐标偏差 ≤ 1px；`el.style.transform` 不含未声明的随机偏移；Builder 源码静态扫描无 `Math.random`、`Date.now`、`performance.now` 作为画面来源。

### 5.5 T-05 伪透视（2D 元素伪造三维倾角 / 梯形变形）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ 可用统一 scale + translate 近似"远小近大"错觉；可用变换只有 x/y 平移、scale、rotation（2D） | ⛔ 真梯形（绕轴倾角、消失点收敛）不可达；对称缩放近似在对称构图下为 ⚠️，非对称拉伸场景不达标 |

- 证据 `[代码]`：动画类型白名单仅 `move|scaleIn|rotate`（`ir.go:197`）；builder 只产生 `x/y/scale/rotation/transformOrigin`（`timeline-builder.js:115-134`）；模板 CSS 无 `perspective`（`projector.go:285-303`）。
- 结论：真透视（平面绕 Y 轴倾斜成梯形、两边消失点收敛）做不了；只能用均匀 scale + 平移做"远小近大"的单层错觉。

**2) 现 IR 降级配方与数学误差**
- 仿射近似：对一张平面素材用 `scaleIn` 从 `fromValue=0.85` 到 `toValue=1`，配合 `move` 平移到目标中心。误差模型：真透视下，平面绕 Y 轴转 φ、深度 z、焦距 f，左右边缩放比为 `(f + z·cosφ) / (f − z·cosφ)`；现方案均匀缩放保持两边比例 = 1，两边缩放比误差 = 上式 − 1。量级示例：φ=20°、z/f=0.3 → 比 ≈ 1.22，均匀缩放无法表达该 22% 的边侧拉伸；水平平行线在真透视中向消失点收敛，现方案保持水平平行，线汇误差随 φ 增大。
- 为什么不是真 3D：无 `perspective()` 变换、无 `rotateX/rotateY`、无深度排序；多个元素之间不存在视差（见 T-06）。
- 可断言数值：到达帧缩放比 `s₁ = 1`，起始 `s₀ = 0.85`；中间帧比例 `s(t) = s₀ + (s₁−s₀)·ease(t)`，线性段 ease 为 `linear` 时 `s(t) = 0.85 + 0.15·t`。

**3) 目标实现所需扩展（提案，未实现）**
- `ElementAnimation` 增加 `rotateX/rotateY/rotateZ/skewX/skewY` 与元素级 `perspective`、`translateZ`；或新增 `type: "perspectiveTo"`，参数含目标俯仰/偏航角与焦距。

**4) 视觉断言方法**
- **L1**：目标帧元素四角坐标与预期仿射盒偏差 ≤ 2px；梯形边角（真透视目标）在现方案下断言为"矩形"，即左右边竖直、上下边水平。
- **L2**：缩放序列逐帧 `scale` 与 `s(t)` 公式值偏差 ≤ 0.01；相邻帧元素边界位移连续，无跳变 > 5px。
- **L4**：`getComputedStyle(el).transform` 解析出 matrix，分解 `a/d`（x/y 缩放）差值 ≤ 0.005（证明无非均匀拉伸）；提案落地后断言 matrix3d 含 `m13/m23/m33` 深度分量。

### 5.6 T-06 镜头推进 / 拉远（dolly zoom 与视差）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ 单层主体 scale 推进可搭结构；无相机对象、无深度层 | ⚠️ 单层变焦可通过断言；分层视差与 dolly-zoom 景深差别 ⛔，同比例缩放无法表达 |

- 证据 `[代码]`：`scaleIn` 写死 `transformOrigin: '50% 50%'`（`timeline-builder.js:126`）；所有元素共用一条时间轴（`timeline-builder.js:186`），无相机对象；模板无 `perspective`（同 T-05）。
- 结论：单层"画面推近"可做；背景/主体分层视差、dolly-in 与 zoom-in 的景深差别做不了。

**2) 现 IR 降级配方与数学误差**
- 推进配方：给主体元素加 `scaleIn`，`fromValue=0.9`、`toValue=1.15`，锚定关键词 `startAnchor`；背景元素不加动画。到达帧前后缩放比可断言：起始 `s=0.90`，到达 `s=1.15`。
- 误差：
  1. 现 scale 作用于单个元素；要让"整屏推进"须对每个元素分别加 scale，元素间缩放同步误差来自各自动画的锚点解析时间（`anchorTime`，`timeline-builder.js:72-76,168`），未解析的动画静默落到第 0 帧。
  2. zoom（焦距变化）与 dolly（机位移动）的区别在视差：现方案所有图层同比例缩放，前景/背景位移比 = 1；真 dolly 近景位移大于远景，比例随深度差变化。视差误差量级：两层深度差 Δz、焦距 f，真 dolly 位移比 ≈ z₂/z₁，现方案恒为 1。
  3. 锚点固定元素中心（50% 50%），推进时画面中心 = 元素中心；要推向画面某一侧，须先用 `move` 把元素中心对准目标点。

**3) 目标实现所需扩展（提案，未实现）**
- 顶层 `camera` 对象：`zoom`、`pan{x,y}`、`perspective`、`depthLayer`；动画可作用于相机而非元素；`trackId` 配合深度差产生视差。

**4) 视觉断言方法**
- **L1**：推进起始帧与到达帧主体盒尺寸比 = 1.15/0.90 = 1.278，实测偏差 ≤ 2%；中心位置两帧重合偏差 ≤ 2px。
- **L2**：推进区间内逐帧缩放比拟合 `s(t)`，与 ease 曲线偏差 ≤ 0.01；背景层在现方案下应保持静止（背景区域逐帧差 ≤ 2/255），以此区分"整体 zoom"与"主体放大"。
- **L4**：读 `el.style.transform` 的 scale 分量；提案落地后断言相机节点 `zoom` 序列与规格一致。

### 5.7 T-07 跨场景转场（多 composition / 淡入淡出 / 位移切换）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⛔ 架构为单一 composition（`timelines['main']`），无场景概念，无场景组级转场字段 | ⛔ 同层位移/叠化近似下两组元素全程共存、背景同动，无法通过串行切换与组级淡出断言 |

- 证据 `[代码]`：`timelines` 只注册一个键 `main`（`timeline-builder.js:186`）；`IR` 无 `tracks/scenes/compositions` 数组（`ir.go:158-167`）；特效 `fade` 的作用目标是整层 `#canvas`（`timeline-builder.js:108-111,182`），不是某个场景元素。
- 结论：场景 A → 场景 B 的独立转场（旧场景整组淡出、新场景整组淡入、划像、叠化）现 IR 做不了。

**2) 现 IR 降级配方（同层淡入淡出 / 位移近似）与破绽**
- 配方：场景 A 元素与场景 B 元素同时声明；B 组元素用 `scaleIn fromValue=0` 入场，A 组元素用 `move` 移出画面（例：`from{x:0,y:0} to{x:-1080,y:0}`）。时间锚定：两组动画 `startAnchor` 分别落在场景 A 末词与场景 B 首词。
- 破绽（必须写进案例差异说明）：
  1. `fade` 特效作用于 `#canvas` 整层（`timeline-builder.js:182`），整屏底色/整屏透明度变化，无法只淡出 A 组；背景元素会随整层一起动。
  2. 无元素时间窗（见 T-09），A 组元素在 B 组入场后仍留在 DOM 中，仅靠位移离屏；若 `move` 终点未完全移出 `#stage` 边界，残留像素可见。
  3. 两组元素全程共存于同一 z 序，叠化区间内新旧内容交叠，无法做"先出后进"的串行切换。
  4. 转场时长受单条动画 `durationFrames` 限制；多段衔接靠多条 `move`，每段 ≤ 16 动画/元素预算（`ir.go:373-375`）。

**3) 目标实现所需扩展（提案，未实现）**
- `compositions[]`（或 `scenes[]`），每个场景自带元素集与时间区间；场景间转场类型枚举（`cut|fade|dissolve|slide|wipe`），转场作用于场景组而非 `#canvas`；顶层 `animations[]` 可指定 `targetCompositionId`。

**4) 视觉断言方法**
- **L1**：切换前后两帧分别只含 A 组 / B 组元素；交叠帧（过渡中段）两组像素同时存在为预期。
- **L2**：≤5s 片段覆盖一次切换；A 组前景占比从 100% 降到 ≤1% 的帧区间，与 B 组从 ≤1% 升到 90% 的区间在时间上对齐（叠化）或串行（滑动）；破绽断言：B 组入场后 A 组残留像素在离屏方向边界外 ≤ 1%。
- **L4**：两组元素 `getBoundingClientRect()` 位置序列与 `move` 路径一致；提案落地后断言场景节点存在独立显隐状态。

### 5.8 T-08 路径运动（曲线 / 多段折线 / 贝塞尔轨迹）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ 两点 `move` 线性插值在位；曲线可由两段（至多 14 段）折线拼出结构 | ⚠️ 短折线在弦高预算内可通过断言；样条 / 贝塞尔真曲线 ⛔，拐角速度不连续 |

- 证据 `[代码]`：`move` 的 `from/to` 是单个 `Point`（`ir.go:95-98,104-105`）；builder 在两点间做 `x/y` 补间（`timeline-builder.js:115-122`）；无路径点数组、无贝塞尔控制点字段。
- 结论：直线运动 ✅；圆/弧线/自定义曲线 ⚠️ 用多段 `move` 折线逼近，段数受 16 动画/元素上限约束。

**2) 现 IR 降级配方：分段数与误差**
- 做法：把轨迹采样为 N 个点 `P₀…P_N`，元素上挂 N 条 `move` 动画，第 k 条 `from=P_{k-1}, to=P_k`，`durationFrames` 按段弧长比例分配；每条 `startAnchor` 可选挂词锚，不挂则落到帧 0（`timeline-builder.js:162-169`，锚点解析 `:72-76`）。
- 弦高误差：半径 R 的圆弧分 N 段，单段弦高 `h ≈ R(1 − cos(π/N))`。量级：R=500px，N=8 → h≈38px；N=16 → h≈9.6px；N=32 → h≈2.4px。现预算 N ≤ 16（`ir.go:373-375`），R=500 圆弧的折线误差约 9.6px，在 1080 宽画布上占 0.9% 宽度。
- 其他误差：每段独立 ease，拐角处速度曲线不连续；`back.out` 等非线性 ease 会在段端点产生越界回弹；段间时间衔接无重叠缓冲，锚点词时间戳不准会导致段时长分配偏差。
- 段数预算换算：16 动画/元素 − 1 条入场 `scaleIn` − 1 条退场 = 14 段可用；多元素并行时还要计入 64 元素与 256 KiB 总上限（见 §5.17）。

**3) 目标实现所需扩展（提案，未实现）**
- `ElementAnimation` 新增 `type: "path"`，参数 `points[]`、`curve: linear|catmullRom|bezier`、`controlPoints[]`；路径可整体挂缓动与词锚；轨迹方向自动对齐（rotation 跟随切线）。

**4) 视觉断言方法**
- **L1**：路径终点位置与规格偏差 ≤ 2px；中间采样点（每 4 段取 1 点）到理论曲线距离 ≤ 弦高预算（N=16, R=500 → ≤ 9.6px）。
- **L2**：路径区间逐帧元素位置拟合采样折线，相邻帧位移方向角变化 ≤ 规格拐角阈值；速度无段内跳变（相邻帧位移量差 ≤ 15%）。
- **L4**：每条 `move` 的 from/to 与 IR 一致；`el.style.transform` 的 `x/y` 序列单调沿路径；提案落地后断言路径控制点数组被消费。

### 5.9 T-09 元素时间窗、错峰入场与 opacity 动画

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ 可用 `scaleIn from 0` / 离屏 `move` 搭出错峰入场结构；元素一次性 append 到 `#canvas` | ⛔ 无时间窗、无元素级 opacity；入场前隐藏依赖 GSAP `immediateRender` 行为（见下，**[待验证]**），无法保证窗口外元素不可见 |

- 证据 `[代码]`：`Element` 无时间窗字段（`ir.go:116-130`）；所有元素在 `build()` 中一次性 append（`timeline-builder.js:144-170`）；动画白名单 `move|scaleIn|rotate`（`ir.go:197`），无 fade-in/out 元素动画；`fade` 特效目标为整层 canvas（`timeline-builder.js:108-111,182`）。
- 字段位置裁定 `[代码]`：`from/to/fromValue/toValue/easing` 必须写在 animation **顶层**；包进 `params` 的同名键落入 `ElementAnimation.Extra`（`ir.go:112`），`elementMap` 只透传顶层键（`projector.go:243-275`），builder 不读取 `extra`。
- 结论：指定"第 K 帧才出现、第 M 帧退场"的元素级时间窗做不了；错峰入场只能用 `scaleIn from 0` 或 `move` 离屏近似。

**2) 现 IR 降级配方与"未入场即可见"风险判定**
- 近似配方：元素入场用 `scaleIn`，`fromValue=0, toValue=1`；或 `move` 从画面外（例 `x=-200`）移入。退场：`move` 移出画面（现无反向 scale-out 之外的元素退场动画；`scaleIn` 语义为从 fromValue 到 toValue，可复用为 `fromValue=1,toValue=0` 做缩小退场，但 builder 类型名仍是 scaleIn，`timeline-builder.js:123-128`）。
- 风险判定：GSAP `fromTo` 默认 `immediateRender: true`，即在补间开始前立即渲染 from 状态 `[外部] https://gsap.com/docs/v3/GSAP/Timeline/fromTo()/`。据此：`scaleIn fromValue=0` 的元素在时间轴起点即处于 scale 0（不可见），"未入场帧已可见"风险在 scale 路径下**不成立**；`move` 路径同理（from 偏移在起始帧即生效）。但该默认行为在 vendored GSAP 版本上的实际表现未在本轮跑浏览器验证，标 **[待验证]**。
- 验证脚本思路（L4 DOM 断言）：页面 ready 后、`seek(0)` 之前，对每个挂 `scaleIn` 的元素读 `getComputedStyle(el).transform`；若为 `matrix(0,0,0,0,0,0)` 则 from 状态已落地（不可见）；若为 `none` 或单位矩阵则元素在入场前可见，风险成立。对照样本：无动画元素应读到 `none`。
- 残留误差：`scale=0` 元素仍占 DOM 盒、命中布局/命中区；离屏 `move` 元素在移出前的起始帧位于 from 坐标，若 from 坐标未完全在 `#stage` 外（边界 < 元素半宽），边缘像素可见。

**3) 目标实现所需扩展（提案，未实现）**
- `Element` 增加 `startFrame/endFrame`（或 `startSec/endSec`）与初始 `opacity`；动画类型增加 `fadeIn/fadeOut`（opacity 补间，作用于元素）；元素在窗口外由 Player 强制 `display:none`，不参与渲染命中。

**4) 视觉断言方法**
- **L1**：入场前帧（帧号 < 入场帧）目标区域无前景像素（占比 ≤ 1%）；入场完成帧元素盒完整出现。
- **L2**：错峰序列逐帧记录每个元素前景占比；入场帧之前占比 ≤ 1%，入场区间按 ease 曲线升到 ≥ 90%；元素间入场顺序与锚点词时间序一致。
- **反向断言强制项**：若 `immediateRender` 风险经上述脚本判定成立，则现 IR 错峰入场必然出现"入场前元素已可见"；任何错峰入场的验收断言**必须**包含反向检查——入场帧之前每一帧，目标区域前景占比 `cover ≤ 0.02`。只断言"出现后元素是否存在"等于没测。
- **L4**：`immediateRender` 行为按上述脚本取证；元素 `opacity` 计算值序列与规格一致（扩展落地后）；窗口外元素 `display === 'none'`。

### 5.10 T-10 计数器（counter）定位与样式控制

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ `counter` 特效类型在位，`from/to/suffix` 可表达计数结构；自建节点无定位字段 | ⛔ 数字只能出现在画布左上原点，位置/字号/颜色均不可控，目标坐标计数断言不可达 |

- 证据 `[代码]`：`counterHost` 创建 `<div id="counter-<fxId>">`，只设 className，不写 left/top/width/height（`timeline-builder.js:245-255`）；CSS `.el-text.counter { font-size: 96px; font-weight: 700 }`（`projector.go:301`）；特效 params 白名单仅 `from/to/suffix`（`ir.go:333-336`）。
- 结论：数字滚动只能出现在画布左上原点附近；"价格/统计数字滚动到指定坐标、指定字号颜色"做不了。

**2) 现 IR 降级配方：三个替代方案及误差**
- 方案 A（静态结果数字 + 放弃滚动）：在目标坐标放普通 `text` 元素写死最终值；counter 特效若保留，其滚动数字出现在原点，画面上出现两处数字（原点滚动 + 目标位静态）。误差：目标位置正确，但无计数过程；两数字并存属视觉缺陷，案例应只取其一——要么不用 counter，接受静态数字；要么用 counter 演示、目标位不放置数字。
- 方案 B（数字图片条 + 离散跳变）：0–9 各备一张数字图（`image` 元素），按目标位数叠放；用 `move` 在位数间切换图片显隐位置。误差：只能离散跳变，无连续插值；元素数 = 位数 × 候选图（管理 z 与重叠位置成本高）；无图片资产时不可用；字形受素材字体限制。
- 方案 C（等待扩展）：现 IR 不交付数字滚动案例，案例稿标注阻塞项。
- 通用误差：counter 时长被钳在 `[0.3, 1.2]s` 且不超过剩余时长（`timeline-builder.js:91`）；`Math.round` 取整（`:92`），小数计数不可表达；后缀 `suffix` 直接拼在数字后，无间距控制。

**3) 目标实现所需扩展（提案，未实现）**
- `Effect`（counter）增加 `x/y/w/h/align/color/fontSize/fontWeight` 定位与样式参数；`targetElementId` 使 counter 文本绑定到既有文本元素；支持 `decimals`（小数位）与前缀符号。

**4) 视觉断言方法**
- **L1**：目标数字区域（例 `x∈[860,1000], y∈[1400,1500]`）在结果帧出现预期数字像素；counter 方案下原点区域 `x∈[0,200], y∈[0,120]` 同样采样。
- **L2**：counter 片段内数字文本逐帧读取（DOM），值序列从 `from` 单调到 `to`，帧间增量符合 `power1.out` 衰减；数字宽度随位数变化时不溢出目标盒。
- **L4**：`#counter-<fxId>` 的 `getBoundingClientRect()`；方案 A 下断言静态文本盒位置 = 规格坐标；方案 B 下断言可见图片数 = 位数。提案落地后断言 counter 节点 left/top 与规格一致。

### 5.11 T-11 图表 / 条形生长动画（基线生长 vs 中心缩放）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ `scaleIn` 生长动画在位；对称（中心扩散）图形可搭结构 | ⛔ 基线对齐生长（柱状图 / 进度条）不可达：锚点写死中心，生长过程基线滑动 |

- 证据 `[代码]`：`scaleIn` 固定 `transformOrigin: '50% 50%'`（`timeline-builder.js:126`）；`Element` 无 `transformOrigin/anchorPoint` 字段（`ir.go:116-130`）。
- 结论：从中心扩散的图形生长 ✅；从底部基线向上生长的柱状图、从左向右生长的进度条 ⛔（中心缩放错误，见下）。

**2) 现 IR 降级配方与具体视觉错误**
- 错误样例：条形 `el_bar`：`x=90, y=1500, w=120, h=300`，基线底边 `y=1800`。`scaleIn fromValue=0 → toValue=1`，中心固定在 `y=1650`。缩放至 s 时渲染高 = `300s`，底边 = `1650 + 150s`：
  - s=0.5：底边 = 1725（应保持 1800），下偏移 75px；顶边 = 1575（预期基线生长顶边 = 1800 − 150 = 1650），上下各错 75px。
  - s=1：底边 1800、顶边 1500，仅到达帧与基线生长一致。
- 即：生长过程中条形同时向上、向下扩张，基线滑动；这是必须在案例差异说明中写明的具体错误，不能描述为"条形从底部长出"。
- 降级配方：
  1. 位置补偿：把条形初始 `y` 上移 `h/2`，使中心缩放的底边在视觉上接近基线——误差：底边仍随 s 变化（`1650+150s` 模型不变），只是中心位置换了，基线滑动幅度不减半，仅改善终点对齐。
  2. 用 `move` 逐段抬升顶边近似：条形高度无法通过 move 改变（无尺寸补间动画），该路径不成立。
  3. 静态条形 + `scaleIn` 整组强调：接受中心缩放，把图形设计为对称图标而非基线柱状图。

**3) 目标实现所需扩展（提案，未实现）**
- `Element` 增加 `transformOrigin`（或 `anchorPoint: left|center|right|top|bottom` 组合）；动画类型增加 `grow`（参数 `axis: x|y`、`fromSize/toSize`、基线锚点），补间宽/高而非 scale。

**4) 视觉断言方法**
- **L1**：到达帧条形盒 `[90,1500,120,300]` 边界与 golden 偏差 ≤ 2px。
- **L2**：生长区间逐帧采样底边行带 `y∈[1796,1804]`：基线生长预期全程为条形色；现中心缩放方案下，该色带在 s < 1 时背景占比随 `1 − s` 增大，断言记录该偏差曲线作为已知误差，而非判失败。
- **L4**：`el.style.transformOrigin` 计算值；读 `el.getBoundingClientRect()` 顶/底边序列，与 `center-origin` 模型 `bottom = y + h/2 + (h/2)·s` 拟合，残差 ≤ 2px。

### 5.12 T-12 逐词 / 逐元素高亮（highlight 作用域）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ 可用逐词独立 text 元素 + 元素自身 scale/move/rotate 搭出强调结构 | ⚠️ 元素级替代可通过词盒断言；原生特效整层作用域 ⛔——`highlight/pulse/shake/fade` 均作用于 `#canvas`，无元素级特效目标 |

- 证据 `[代码]`：特效目标 `fx.type === 'counter' ? counterHost(fx) : canvas`（`timeline-builder.js:182`）；`highlight` 对目标节点做 `backgroundColor` 补间（`:95-101`）；`Effect` 无 `targetElementId` 字段（`ir.go:86-92`）。
- 结论：逐词高亮 = 整屏底色闪现；单词/单元素的背景色、描边、放大强调在现特效体系内做不了。

> **[修正 2026-11-15 round1]（依据 delivery-audit-video-studio-round1 §2.2 X-4 / example/internal/video/testdata/spec-audit-report.json X-4）本节原只点名 highlight/pulse 的整层作用域，实测确认作用域缺口为全量**：shake、fade 与 highlight/pulse 一致，同样全部作用于 `#canvas` 整层（timeline-builder.js:79-112 五个 effectBuilder 均无 target 概念；`:182` 三元表达式只有 counter 走 counterHost、其余一律 canvas）。上表两列档位维持不变；本节降级配方"特效层不可用于单元素"的结论按全量 5 类特效（pulse/counter/highlight/shake/fade）成立，其中 counter 是唯一有非 canvas 目标的类型（counterHost 自建 div），但其目标同样不可定位、不可指定元素。

**2) 现 IR 降级配方与元素预算换算**
- 替代：每个词建一个独立 `text` 元素，元素自身动画承担强调——`scaleIn` 做放大（`fromValue=1→1.15` 再回落需两条动画）、`rotate` 做倾斜、`move` 做位移。特效层的 `highlight/pulse` 不可用于单元素（pulse 同样作用于 canvas，`timeline-builder.js:182,80-84`）。
- 元素预算：上限 64 元素（`ir.go:183,270-272`）。固定 chrome：背景 1 + 标题 1 + 字幕条 1 + logo 1 = 4；逐词高亮槽位 ≤ 60。特效上限 128（`ir.go:182,249-251`），若后续扩展为元素级，逐词高亮最多覆盖 128 个词。
- 误差：元素级 `scaleIn` 是补间到目标值，无"回弹后保持原状"的内置脉冲；要做脉冲需 `scaleIn 1→1.15` 加第二条 `scaleIn 1.15→1`，占 2 动画/词；词元素排版位置须手工计算（无词级布局引擎），词间对齐与换行误差见 T-01。

**3) 目标实现所需扩展（提案，未实现）**
- `Effect` 增加 `targetElementId`（或 `targetWordId`）；高亮类型增加 `textBackground/underline/stroke`；`highlight` 作用域从 canvas 改为目标节点；词级元素由 Player 按 words 表自动布局。

**4) 视觉断言方法**
- **L1**：目标词盒区域背景色 = 高亮 HEX（例 `#FFD54F`），区域外背景色差 > 30/255；现方案下反证：整屏采样 4 个角落，高亮帧角落背景色同样变为高亮色（记录为整层闪现证据）。
- **L2**：高亮帧区间内目标词亮度峰值与词锚时间对齐（帧偏差 ≤ 1 帧）；非高亮词区域亮度逐帧差 ≤ 2/255。
- **L4**：`document.getElementById(targetId)` 的 `backgroundColor` 计算值序列；`canvas` 节点背景未被修改（扩展落地后判据）；现方案下断言 `#canvas` 背景色在高亮帧发生变化。

### 5.13 T-13 音频混音链（voice + BGM、响度、长度对齐、loop）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ voice/BGM 双轨结构在位，可走混流滤镜链 | ⚠️ 基础混流可出片；无 normalize 关闭、填充/裁剪/重采样/响度规范化，BGM 不 loop，平台响度目标断言不可达 |

- 证据 `[代码]`：现链（voice + bgm）`[2:a]volume=<v>[bgm];[1:a][bgm]amix=inputs=2:duration=first[a]`，视频 stream copy（`platform/capx/encode.go:161-170`）；无 `normalize=0/apad/atrim/aresample/loudnorm`；bgm-only 分支仅 `volume=`（`encode.go:174-180`）。
- 对照目标链（架构 §9.3，`docs/plan-agent-video-studio-architecture-2026-11-14.md:526-528`）：`amix=inputs=2:duration=longest:normalize=0` → `apad` → `atrim` → `aresample=48000` → 可选 `loudnorm=I=-16:TP=-1.5:LRA=11`。

**2) 现链行为、误差与量级**
- 音量衰减：`amix` 默认 `normalize=1`，按输入数缩放 `[外部] https://ffmpeg.org/ffmpeg-filters.html#amix`；两路混合输出 ≈ `(voice+bgm)/2`，人声相对其原始电平衰减约 6.02 dB。目标链 `normalize=0` 保留输入电平，人声不被除法削弱。
- 长度对齐：现链 `duration=first`，输出时长 = amix 第一个输入（voice）时长；BGM 短于 voice 时，BGM 结束后余下区间为静音，**不 loop、不 apad**（`encode.go:161-183` 无循环滤镜）。voice 缺失、仅 BGM 分支：输出音频长度跟随输入，视频尾部无音频填充；具体尾部静音行为 **[待验证]**，验证：`ffmpeg -i out.mp4 -af volumedetect -f null -` 测尾部 1s 音量，并 `ffprobe -show_streams` 比对音频/视频时长。
- 采样率与响度：现链不 `aresample=48000`，输出采样率跟随输入；无 `loudnorm`，成片 LUFS 取决于素材本身，不保证 -16 LUFS / TP -1.5 / LRA 11 的平台目标（`[外部] https://ffmpeg.org/ffmpeg-filters.html#loudnorm`、`#apad-1`、`#atrim`、`#aresample-1`）。
- BGM 音量：现仅一个 `volume=<bgmVolume>` 线性系数，系数范围 IR 校验 0–1（`ir.go:434-435`）；无侧链压缩、无 ducking。

**3) 目标实现所需扩展（提案，未实现）**
- `render.audio`：`bitrate`、`loudnessI/TP/LRA`、`sampleRate=48000`、`bgmLoop: true|false`、`bgmFadeIn/FadeOutSec`；混音参数走 `amix duration=longest normalize=0` + `apad+atrim+aresample`；无 voice/BGM 时不构造对应输入分支。

**4) 视觉断言方法（音频断言归 L2/L3）**
- **L2（短片段 MP4）**：`ffprobe -show_streams` 检查音频流存在、声道数；`ffmpeg -i clip.mp4 -af volumedetect -f null -` 记录 mean/max volume；现链人声段电平比目标 `normalize=0` 预期低约 6 dB（误差方向可断言）。
- **L3（完整成片）**：`ffmpeg -i out.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -` 读测量值，对比目标区间；音频流时长与视频流时长差 ≤ 1 帧；BGM 尾部静音起点 = BGM 素材时长（现行为），目标行为为 loop/pad 后全长。
- **L4（不适用音频）**：DOM 层无音频节点——预览时间轴不创建 `<audio>`（`timeline-builder.js:1-262` 全文无 `createElement('audio')`，基线 §2.2 第 9 条）；预览断言仅检查 `IR.audio` 时长基准参与 `durationSec` 计算（`timeline-builder.js:31-33`）。

### 5.14 T-14 字幕烧录与断行（硬字幕 / 软字幕 / CJK 换行缺陷）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ⚠️ cue 分组与 SRT 输出结构在位；硬字幕链依赖 ffmpeg 编译含 libass，软字幕降级打包在 capx 内未实现 | ⚠️ 字幕可烧录/可封装；CJK 禁则断行 ⛔——无空格时按 rune 中点硬切，行首标点与词中断行断言不可达 |

- 证据 `[代码]`：`BurnSubtitles` 用 `-vf subtitles=<srt>`，libx264 重编码、音频 copy（`encode.go:226-238`）；先探测 `ffmpeg -filters` 是否含 `subtitles`，无则返回 `ErrNoLibass`（`encode.go:219-225,193`）；SRT cue 规则：≤16 rune/行、≤2 行、≤6s/cue（`example/internal/video/app/subtitle.go:13-15`）。
- 降级链：libass 可用 → 硬字幕烧录；不可用 → 返回错误由上层走软字幕（`mov_text`）封装；capx 当前只返回 `ErrNoLibass`，软字幕封装调用点 **[代码 待验证]**（`encode.go:193` 仅定义错误，未在 capx 内实现 mov_text mux；需在 service 层接线后验证）。规范参照 WebVTT/SRT 模型 `[外部] https://www.w3.org/TR/webvtt1/`。

**2) 现链断行缺陷与实际错误样例**
- 缺陷机制：`layoutLines` 只在空格处找折行点；纯中文无空格时 `best` 保持 `-1`，最终 `best = half`（rune 中点硬切）（`subtitle.go:72-99`）。`joinWords` 在 CJK-CJK 之间不加空格（`subtitle.go:101-117`），所以中文 cue 必然走硬切分支。
- 错误样例（rune 位置以脚本 `[]rune` 实测为准，**[待验证]** 具体序号）：cue 文本 `"产品上线之后口碑暴涨用户复购率翻倍留存提升"`（22 runes），超 16 进入换行；无空格 → 中点 `best=11`，第一行 `"产品上线之后口碑暴涨用户"`，第二行 `"复购率翻倍留存提升"`——"用户复购率"一词被切在两行；若中点恰好落在标点前，标点会出现在第二行行首（行首禁则被破坏，对照 `[外部] https://www.w3.org/TR/jlreq/`）。
- 其他限制：行长上限 16 rune、最多 2 行、单 cue ≤6s（`subtitle.go:13-15`）；双语字幕、逐词卡拉OK 高亮无对应链。
- 降级配方：脚本分词时把长词拆短、标点并入前词；cue 时长在文案层控制在 6s 内；不依赖字幕换行做长句排版。

**3) 目标实现所需扩展（提案，未实现）**
- 断行器支持 CJK 禁则（行首/行尾禁则字符集）、词边界优先折行、双语上下行；字幕样式字段（字号、颜色、描边、位置、安全区）；软字幕 `mov_text` 封装链与 libass 探测结果一并写入 render 记录。

**4) 视觉断言方法**
- **L1**：字幕区域（底部安全区 `y∈[1700,1860]`，1080×1920）字幕像素与 golden 比对；行首/行首标点位置采样。
- **L2**：≤5s 片段内字幕 cue 切换点与 word 时间对齐（偏差 ≤ 1 帧）；每行 rune 数 ≤ 16、行数 ≤ 2（DOM/SRT 层断言）。
- **L4 / SRT 层**：解析生成的 SRT，断言：① 无行首为 `，。！？、；：` 的行；② 单 cue 时长 ≤ 6s；③ 断行点不在词中（按 words 表边界比对）。libass 探测：`ffmpeg -hide_banner -filters | findstr subtitles` 存在性记录进 render 元数据。

### 5.15 T-15 封面缩略图（封面帧选择与首帧钩子）

**1) 现状判定**

| 结构可表达性 | 视觉达标性 |
|---|---|
| ✅ capx 包内：`ExtractThumbnail` 可出单帧 JPEG；⛔ 产品端到端：选帧参数（`tSec`/多候选）未接线，封面帧写死第 1 秒 | ⛔ 不可选帧、无多候选选优、封面帧与首帧策略未解耦；固定 1s 帧 + 文案前置主体仅为 ⚠️ 近似 |

- 范围说明：包内能力指 `platform/capx` 的 `ExtractThumbnail` 函数；端到端能力指产品层把 `render.thumbnail.atSec`、候选帧选优、封面策略传入该函数的完整链路。
- 证据 `[代码]`：`ExtractThumbnail` 参数 `-ss 00:00:01 -frames:v 1 -q:v 2`（`encode.go:245-259`）；函数签名无 `tSec` 参数（对照架构 §9.2 设计签名 `tSec float64`，`docs/plan-agent-video-studio-architecture-2026-11-14.md:508`，现实现未落地该参数）。
- 结论：产出一张封面图在包内 ✅；指定第 N 秒封面、多候选帧选优、封面帧与视频首帧策略解耦 ⛔。

**2) 现行为与取舍**
- 封面帧 ≠ 第 0 帧：固定 1s 通常跳过开场黑屏/淡入帧，风险是标题卡或关键信息恰在前 1s 出现时，封面错过主视觉；平台信息流默认取视频首帧作钩子，缩略图与首帧不一致会造成"封面吸引、首帧脱节"。
- 质量：JPEG `q:v 2`（高质量档），单帧；无尺寸裁剪、无安全区二次构图；输出为 `-f image2` 单图流（`encode.go:259`）。
- 降级配方：案例稿在分镜表前 1s 内放置最具识别度的主体元素（保证 1s 帧已有内容）；不在封面依赖 1s 后才出现的价格/标题信息。

**3) 目标实现所需扩展（提案，未实现）**
- `render.thumbnail`：`atSec`（或 `frameIndex`）、`width/height`、`cropRect`；支持多候选帧（首帧 / 1s / 高潮帧）由上层选优；封面帧选择策略记入 render 记录。

**4) 视觉断言方法**
- **L1**：缩略图 JPEG 解码后尺寸 = 视频分辨率；主体区域（规格 ROI）前景占比 ≥ 60%，非纯色帧（像素方差 > 阈值，避免黑帧封面）。
- **L2**：对 1s 前后各 1 帧做像素差，确认封面帧非淡入中间态（与相邻帧差 > 5/255）。
- **L4 / MP4 层**：`ffprobe -select_streams v -show_frames` 核对封面对应帧时间戳 = 1.0s（现行为）；提案落地后断言等于 `render.thumbnail.atSec`；首帧钩子断言：第 0 帧主体 ROI 同样非空。

### 5.16 IR 扩展提案汇总（按优先级）

> 除标注**【已实现】**的条目外，以下均为**提案（未实现）**；优先级依据：是否阻塞核心交付（P0）→ 排版正确性（P1）→ 丰富度与分层能力（P2）。字段命名为建议稿，落地时以架构文档 schema 评审为准。

**P0 — 阻塞核心交付，建议最先落地**

| # | 提案字段 / 能力 | 解除的技术项 | 现状证据 |
|---|---|---|---|
| P0-1 | `Element.startFrame/endFrame`（元素时间窗）+ 窗口外 `display:none` | T-09, T-07 | `ir.go:116-130` 无窗字段；`timeline-builder.js:144-170` 一次性 append |
| P0-2 | 元素级 `opacity`（动画类型 `fadeIn/fadeOut`，作用于元素而非 canvas） | T-09, T-12, T-07 | 动画白名单 `ir.go:197`；特效目标 `timeline-builder.js:182` |
| P0-3 | `Effect.targetElementId`（含 counter 绑定文本元素） | T-12, T-10 | `Effect` 无目标字段 `ir.go:86-92` |
| P0-4 | counter 参数 `x/y/w/h/align/color/fontSize` | T-10 | `counterHost` 无定位 `timeline-builder.js:245-255` |
| P0-5 | **【已实现】** 图片 `decode()` 失败 fail-closed：catch 把根因写入 `__player.error` 并重抛 → `Promise.all` 拒绝、`ready` 保持 false → renderer 带根因中止渲染；**剩余提案缺口**：服务端素材预检（magic bytes 校验 / 像素总量上限 / 上传前解码校验） | T-02 | `timeline-builder.js:148-160,211`；`renderer.go:234-239` |

**P1 — 排版与图形正确性**

| # | 提案字段 / 能力 | 解除的技术项 |
|---|---|---|
| P1-1 | `align/verticalAlign/letterSpacing/lineHeight/fontWeight` | T-01 |
| P1-2 | `transformOrigin`（元素锚点）；`grow` 动画（轴向量生长） | T-11, T-06 |
| P1-3 | `clipPath/mask/borderRadius`，元素 `overflow:hidden` | T-03 |
| P1-4 | CJK 禁则断行（行首/行尾禁则字符集）、词边界折行 | T-14 |
| P1-5 | 混音链 `normalize=0/apad/atrim/aresample=48000/loudnorm`、BGM loop | T-13 |
| P1-6 | `thumbnail.atSec` 与多候选帧 | T-15 |
| P1-7 | 动画字段位置裁定：`from/to/fromValue/toValue/easing` 必须在 animation **顶层**，不得包进 `params`（现 `ir.go` 读顶层，`params` 内同名键落入 `extra` 被 builder 忽略） | T-09, T-08 |

**P2 — 组合编排与高级视觉**

| # | 提案字段 / 能力 | 解除的技术项 |
|---|---|---|
| P2-1 | `tracks[]` + `Element.trackId`；场景/ composition 数组与转场类型枚举 | T-07, T-02 |
| P2-2 | `path` 动画（多点 + 贝塞尔/样条曲线 + 切线方向） | T-08 |
| P2-3 | 相机对象（zoom/pan/perspective/depthLayer）与视差 | T-05, T-06 |
| P2-4 | `words[].id`（wordId 锚点）、`assets[]` 登记、`render{}` 参数容器 | 基线 §2.3 登记缺口 |
| P2-5 | `rotateX/rotateY/skewX/skewY/translateZ` 变换集 | T-05 |
| P2-6 | 粒子发射器元素（count/origin/spread/velocity/gravity/life/opacityEnvelope/blendMode/seed） | T-04 |
| P2-7 | 复合组件参数键类型化子 schema（`element.params`：key → 类型 → 默认值 → 可用元素类型）：`title/body/accent/subText/strikeText/textColor/titleColor/quote/author/columns/cards/steps/stepColor/numberColor/cardColor/headcountText/paddingX/qrSrc/qrSize/threshold/face/tag/badge`；未实现，当前这些键被静默忽略 | T-02, T-12 |
| P2-8 | 图形复合键处理口径：`bands/dots/points/labels/segments/pct/label/swatches/crop/outsideDim/stroke/strokeW/zoom/badges` 及 shape 枚举值 `circle/dotGrid/lineChart/donut/frame/cursor/badgeColumn/line`；v1 推荐拆成多个扁平 shape 元素（`elements ≤ 64` 预算下复合组件会吃掉大量槽位），或进子 schema | T-11, T-04 |

> 粒子键名以 P2-6 为准：`count/origin/spread/velocity/gravity/life/opacityEnvelope/blendMode/seed`；案例侧必须使用这套命名，案例现存的 `particleType/velocityY/sizeRange/emitter` 属异名，将被统一。

### 5.17 复杂度分级与成本上限

**1) 硬上限（现 IR 写时校验，常量 `ir.go:179-185`；校验 `228-230,231-233,249-251,270-272,373-375,290-296`）**

| 资源 | 上限 | 校验位置 |
|---|---|---|
| 脚本字符数 | 5000 rune | `ir.go:180,228-230` |
| words 条数 | 2000 | `ir.go:181,231-233` |
| effects 条数 | 128 | `ir.go:182,249-251` |
| elements 条数 | 64 | `ir.go:183,270-272` |
| animations / 元素 | 16 | `ir.go:184,373-375` |
| IR JSON 总字节 | 256 KiB | `ir.go:185,290-296` |
| fps | 24 / 25 / 30 / 50 / 60 | `ir.go:188,304-306` |

> 测试状态 `[实测] 2026-11-15`：本机执行 `CAPX_TEST_CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe" go test ./platform/capx -count=1`，结果 `ok github.com/haozing/ploykit/platform/capx 15.973s`，exit=0。历史基线中"1×1 / 奇数尺寸 H.264 用例失败"的结论在当前工作区已不成立；本节其余 `[代码]` 结论未在本轮重跑。

**2) 复杂度分级（案例设计预算）**

| 级别 | 构图描述 | 元素 / 特效 / 动画预算 | 典型技术项 | 触限风险 |
|---|---|---|---|---|
| S 静态海报式 | 背景 + 标题 + ≤4 个 shape/image | ≤6 元素，≤2 特效，≤2 动画/元素 | T-01, T-02 | 无 |
| A 单层动效 | 单主体入场 + 位移 + 强调 | ≤16 元素，≤16 特效，≤8 动画/元素 | T-06, T-08（短折线）, T-10 | 路径段数受 16 上限约束 |
| B 分层锚点 | 背景/主体/字幕三层 + 词锚动画 | ≤30 元素，≤40 特效，≤12 动画/元素 | T-02, T-04（粒子阵列）, T-07（近似）, T-12（元素级替代） | 逐词元素 / 粒子阵列逼近 64 上限 |
| C 压力组合 | 逐词元素 + 多段路径 + 多特效并行 | 64 元素 / 128 特效 / 16 动画每元素满预算 | T-08 长路径, T-12 逐词, T-07 双场景, T-04 粒子阵列 | 同时触及元素、动画、字节三限 |

**3) 触限换算（设计阶段可直接套用）**

- **64 元素**：固定 chrome（背景、标题、字幕条、logo）占 4；逐词高亮槽位 ≤ 60（T-12）。一条 30s@30fps、每词 2s 的口播 = 15 词，安全；每词 0.5s = 60 词，叠加 chrome 即触顶。
- **16 动画 / 元素**：路径折线 N 段 = N 条 `move`（T-08）；扣除入场 1 + 退场 1，单元素路径 ≤ 14 段。R=500px 圆弧 14 段弦高 ≈ 12.4px（公式 `h ≈ R(1−cos(π/N))`）。
- **128 特效**：逐词高亮/脉冲上限 128 词；超出部分须改用元素自身动画（占用动画预算而非特效预算）。
- **粒子阵列（T-04）**：粒子数 ≤ 40（64 元素 − chrome 4 − 覆盖层预留 20）；每粒子 1 条入场动画；特效与其他技术项共享 128 上限；粒子坐标必须确定性写死在 IR，禁用 Builder 侧随机数。
- **256 KiB IR 字节**：单条 word JSON 约 110–150 B（字段 `index/start/end/text/source`，估算 **[待验证]**，验证：`json.Marshal` 实测 2000 条样例 word 的字节数）；2000 words 理论 220–300 KiB，可能单独逼近或超过 256 KiB 上限。5000 个 CJK 脚本字符 UTF-8 ≈ 15 KiB + JSON 转义开销。元素 JSON 单条约 250–400 B（含动画数组），64 元素 ≈ 16–26 KiB。
- **帧数基准**：`durationFrames = max(1, ceil(durationSec × fps))`（`timeline-builder.js:37`，与 Go 服务端对齐取 ceil；`round` 口径曾在小数总帧上差 1 帧，本轮基线已修复，见文件头注释 `:34-36`）；8.04s@30fps = 241.2 → 242 帧（ceil），案例帧表须按 ceil 口径标注。

**4) 视觉达标性 ⛔ 的技术项清单**

| 技术项 | 达标性 ⛔ 的核心能力 | 同项内可近似部分（⚠️） |
|---|---|---|
| T-03 | 元素级 mask / clip-path / 圆角异形裁剪 | shape 叠边伪遮罩（直线边、纯色底） |
| T-04 | 粒子系统（发射器 / 生命期 / 速度重力 / 透明度包络 / 混合模式） | shape/text 元素阵列 + 错峰入场（无渐隐、无光斑叠加、无运动模糊） |
| T-05 | 真梯形透视（绕轴倾角 / 消失点收敛） | 统一 scale+translate 单层错觉；对称构图下对称缩放近似 ⚠️ |
| T-07 | 多 composition / 场景组级转场 | 同层 move 位移 + scaleIn 叠化（背景同动、元素全程共存） |
| T-09 | 元素时间窗与元素级 opacity 动画 | scaleIn from 0 / 离屏 move 入场（入场前隐藏依赖 immediateRender，**[待验证]**） |
| T-10 | counter 数字定位与样式控制 | 静态数字文本；离散数字图片条 |
| T-11 | 基线对齐生长（柱状图 / 进度条） | 中心对称生长（对称图标构图 ⚠️） |
| T-15 | 端到端选帧 / 多候选封面（包内单帧 JPEG ✅） | 固定 1s 帧 + 文案前置主体 |

表内为**视觉达标性 ⛔** 的项，不代表结构可表达性同样 ⛔（T-09、T-10、T-11 结构列为 ⚠️）。结构与达标均为 ⚠️ 的项（T-01, T-02, T-06, T-08, T-12, T-13, T-14）误差已在各节量化；其中 T-08 样条曲线、T-12 原生整层特效作用域、T-14 CJK 禁则断行为 ⚠️ 项内的 ⛔ 子能力。

## 6. 可靠性、安全与故障矩阵

### 6.0 判定口径

**代码状态三态（矩阵第 5 列统一使用）：**

- **① 已实现并有证据**：代码路径存在且有对应测试或可直接复核的断言点。
- **② 存在但为 stub / 降级 / 部分覆盖**：骨架、适配器或状态机已在，但真实链路是桩、降级路径未闭环，或仅覆盖了部分子场景。
- **③ 缺失**：能力不存在，阻塞点给出 file:line；对应测试一律标「受缺口阻塞」。

**测试状态两态：**

- **可执行待测**：缺口不在被测路径上，本机 Go / Chrome / FFmpeg 三件套齐全即可跑（环境实测见 §7.7）。
- **受缺口阻塞（阻塞点）**：被测行为依赖尚未实现的代码或迁移，先关闭缺口再执行。

**错误码口径**：以架构文档 §10.5 统一语义为准；当前 `service.go:28-36` 实际定义的哨兵错误仅 `E_VIDEO_PROJECT_NOT_FOUND / E_VIDEO_RENDER_NOT_FOUND / E_VIDEO_VERSION_CONFLICT / E_VIDEO_ANCHOR_NOT_FOUND / E_NOT_CONFIGURED / E_FORBIDDEN / E_VIDEO_PREVIEW_INTERNAL / E_VIDEO_ASSET_TOO_LARGE / E_VIDEO_ASSET_UNSUPPORTED`，§10.5 中其余码（`E_QUOTA_EXCEEDED`、`E_TTS_UNAVAILABLE`、`E_ALIGNER_UNAVAILABLE`、`E_WORKSPACE_SCOPE` 等）在 app 层尚无定义，矩阵中引用时标注为「待落地错误码」。

**优先级**：P0 = 阻断出片闭环或可导致越权 / 重复扣费 / 静默坏片；P1 = 正确性或多租户隔离缺口，闭环前必须关闭；P2 = 健壮性 / 可观测性改进，可排期到后续迭代。

---

### 6.1 资源与素材类故障

#### F-RES-01 图片 404 / 坏图 / 超大图 / decode 失败被吞（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | 元素图片对象不存在（404）、字节损坏（decode 抛错）、超大 decompression bomb；坏资源必须阻断出片，不得产出「成功但内容缺失」的视频 |
| 触发方式（注入手段） | (a) IR 图片 `src` 指向未上传 key；(b) 上传字节写为截断 PNG / 非图像字节但声明 `image/png`；(c) 构造超宽 × 超高 PNG（解压后像素总量超限）；(d) 在 data URI 内嵌入 decode 必抛错的字节，观察 `__player.ready` 是否仍翻 true |
| 期望行为与错误码 | 渲染路径：素材缺失或 decode 失败必须 fail closed，返回 `E_VIDEO_INVALID_PARAMS`（素材子集，待落地错误码），不得产出空白帧 MP4；预览路径可显示占位错误。字节 / 像素总量超限 → `E_VIDEO_PAYLOAD_TOO_LARGE`。失败必须进入 `warnings` 或 `error_code`，不允许静默 |
| 断言对象 | `window.__player.ready` 取值；`capx.RenderFrames` 返回错误；`video_render.status=failed` + `error_code`；对象存储是否产生部分输出 |
| 当前代码状态 | **② JS decode fail-closed 与 capx 错误探针在位；服务端素材预检、magic bytes 与像素总量上限缺失**。已具备：素材 key 加载失败经 `DataURIResolver` 上抛（[代码] `app/projector.go:65-83`，loader 错误 `:69-72`）；坏图 decode rejection 记录到 `__player.error` 并 rethrow（[代码] `app/timeline-builder.js:153-160`），`Promise.all(decodePromises)` 拒绝使 ready 保持 false（`:210-212`）；`awaitReady` 轮询期间读取 `__player.error` 并以根因失败（[代码] `platform/capx/renderer.go:234-239`），不依赖 60s 超时兜底。上传侧仅有字节数上限 `UploadLimit = 700 KiB`（[代码] `app/service.go:64`、`:1013-1015`）与声明 MIME 白名单（`service.go:1016-1021`）。**缺口**：无 magic bytes 校验、无解码后像素总量 / 解压尺寸上限（像素炸弹）；提交 / 投影前无资产存在性预检（404 延迟到渲染时才暴露）；无 decode 失败对应的结构化错误码。受缺口阻塞：素材预检、像素炸弹上限、magic bytes、错误码映射 |
| 优先级 | P0 |

#### F-FNT-01 字体缺字（CJK 生僻字 / emoji / 阿拉伯文）与回退链（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | 子集字体不含生僻汉字、emoji、阿拉伯文 / 天城文等文字；浏览器回退到系统字体导致字形、度量（TextMetrics）与 golden 基线不一致；缺字以豆腐块渲染但不报错 |
| 触发方式（注入手段） | 构造 text 元素，文本分别含：罕用字（如「𠀀」「龘」）、emoji（「🎉」）、阿拉伯文（「مرحبا」）；分别在固定镜像与本机 Windows 渲染，截图比对字形与 `element.getBoundingClientRect()`、`TextMetrics.width` |
| 期望行为与错误码 | 字体子集必须覆盖全部受支持字符集；缺字检测在投影 / 渲染前置环节失败并返回明确错误；回退链与字体版本必须写入 render recipe。不得依赖服务器上不可控的系统字体做静默回退 |
| 断言对象 | DOM 内文本字形渲染结果；`document.fonts` 加载状态；recipe 中字体 digest；逐帧像素与 TextMetrics |
| 当前代码状态 | **③ 缺失**。CSS 回退链仅 `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`（[代码] `app/projector.go:298`）；仓库内未找到 vendored 字体文件（[待验证] 验证命令：`Get-ChildItem -Recurse -Include *.ttf,*.woff,*.woff2 example/web,example/internal/video`）。`document.fonts.ready` resolve 不校验字形覆盖（[代码] `app/timeline-builder.js:210`）；投影层无字体 digest、无缺字检测；recipe 结构本身也尚未落库（见 F-IDM / §11 缺口）。受缺口阻塞：字体子集打包、缺字前置检测、recipe 字体记录 |
| 优先级 | P1 |

---

### 6.2 外部合成与时间戳类故障

#### F-TTS-01 TTS 超时 / 限流 / provider 5xx / 返回空音频（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | TTS 供应商超时（>ctx budget）、429 限流、5xx、返回 200 但 `audio_base64` 为空或解码失败、返回时长为 0；当前降级矩阵在「已配置供应商」故障时静默退化为估算词表 |
| 触发方式（注入手段） | 假 Synthesizer 注入：(a) 延迟 61s；(b) 返回 `http.StatusTooManyRequests`；(c) 返回 500；(d) `AudioData` 为空且 `Words` 非空；(e) 非法 base64。对应 HTTP 适配器用 `httptest.Server` 返回上述状态码与 body |
| 期望行为与错误码 | 已配置供应商：超时 / 5xx / 429 必须返回 `E_TTS_UNAVAILABLE`（待落地错误码），仅当调用方显式 `allowEstimated=true` 时才允许降级估算；空音频不得保留 `source=tts` 的词表。未配置供应商：走估算路径并在响应标注 `words_source=estimated`。60s 预算与错误分类（可重试 / 永久）必须区分 |
| 断言对象 | `words_source` 返回值；IR 中 words 的 `source`；响应错误码；未引用语音对象是否残留；合成调用是否发生在 DB 事务之外 |
| 当前代码状态 | **② 适配器 + 事务外两阶段在位，降级语义与错误分类不符合设计**。HTTP 适配器非 200 / 解码失败 / base64 失败均返回 error（[代码] `adapters/tts/tts.go:59-88`）；两阶段 `SetScript`：Phase 1 在无行锁下跑 `deriveWordsUnlocked`，Phase 2 才进 `Mutate` 短事务（[代码] `app/service.go:487-491,496-509`），外部合成已不在行锁事务内。**缺口**：derive 捕获 TTS 错误后只 `log.Warn` 回落估算（[代码] `app/service.go:559-560`），不区分「未配置」与「已配置供应商故障」，也无 `allowEstimated` 入参（设计 §6.3）；空音频分支：`AudioData` 为空但非空 words 仍被打 `WordSourceTTS` 保留（[代码] `app/service.go:569-574,576-580`，`AudioKey=""`）；无 429 专属分类、无退避重试。受缺口阻塞：显式降级开关、错误码映射、空音频一致性校验（事务外两阶段已不再阻塞） |
| 优先级 | P0 |

#### F-ALN-01 Aligner 失败 / 返回错序时间戳（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | Aligner sidecar 超时 / 5xx；返回词表乱序、时间重叠、`end ≤ start`、词数与脚本切片对不上；服务侧静默回退估算 |
| 触发方式（注入手段） | 假 Aligner 返回：(a) 错误；(b) `[{end:1,start:2}, ...]` 倒置；(c) 相邻词区间重叠；(d) 词文本与脚本无映射关系；(e) 词数多于脚本字符数 |
| 期望行为与错误码 | 供应商故障且未允许估算 → `E_ALIGNER_UNAVAILABLE`（待落地）。返回词表必须过单调性 / 不重叠 / `end>start` 校验；词文本必须经确定性对齐映射回 script，不得信任供应商顺序恰等于切片 |
| 断言对象 | 写入 IR 的 words 数组；Validate 拒绝记录；`words_source`；响应错误码；锚点解析结果是否基于错序时间戳 |
| 当前代码状态 | **② 部分覆盖**。Aligner HTTP 适配器非 200 / 解码失败返回 error（[代码] `adapters/aligner/aligner.go:52-82`）；service 侧错误同样只 warn 回落估算（[代码] `app/service.go:597-599`）；60s 独立超时预算（[代码] `app/service.go:587-590`）。写出前 `Validate` 会拒绝乱序 / 重叠 / `end≤start`（[代码] `app/ir.go:213-227`），即结构非法词表在 Mutate 尾部被拦截；但词文本与 script 的映射校验、错序但区间合法的词表、错误到 `E_ALIGNER_UNAVAILABLE` 的码映射均不存在。受缺口阻塞：script 映射校验、错误码、显式降级开关（与 F-TTS-01 共用缺口） |
| 优先级 | P1 |

---

### 6.3 并发、版本与提交幂等类故障

#### F-VER-01 IR 版本冲突 / 并发写同一项目（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | 两个 Agent / 客户端并发 `PUT /ir` 或并发 MCP 写操作；后写者携带过期 `expected_version`；乐观锁被绕过导致覆盖丢失 |
| 触发方式（注入手段） | 两并发 goroutine 对同一项目先后调用 `Mutate`，第二个携带旧 version；DB 集成测试内复现；另测 `SetScript / SetWords / AddEffectAtWord / UpsertElement / AnimateElement / MoveElement / SetAudio` 全部经同一 `Mutate` 入口 |
| 期望行为与错误码 | 冲突统一 409 `E_VIDEO_VERSION_CONFLICT`；行锁 + version 校验在同一事务；冲突方不保留任何已执行一半的副作用；审计 `video.project.mutation_failed` |
| 断言对象 | `video_project.version`；响应错误码；审计记录；两并发事务最终 IR 内容 |
| 当前代码状态 | **① Mutate 路径已实现并有 DB 测试**。`SELECT ... FOR UPDATE` + `expectedVersion` 比对（[代码] `app/service.go:184-221`）；冲突错误码 `E_VIDEO_VERSION_CONFLICT`（`service.go:30,279`）；DB 集成测试 `TestIntegration_OptimisticLockConflict`（[代码] `app/service_db_test.go:193-215`）；全部写方法经 `Mutate` 闭包（`service.go:668-773`）。**遗留 ③**：行级 `script` 冗余列仍在迁移 1005（[代码] `cmd/app/migrations/1005_video_project.up.sql:7`），IR 内 `version` 字段（[代码] `app/ir.go:147`）与行 version 双真值未消除（架构 §0.2 P0、D11）；`SubmitRender` 也校验 version（[代码] `app/service.go:805-806`），但渲染快照不含项目 version 字段比对的 DB 约束。可执行待测：并发冲突集成测试（补 second-goroutine 用例）；受缺口阻塞：双真值清理 |
| 优先级 | P0 |

#### F-IDM-01 重复提交（Idempotency-Key 相同 / 缺失 / 换 key 重试）（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | 网络超时后客户端重放同一渲染提交；两次请求应产生同一 render 行、同一 River job、只扣一次配额。DB 层去重已闭环，River 层去重分工与中间态回放尚未定义 |
| 触发方式（注入手段） | (a) 同一路由连续 POST 两次，带相同 `Idempotency-Key`；(b) 不带 key；(c) 第一次超时后换 key 重试；(d) DB 已提交、River 未入队 / 入队后崩溃的中间态回放。DB 断言：`video_render` 行数、配额计数、River job 数、唯一索引冲突回放路径 |
| 期望行为与错误码 | 相同 submission key 返回既有 render（200 / 既有 202 状态）；缺失 key 的行为按策略拒绝或允许非幂等历史行；同 key 重放不重复 `ConsumeWithTx`、不重复 `InsertTx`；幂等记录与 render 行、配额、job 同一事务；DB 索引去重与 River job 去重的分工（唯一键、冲突时 job 复用还是重建）明确 |
| 断言对象 | `video_render` 行数与 `submission_key`；配额消费计数（含 replay 不计新消费）；River `UniqueOpts` 参数；响应 renderID 是否一致；中间态下 job 不重复创建 |
| 当前代码状态 | **② DB 层幂等 + 事务原子性已实现；River 层去重分工未定义，跨层重试无测试**。已具备：handler 读取 `Idempotency-Key`（trim + 128 字符截断）并传入 service（[代码] `adapters/http/routes.go:206-213`）；service 签名携带 `submissionKey`（[代码] `app/service.go:788`）；单事务内 `ConsumeWithTx(..., submissionKey)`（`service.go:816-822`），写 `submission_key` 与 `quota_period`（`service.go:835-840`）；配额侧 `ErrIdemReplay` 直接回放既有行（`service.go:823-829`）；DB 唯一索引冲突同样回放（`service.go:847-850`；迁移 `1009_video_render_idem.up.sql:8-12` 部分唯一索引 `uq_video_render_submission`）。**缺口**：入队仅传 `Queue`，未传 River `UniqueOpts`（[代码] `app/service.go:853-855`）；「DB 唯一索引去重」与「River 层 job 去重」的分工未定义；同 key 重试在 DB 已提交、River 未入队 / 入队后崩等中间态的跨层行为无测试。受缺口阻塞：River UniqueOpts 策略、跨层中间态回放测试 |
| 优先级 | P0 |

---

### 6.4 Worker 生命周期与配额故障

#### F-WKR-01 Worker 中断、进程崩溃（插入后崩、出片后崩）、River rescue（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | (a) 入队后、worker claim 前进程崩溃；(b) 渲染中途崩溃；(c) 输出已 Put 但 DB 终态事务提交前崩溃；(d) DB commit 后 River `JobCompleteTx` 前崩溃；(e) soft-stop 取消在途任务；(f) River rescue stuck job；(g) 终态被重复执行 |
| 触发方式（注入手段） | 假 store / 假 pipeline 状态机测试；DB 集成测试中：在各阶段 `os.Kill` 或返回 ctx canceled；构造 `running` 超时行由 `SweepOrphans` 回收；模拟 River discarded / cancelled 状态；重复投递同一 job 观察终态短路 |
| 期望行为与错误码 | 终态幂等：重试进入已 succeeded / failed 行必须短路，不重复 Put、不重复释放配额；中断（ctx canceled）走脱离取消上下文的补偿事务，行回 queued / retryable 保留配额；永久错误终态 failed + 释放原周期配额 + `JobCompleteTx`；reconciler 对照 River discarded / cancelled 补业务终态，不仅凭行时间猜测 |
| 断言对象 | `video_render.status` 迁移路径；配额释放次数；对象存储输出对象是否重复；River job 终态；heartbeat / progress；审计事件 |
| 当前代码状态 | **② 状态机与隔离客户端已实现，真实管道为编译桩，崩溃注入未对 DB 闭环**。已具备：终态短路（[代码] `render/worker.go:163-166`）；条件 UPDATE `status IN ('queued','running','interrupted')` + 0 行 → `ErrTerminalSkip`（[代码] `render/store.go:38-53`）；中断补偿使用 `context.WithoutCancel` 派生 10s 事务（[代码] `render/worker.go:206-208`）；失败终态 `JobCancel` 防重试（`worker.go:225-227`）；单测覆盖 succeeded / invalid IR / pipeline failure / missing row / terminal 短路 / 恰好一次释放 / 中断补偿（[代码] `render/worker_test.go:186,226,241,259,298,318,333,347`）；独立 video River client，`JobTimeout=15min`、`MaxAttempts=2`、`SoftStopTimeout=JobTimeout`、`RescueStuckJobsAfter=JobTimeout+15min`，runner `StopWait=JobTimeout+1min`（[代码] `cmd/app/main.go:1278-1308`）。**缺口**：默认构建 `stub.go` 返回 `ErrNotConfigured`，真实管道仅 `-tags capx` 编译（[代码] `render/stub.go:17-19`；`render/render_pipeline.go:1-2`）；无 reconciler 对照 River 状态补终态（`SweepOrphans` 仅按 `updated_at` 10min 猜测，[代码] `render/worker.go:283-286`，与架构 §8.2「不得仅按视频行时间猜测」不符）；无 `heartbeat_at` 列（迁移 1006 / 1009 无该列），progress 仅 `updated_at=now()`（[代码] `render/store.go:39-45`）；崩溃注入测试全部基于假 store，未对真实 PG + River 跑。受缺口阻塞：reconciler、heartbeat 列与节流更新、真实 DB 崩溃注入、capx 管道在 CI 的编译与运行 |
| 优先级 | P0 |

#### F-QTA-01 配额跨月（月初扣费、月末失败释放、终态重复释放）（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | 月末最后一刻提交、次月失败释放，计入新周期导致错账；终态重复执行二次释放；消费与 render 行 / job 不在同一事务，插入失败后补偿释放遗漏；hard quota 阻断码错误 |
| 触发方式（注入手段） | 时钟 seam 推进到月末 23:59:59 与次月 00:00:01；测试：(a) 扣费后插入行失败；(b) 失败终态跑两次；(c) 跨月失败释放；(d) 额度耗尽提交。断言配额表周期计数、释放目标周期、释放次数 |
| 期望行为与错误码 | 提交时固定 `quotaPeriod`，释放必须回到原周期；消费、render 行、River job 同一 DB 事务；终态释放同事务、只释放一次；hard 模式 402 `E_QUOTA_EXCEEDED`；replay 不视为新消费 |
| 断言对象 | 配额周期键与计数；`video_render.quota_period`；释放调用次数与目标周期；事务边界（消费是否在 tx 内）；并发下计数一致性 |
| 当前代码状态 | **② Tx 配额端口、周期固化、单次释放防护已实现；跨月时钟 seam 与错误码映射测试缺失**。已具备：`ConsumeWithTx` / `ReleaseTx` 端口（[代码] `app/ports.go:79,83`；`Release` 仅为非 Tx 降级 `:85`）；提交在同一事务内扣费（[代码] `app/service.go:816-822`）；`quota_period` 列提交时固定（迁移 `1009_video_render_idem.up.sql:18-19`；`app/service.go:814,840`）；释放按行内固定周期回填，`ReleasePeriod` 读行内 `quota_period`（[代码] `render/store.go:80-98`）；终态单次释放防护 + 单测 `TestWorker_FailFlow_ExactlyOneQuotaRelease`（[代码] `render/store.go:55-73`；`render/worker_test.go:333-346`）。**缺口**：仅内存降级路径（无 store 的 fake 模式）用 `now` 取周期（[代码] `render/worker.go:376-380`）；无月初 / 月末时钟 seam 测试；app 层无 `E_QUOTA_EXCEEDED` 映射测试（底层 quota 适配器透传）。受缺口阻塞：跨月时钟 seam、错误码映射测试（Tx 原子性与周期固化已不再阻塞） |
| 优先级 | P0 |

---

### 6.5 授权与输入安全类故障

#### F-AUTH-01 越权：PAT 跨 workspace、member 无 video:write、MCP video 用 session 凭证、fileID 解码后跨租户（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | (a) PAT 携带 scope 但指向非授权 workspace；(b) 普通 member 无 `video:write` 却调用写工具；(c) session 凭证调用 MCP video 工具（设计要求 MCP video 仅 PAT）；(d) 文件访问凭 key 前缀通过校验后读到他租户对象；(e) REST 与 MCP 授权路径不一致 |
| 触发方式（注入手段） | 构造四类 Principal：member 无 video:write、PAT 跨 ws、session source 调 MCP、PAT-all 无 scope；对每个写 / 读工具与文件端点发请求；DB 中置 foreign workspace 项目与对象，断言返回 403 / 404 且不泄露存在性 |
| 期望行为与错误码 | REST：路由级 `authz.Require(video:read|write|render)` + service membership；MCP：PAT-only，scope + 角色 + workspace scope 三重校验；跨租户资源返回与不存在相同的 404（不泄露存在性）；文件授权必须追溯到 asset / render 行 + 项目归属，不凭前缀 |
| 断言对象 | HTTP 状态码与错误码；Principal source / scope / workspace 记录；DB 行归属；MCP tool 入参路径；文件 handler 查询的归属表 |
| 当前代码状态 | **② REST 角色门 + membership + MCP PAT-only/scope 在位；service 层无 CanIn 角色决策、文件授权无前缀之外的 DB 归属校验**。已具备：REST 路由注册 `authz.Require` 三个权限键（[代码] `adapters/http/routes.go:75-88`）；service `canAccess` membership 校验（[代码] `app/service.go:168-177,187`）；跨 workspace `Get` 走 workspace 谓词返回 404（[代码] `app/service.go:408-413`；DB 测试 `service_db_test.go:185-190`）；MCP 每个工具经 `mcpAdd` 调 `requireToolScope`（[代码] `adapters/mcp/tools.go:305-318`）：非 PAT session 拒绝（`tools.go:333-335`），PAT scope 缺失拒绝（`tools.go:336-338`）。**缺口**：app 端口没有 `Authorizer / authz.CanIn` 接口，service 只调 `Membership.IsMember`，workspace 内角色权限（member 无 `video:write`）在 MCP 路径不经过 `authz.CanIn`（[代码] `app/ports.go:91-93`，对比 REST 路由层 `routes.go:76-77`）；PAT workspace scope 校验（`X-Workspace-Id` 必须在 PAT 授权范围）无测试落点；文件 handler 解析前缀 wsID 后只查 membership，不查 asset / render / project 行归属（[代码] `adapters/http/routes.go:272-283,297`），且无资产登记表支撑归属查询（见 F-TRA / §11 缺口）。受缺口阻塞：service 层 CanIn 端口、PAT workspace scope 校验、文件 DB 归属表与查询（MCP PAT-only 已不再阻塞） |
| 优先级 | P0 |

#### F-TRA-01 路径穿越 / fileID 伪造（base64url 畸形、多段 key、`../`）（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | 请求路径含 `..`、多段 key、畸形编码；key 被拼接到本地存储路径后越出数据目录；fileID 应为不透明标识，当前直接暴露对象 key |
| 触发方式（注入手段） | 请求 `/api/video/files/video/ws1/../../etc/passwd`、`video/ws1/..%2f..%2f`、空段、单段、三段以上、非法 base64url；Local 与（如配置）S3 后端分别断言；检查存储层路径拼接是否做 `filepath.Clean` / 前缀校验 |
| 期望行为与错误码 | 非法标识 → 404 `E_VIDEO_ASSET_NOT_FOUND`（与不存在不可区分）；解码后 key 必须通过 key 白名单校验 + DB 归属 + workspace 谓词；不接受原始对象路径 |
| 断言对象 | 解析出的 wsID 与 key；本地文件系统是否出现数据目录外读取；响应状态；日志是否泄露路径 |
| 当前代码状态 | **② 存储层 key 校验存在，视频文件 handler 未调用校验；无不透明 fileID 层**。`storagex.ValidKey` 拒绝空段、`.`、`..` 段（[代码] `platform/storagex/storagex.go:51-71`）；投影预览解析走 `ValidKey`（[代码] `app/projector.go:39-47`）。**缺口**：`handleFile` 直接把路径段交给 `Store.Open`，前置不调用 `ValidKey`（[代码] `adapters/http/routes.go:273-297`）；`workspaceFromKey` 只切前两段（[代码] `routes.go:332-338`）；当前路由是 `{key...}` 原始多段路径（`routes.go:88`），不是架构 §10.1 设计的不透明 base64url fileID；无资产 / render 归属表兜底。Local 存储实现是否在 `Open` 内再做 clean / 前缀断言，[待验证] 验证命令：读 `platform/storagex` Local.Open 实现 + 用穿越 key 跑 `routes_test.go` 风格用例。受缺口阻塞：handler 前置 key 校验、fileID 签发 / 解码层、DB 归属校验 |
| 优先级 | P1 |

#### F-MIME-01 文件类型伪造（MIME 猜错、SVG、polyglot、扩展名与实际内容不符）（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | 声明 `image/png` 实为 SVG / HTML / 可执行字节；polyglot 文件（PNG 头内嵌脚本）；扩展名 `.png` 但 body 是音频；MIME 由浏览器猜测导致内联渲染非图像内容 |
| 触发方式（注入手段） | 构造 6 组样本：真 PNG、SVG 文本声明 png、HTML 声明 png、PNG 头 + JS body、WAV 字节声明 jpeg、超大像素 GIF；分别走 REST multipart 与 MCP base64；断言服务端校验拒绝点与最终 Content-Type / Content-Disposition |
| 期望行为与错误码 | 同时校验扩展名、声明 MIME、magic bytes、实际解码；图片仅 PNG / JPEG / WebP 白名单；SVG / HTML 不作为普通图片内联；类型不符 → `E_VIDEO_ASSET_UNSUPPORTED`；响应 `X-Content-Type-Options: nosniff`，脚本类型一律 attachment |
| 断言对象 | 上传拒绝记录；落库 ContentType；响应头；投影 DOM 中元素标签与 src；对象 key 扩展名 |
| 当前代码状态 | **③ 内容校验缺失，仅有声明类型白名单与响应头**。已具备：MIME 声明白名单（[代码] `app/service.go:1016-1021`）；大小上限（`service.go:1013-1015`）；响应 `nosniff`（[代码] `adapters/http/routes.go:316`）；SVG / HTML 走 attachment（`routes.go:27-33,319-321`）；SVG 不在上传白名单内。**缺口**：无 magic bytes 嗅探、无解码校验、无扩展名与内容一致性比对、无像素 / 解压上限；MCP base64 解码失败映射为 unsupported（[代码] `adapters/mcp/tools.go:232-235`），但解码后内容仍不校验。受缺口阻塞：文件签名识别、图像解码验证、内容类型与扩展名一致性断言 |
| 优先级 | P1 |

#### F-SIZE-01 超大 IR（>256 KiB、elements 64、words 2000、单元素 16 动画）（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | IR JSON 超限、元素 / 词表 / 动画计数超限；接近上限时渲染内存与帧耗时失控；内联解码资产字节总量无上限 |
| 触发方式（注入手段） | 程序化生成 IR：(a) 257 KiB JSON；(b) 65 个 elements；(c) 2001 个 words；(d) 单元素 17 个 animations；(e) 边界合法值 64 / 2000 / 16 必须通过。断言 Validate 拒绝字段与错误信息 |
| 期望行为与错误码 | 超限 → 400 `E_VIDEO_INVALID_IR`（当前实现码 `E_VIDEO_IR_INVALID`，[代码] `app/service.go:291`）；列表上限与字节上限在写时严格校验；解码后资产字节 / 像素总量独立于 JSON 长度设限 |
| 断言对象 | `Validate` 返回的 `ValidationError.Field`；IR marshal 字节数；服务端请求体上限；投影后 DOM 节点数 |
| 当前代码状态 | **① 结构计数与 JSON 字节上限已实现并有单测**。常量上限（[代码] `app/ir.go:179-185`）；script / words 计数（`ir.go:228-233`）；effects（`ir.go:249-269`）；elements 与单元素动画（`ir.go:270-277,352-378`）；marshal 字节 ≤256 KiB（`ir.go:290-295`）；单测 `TestValidate_ListLimits`（[代码] `app/ir_test.go:143`）。**遗留 ③**：内联 / 上传资产的解码后字节总量、像素总量上限未实现（架构 §5.2 规则 8），与 F-RES-01、F-MIME-01 共用缺口。可执行待测：边界值 / 越界值参数化单测（纯函数，无需 DB） |
| 优先级 | P1 |

#### F-DIM-01 奇数尺寸（1×1、1081×1921）与产品侧偶数白名单缺失（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | 奇数宽 / 高进入 yuv420p / libx264 编码失败；产品侧未限制偶数尺寸与标准分辨率白名单；1×1 极端尺寸应在产品层拒绝而非交给 FFmpeg pad 兜底 |
| 触发方式（注入手段） | IR meta 分别取 `1×1`、`1081×1921`、`720×721`、合法 `1080×1920`；先过 `Validate`，再走 capx `FrameSpec.Validate` 与 `EncodePNGStream`；记录 FFmpeg 退出码与 stderr tail |
| 期望行为与错误码 | 产品层：非偶数或不在白名单 `{1080×1920, 1920×1080, 1080×1080}` → 400 `E_VIDEO_INVALID_PARAMS`；capx 通用层对奇数输入 pad 到偶数并有独立测试；1×1 在产品层拒绝 |
| 断言对象 | Validate 拒绝字段；FrameSpec；FFmpeg 输出尺寸；编码错误是否带尺寸信息；pad 后实际宽高 |
| 当前代码状态 | **② capx 通用层偶数拒绝 + 编码兜底在位；产品层 IR 偶数校验与标准分辨率白名单缺失**。已具备：`FrameSpec.Validate` 显式拒绝奇数宽高（[代码] `platform/capx/renderer.go:76-85`，奇数分支 `:80-81`）；编码侧 `scale=trunc(iw/2)*2:trunc(ih/2)*2` 截断兜底（[代码] `platform/capx/encode.go:74-78`）。**缺口**：IR 层 `validateMeta` 只查 360–2160 范围，无偶数校验、无标准分辨率白名单（[代码] `app/ir.go:300-316`）；1×1 极端尺寸未在产品层前置拒绝；编码 fixture 仍用 2×2 偶数 PNG（[代码] `platform/capx/encode_test.go:35-37`）。受缺口阻塞：产品层偶数 + 白名单校验、1×1 拒绝路径与对应单测 |
| 优先级 | P1 |

#### F-ASS-01 无 libass（BurnSubtitles 降级软字幕、warnings 而非 error）（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | FFmpeg 构建无 libass，烧字幕应降级为软字幕（mov_text）并在 render 记录 warnings，不报错；软字幕必须真正封装进 MP4；无字幕模式不构造不存在的输入滤镜 |
| 触发方式（注入手段） | (a) 在有 libass 的 FFmpeg 上跑 burn；(b) 构造无 libass 的 ffmpeg shim（`-filters` 不含 `subtitles`）跑 burn；(c) soft 模式检查 MP4 字幕轨；(d) 无 voice / 无 BGM / 仅 voice / 仅 BGM 分支 |
| 期望行为与错误码 | libass 缺失 → 降级 soft + `warnings` 条目，状态仍 succeeded；降级不进入 `error`；soft 字幕轨可被播放器识别；滤镜输入分支与实际音频轨匹配 |
| 断言对象 | `video_render.warnings`；MP4 字幕轨（ffprobe）；最终 MP4 滤镜链；无损坏输出被重复 mux |
| 当前代码状态 | **② libass 探测与错误哨兵存在，降级 soft 链路未闭环**。`ffmpegHasSubtitles` 探测 + `ErrNoLibass`（[代码] `platform/capx/encode.go:190-193,211-224,267-275`）；单测 `TestBurnSubtitles_NoLibassDegrades`（[代码] `platform/capx/encode_test.go:171`）。**缺口**：管道 burn 分支捕获 `BurnSubtitles` 错误后直接返回失败，未降级 soft（[代码] `render/render_pipeline.go:214-223`）；soft 模式仅写临时 SRT 文件，未把字幕封装进 MP4（`render_pipeline.go:107-122`，注释自承「soft subs ride inside the mp4 via the mux step in a follow-up」，`render_pipeline.go:212-213`）；render 行无 `warnings` 列（迁移 1006）；SRT 实现写 LF 行尾，注释自称 CRLF（[代码] `app/subtitle.go:172-173` 注释 vs `:181` 实现），libass 对 LF 通常容忍但无行尾断言；混音 `amix=duration=first`，无 `apad / aresample / BGM loop / loudnorm`（[代码] `platform/capx/encode.go:152-178`）。本机 FFmpeg 实测含 `subtitles` 滤镜（[实测] 2026-11-15 `ffmpeg -filters` 命中 `.. subtitles V->V ... libass`）。受缺口阻塞：soft 字幕封装、warnings 列与写入、降级分支测试、混音链补齐 |
| 优先级 | P1 |

---

### 6.6 并发容量、渲染语义与确定性故障

#### F-POOL-01 并发渲染上限（PoolSize 必须是硬信号量）（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | 多 job 并发到达时，空闲池为空即无限 launch 新浏览器实例；在途实例数超过 `PoolSize`；launch 超时与长渲染生命周期混淆；Close 后仍有实例泄漏 |
| 触发方式（注入手段） | 以 PoolSize=2 并发提交 N=6 个渲染 job；观测在途 browser 进程 / 实例句柄峰值 ≤2；launch 注入慢实例验证 20s launch 上下文不覆盖长渲染；Close 后枚举子进程与句柄 |
| 期望行为与错误码 | PoolSize 为带 context 的硬信号量：超过上限的 job 排队等待，不新增实例；空闲 channel 只负责复用；launch 上下文与渲染上下文分离；Close 完整释放 allocator / browser / tab |
| 断言对象 | 在途实例计数；浏览器子进程数；排队 job 数；`/dev/doctor` 池配置；进程 / 句柄泄漏基线 |
| 当前代码状态 | **② 硬信号量已实现；在途实例计数 / 进程泄漏断言与上下文分离测试缺失**。已具备：`sem` 信号量声明（[代码] `platform/capx/capx.go:102-105`），`poolInit` 中按 PoolSize 初始化（`capx.go:182-185`）；`acquire` 先取槽（ctx 可取消）再 launch（`capx.go:187-191,193-197`），launch 失败释放槽（`capx.go:194-197`），归还时释放槽（`capx.go:198-201`）；空闲 channel（`capx.go:99`）只做暖实例复用，不承担上限。**缺口**：无在途实例计数与浏览器子进程 / 句柄泄漏断言测试；launch 上下文与长渲染上下文分离无测试；Close 释放路径（`capx.go:271-300`）未配泄漏基线。受缺口阻塞：并发峰值压测断言、进程 / 句柄泄漏基线、生命周期分离测试（信号量本身已不再阻塞） |
| 优先级 | P1 |

#### F-XSS-01 预览 XSS 与 postMessage（`</script>` 注入、U+2028/2029、错 origin、错 source、畸形消息）（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | IR 文本闭合 JSON 块注入脚本；行分隔符 U+2028 / U+2029 破坏脚本上下文；iframe 收到非同源、非自身 source、畸形 schema 的消息；CSP 被绕过加载外部资源 |
| 触发方式（注入手段） | 文本样本：`</script><script>alert(1)</script>`、含 U+2028 / U+2029 的词文本、`javascript:` URL、外部图片地址；postMessage 样本：错 origin、正确 origin 错 source、`{}` 空消息、`{type:"player",cmd:"unknown"}`、`{type:"player",cmd:"seek",frame:"abc"}`、frame 字段缺失 |
| 期望行为与错误码 | JSON 块不可被闭合；IR 放在 `script[type=application/json]`，不进 script-src；CSP hash 锁定内联脚本；消息处理同时校验 `event.origin === location.origin`、`event.source === iframe.contentWindow`、schema 与 frame 数值类型；外部请求在渲染路径被网络锁阻断 |
| 断言对象 | 投影 HTML 中数据块转义；CSP 头；DOM 无注入 `<script>`；消息 listener 校验分支；`__player` 状态未被畸形消息改写；网络阻断记录 |
| 当前代码状态 | **② `</script>` 转义与 origin 校验在位；source 校验、U+2028/2029 用例、schema 校验缺失**。已具备：`encoding/json` 默认转义 `< > &` + `escapeJSONBlock` 闭合 `</`（[代码] `app/projector.go:187,209-213`）；注入向量单测（[代码] `app/projector_test.go:49-67,89-112`）；CSP hash 与 `frame-ancestors 'self'`、`nosniff`（[代码] `adapters/http/routes.go:183-187`；`app/projector.go:107-118`）；渲染路径网络全阻断（[代码] `platform/capx/renderer.go:152-159`）；消息 listener 校验 origin（[代码] `app/timeline-builder.js:218-219`）。**缺口**：不校验 `event.source`（`timeline-builder.js:218-228`，对比架构 §10.4 要求双校验）；无 U+2028 / U+2029 转义或测试（`encoding/json` 不转义这两个码点；`projector_test.go` 无对应用例）；消息 schema 仅查 `msg.type`，cmd 分支不校验 frame 数值（`timeline-builder.js:221-223`）；父页面 → iframe 方向的消息校验在前端仓库，本域未覆盖。受缺口阻塞：source 校验、行分隔符转义 / 测试、消息 schema 与类型断言 |
| 优先级 | P0 |

#### F-SEE-01 seek 越界（负帧、超过 durationFrames、NaN）（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | 消息传入负帧号、超过总帧数、NaN / 非数值；时间轴被定位到非法位置后截图出黑帧或残留上一帧；capx 帧循环自身索引不越界，但 preview 消息路径不设防 |
| 触发方式（注入手段） | 直接调用 `__player.seek(-5)`、`seek(99999)`、`seek(NaN)`、`seek("12")`、`seek(undefined)`；截图对比帧状态与 `postState` 回传 frame |
| 期望行为与错误码 | 帧号先 `Number.isFinite` 校验，再 clamp 到 `[0, durationFrames-1]`；非法输入忽略并保留当前帧；回传状态 frame 合法；capx 循环索引天然在 `[0, DurationFrames-1]` |
| 断言对象 | `__player.durationFrames`；`tl.pause` 入参；回传 `frame`；截图帧与期望帧一致；无 NaN 传入 GSAP |
| 当前代码状态 | **② clamp 与单一口径 ceil 在位；NaN / 非数值未拦截**。`seek`：`Math.max(0, Math.min(durationFrames, Math.round(f)))`（[代码] `app/timeline-builder.js:189-191`）；但 `Math.round(NaN)=NaN`，clamp 链无法拦截 NaN，`tl.pause(NaN)` 未被挡住。帧数口径已统一为单一来源 `DurationFrames = max(1, ceil(max(meta.durationSec, voice.durationSec) × fps))`（[代码] `app/service.go:888-897`）；JS 同口径 `Math.ceil`（[代码] `app/timeline-builder.js:34-37`）；worker 与管道均调用 `app.DurationFrames`（[代码] `render/worker.go:183`；`render/render_pipeline.go:80`），历史 round / 截断分歧已消除。受缺口阻塞：NaN / 类型校验、跨层同源帧数回归断言 |
| 优先级 | P1 |

#### F-ANC-01 未解析锚点（effect reason=missing 被 skip vs 动画静默落到 0 帧）（P0）

| 字段 | 内容 |
|---|---|
| 故障场景 | 脚本重对齐后锚点无法匹配；effect 与 animation 的未解析行为不一致：effect skip 可观测，animation 静默落到第 0 帧，画面在片头出现本不该存在的运动；render 路径不 fail closed，产出「成功但内容缺失」的视频 |
| 触发方式（注入手段） | 构造 effect 与 animation 各一，锚定词在 words 表不存在；观察：(a) preview DOM / 时间轴；(b) render 输出帧；(c) `resolutions[]` 中 reason；(d) 切换脚本使既有锚点漂移为 nearest / missing。断言未解析动画是否出现在第 0 帧时间轴上 |
| 期望行为与错误码 | 未解析锚点在 render 前置环节明确失败或显式进入 unresolved 待修复状态，不得静默挂接；nearest 只能在显式 `repair=true` 策略下执行并记录距离与置信度；effect / animation 行为一致；响应与 render warnings 列出 unresolved 项 |
| 断言对象 | 时间轴上动画起始时间；`resolvedFrom.reason`；render 状态；第 0 帧截图与不含该动画的基线差异；resolutions 列表 |
| 当前代码状态 | **③ 动画未解析静默落 0 帧；effect skip 有报告但 render 不 fail closed**。已具备：解析四分支 exact / same_text / nearest / missing（[代码] `app/ir.go:507-524`）；`ResolveAll` 回写 `ResolvedFrom` 并产出 resolutions（`ir.go:560-605`）；effect `reason==='missing'` 在 builder skip（[代码] `app/timeline-builder.js:167`）。**缺口**：动画分支不检查 missing，`anchorTime` 在 `wordIndex<0` 时返回 0（[代码] `app/timeline-builder.js:69-73`），builder 仍以 `at=0` 挂载动画（`timeline-builder.js:168`）；`ResolveAnchors` 无候选时自动 nearest 挂到全局最近词（`ir.go:517-524`），不区分显式 repair；render 管道不对 unresolved 锚点 fail（`render/worker.go:173-177` 只校验 IR 结构，不查 resolvedFrom）；无稳定 `wordId`，锚点身份仍是文本 + index（基线 §2.1 已登记缺口）。受缺口阻塞：动画 missing 阻断 / 显式 unresolved 状态、nearest 显式开关、wordId 身份、render 前置 unresolved 校验 |
| 优先级 | P0 |

#### F-DET-01 渲染确定性（同镜像 100 次逐字节一致；跨镜像只做容差）（P1）

| 字段 | 内容 |
|---|---|
| 故障场景 | 同一固定镜像、同一 IR 重复渲染，PNG 逐帧 SHA-256 不一致（字体缓存、rAF 时序、随机数、wall-clock、标签顺序导致）；跨 OS / Chrome 版本被错误要求 bit-identical；golden 基线不可复现 |
| 触发方式（注入手段） | 固定镜像内同一 doc 连跑 100 次，逐帧比较 PNG SHA-256；检查 Player 是否使用 `Date.now`、`Math.random`、wall-clock timer 作为画面来源；跨镜像（本机 Windows vs Linux CI）跑同案例，按容差阈值比对；recipe 记录 Chrome / FFmpeg / 字体 / GSAP digest |
| 期望行为与错误码 | 同镜像：100 次逐帧字节一致；跨镜像：仅视觉容差（MAE / SSIM 阈值，见 §7.5），不承诺 bit-identical；双 rAF 只是同步经验手段，不作为数学保证；recipe 足以复现一次出片 |
| 断言对象 | 逐帧 PNG SHA-256 序列；DOM 中随机源调用；recipe 版本字段；跨镜像帧差异分布 |
| 当前代码状态 | **② 确定性机制在位，规模与 recipe 不足**。已具备：包契约声明同机同输入字节一致（[代码] `platform/capx/capx.go:22-29`）；`lagSmoothing(0)` + paused timeline（[代码] `app/timeline-builder.js:187`）；固定 seek + 双 rAF（[代码] `platform/capx/renderer.go:263-270`）；现有确定性单测仅 2 次运行、3 帧、320×180（[代码] `platform/capx/renderer_test.go:112-141`）。**缺口**：无 100 次重复运行；无随机源 / wall-clock 静态扫描测试；字体未内联（见 F-FNT-01），跨机器字形差异无 recipe 约束；render recipe 结构未落库（迁移 1006 无 `render_recipe / ir_sha256` 列）；GSAP 版本为 vendored 3.13.0（[代码] `platform/capx/capx.go:34` 注释），未在 recipe 记录 digest。受缺口阻塞：100× 一致性跑批、随机源扫描、recipe 版本记录、跨镜像容差基线 |
| 优先级 | P1 |

---

### 6.7 状态汇总

**① 已实现并有证据（核心路径可复核）：**

- F-VER-01 Mutate 乐观锁与 409 冲突（`service.go:184-221`；`service_db_test.go:193-215`）
- F-SIZE-01 IR 结构计数与 256 KiB 字节上限（`ir.go:179-185,228-233,249-277,290-295,352-378`；`ir_test.go:143`）
- F-WKR-01 worker 状态机、终态短路、中断补偿、独立 River client 与 drain 窗口（`worker.go:163-166,206-208`；`store.go:38-53`；`main.go:1278-1308`；`worker_test.go:186,226,241,259,298,318,333,347`）
- F-QTA-01 Tx 配额端口、周期固化、单次释放防护（`ports.go:79,83`；`store.go:80-98`；`worker_test.go:333-346`）
- F-XSS-01 `</script>` 转义、注入向量单测、CSP hash、渲染网络阻断（`projector.go:187,209-213`；`projector_test.go:49-67,89-112`；`renderer.go:152-159`）
- F-IDM-01 DB 幂等列 + 唯一索引 + 事务内扣费 / 行 / job（`1009_video_render_idem.up.sql:8-12`；`service.go:816-850`）
- F-POOL-01 PoolSize 硬信号量（`capx.go:102-105,182-201`）
- F-DIM-01 capx 层奇数拒绝 + 编码 trunc-to-even 兜底（`renderer.go:76-85`；`encode.go:74-78`）
- F-SEE-01 帧数单一口径 ceil，三消费者同源派生（`service.go:888-897`；`timeline-builder.js:34-37`；`worker.go:183`；`render_pipeline.go:80`）

**② 存在但为 stub / 降级 / 部分覆盖：**

- F-TTS-01 适配器 + 事务外两阶段在位；静默降级开关、429/5xx 分类、空音频一致性缺失
- F-ALN-01 适配器 + 结构校验在位；script 映射与错误码缺失
- F-WKR-01 真实管道为 `-tags capx` 编译桩；崩溃注入未对真实 DB 闭环；无 reconciler 与 heartbeat
- F-QTA-01 跨月时钟 seam 与 `E_QUOTA_EXCEEDED` 映射测试缺失
- F-IDM-01 River `UniqueOpts` 分工未定义；跨层中间态回放无测试
- F-POOL-01 在途计数 / 进程泄漏断言、上下文分离测试缺失
- F-DIM-01 产品层偶数 + 标准分辨率白名单缺失
- F-AUTH-01 REST 角色门 + membership + MCP PAT-only/scope 在位；service 层无 CanIn、PAT workspace scope 测试、文件无 DB 归属校验
- F-TRA-01 storagex key 校验在位；视频 handler 未调用、无 fileID 层
- F-ASS-01 libass 探测 + 哨兵在位；soft 封装与 warnings 未闭环
- F-SEE-01 NaN / 非数值类型校验缺失
- F-DET-01 确定性机制在位；100× 跑批、recipe、随机源扫描缺失
- F-RES-01 JS decode fail-closed 与 capx `__player.error` 探针在位；服务端素材预检、magic bytes、像素总量上限缺失

**③ 缺失（受缺口阻塞，阻塞点见各条目）：** F-FNT-01 字体子集与缺字检测；F-MIME-01 内容嗅探；F-ANC-01 未解析动画阻断；F-XSS-01 的 source 校验与 U+2028/2029 防护。

**计数（§6 共 19 条 F-ID）：** 上方 ① / ② / ③ 清单按「子路径状态」罗列，① 与 ② 存在子路径重叠，非独立计数；19 条 F-ID 的去重计数为 **19**。按主态（以各条目「当前代码状态」加粗标签为准，子项列入备注）去重：**① 2 条**（F-VER-01、F-SIZE-01）；**② 14 条**（F-RES-01、F-TTS-01、F-ALN-01、F-IDM-01、F-WKR-01、F-QTA-01、F-AUTH-01、F-TRA-01、F-DIM-01、F-ASS-01、F-POOL-01、F-XSS-01、F-SEE-01、F-DET-01）；**③ 3 条**（F-FNT-01、F-MIME-01、F-ANC-01；F-XSS-01 的 source 校验与 U+2028/2029 防护子项属 ③，主态仍为 ②）。上方 ① 清单中其余 7 条（F-WKR-01、F-QTA-01、F-XSS-01、F-IDM-01、F-POOL-01、F-DIM-01、F-SEE-01）为 ② 条目的已实现子路径备注，不重复计为主态 ①。按「是否存在可执行的已实现断言路径」粗分：已具备断言基础 10 条；仍受缺口阻塞、需先改代码或补测试夹具 9 条。精确阻塞清单见 §7.9 依赖图。

## 7. 分层真实执行计划

### 7.0 通用约定

**层级映射**：本节 L0–L5 与既有测试策略 `docs/testing-strategy.md` 的 lane 体系对齐——L0 对应其 L0（纯函数 / fake 单测，`make verify`）；L1/L2/L3 的 DB 部分对应其 L1（warm DB 集成）与 L2a（cold boot）；浏览器真实引擎对应其 L2d（real engine）原则：never a Node / stub stand-in。不另立测试体系。

**帧数公式（单一来源，L0–L5 断言均按此口径）：**

- `F = max(1, ceil(max(meta.durationSec, voice.durationSec) × fps))`，合法帧 `[0, F-1]`（[代码] `app/service.go:888-897` `DurationFrames`）。
- 三消费者同源派生：JS `Math.ceil`（[代码] `app/timeline-builder.js:34-37`）、worker（`render/worker.go:183`）、管道（`render/render_pipeline.go:80`）。历史 JS round / Go 截断分歧已消除；L0 保留同源回归断言，断言中记录公式版本即可。

> **[口径 round2] 时钟基准裁定（全案例库帧表唯一时钟条款，2026-11-15 第 2 批实测收口；依据 delivery-audit-video-studio-round2 §2"锚点口径错位"）**
>
> **裁定**：现实现下动画锚定**词时间戳**（`words[].start`，秒），词时间戳来源于 TTS/对齐——因此**本案例库所有预期帧表必须从词锚推导**：`frame = ceil(word.start × fps)`（JS `Math.ceil`，[代码] `app/timeline-builder.js:72-77` `anchorTime`：动画 `startAnchor` 与 effect 锚点解析出 `wordIndex` 后取 `words[wordIndex].start`，seek 时 `tl.pause(f/fps)`）。目标 schema 的 `startFrame`（按镜号编排的整数帧号）**只有在 §5.16 IR 扩展落地后才能作为第一时钟**；在此之前它只是编排意图的记录（"第二时钟"），与词锚推导值冲突时以词锚为准。
>
> **推导规则**（可复核算式，`frame = ceil(t × fps)`）：
> 1. 锚点解析出唯一 `wordIndex`（occurrence 按文档序选取候选；候选集 = concat 等值串首词 + 单词包含，[代码] `ir.go:464-490`）。
> 2. 取 `t = words[wordIndex].start`（秒，float64/IEEE-754 double），`frame = ceil(t × fps)`；乘积若因浮点表示落在整数边界附近（如 `9.2×25 = 229.999…`）按 double 实际值取整（`→230`），与 JS 渲染器行为一致——不引入 ε 修正。
> 3. **动画时长仍按帧计**：`durationFrames` 不换算秒，从锚帧起顺序消耗；"X 全可见/落定"类断言帧 = 锚帧 + durationFrames。
> 4. **词锚 miss 现状**：动画锚点解析失败（words 为空）时 `anchorTime` 返回 0——动画**静默落到 0 帧**（[代码] `timeline-builder.js:72-74`）；effect 锚点 `reason=missing` 则整条 skip（[代码] `timeline-builder.js:181`）。两者都不是错误，帧表对此现状照实标注，不判 fail（与 F-ANC-01 登记一致）。
> 5. FPS 取各案 `meta.fps`：C01/C04=30，C06=25。推导值永远相对锚词所在案的 fps，不跨案复用。
>
> **校准锚点**（第 2 批 L1 全帧渲染实测，推导方法必须复现这三条才算对齐；报告：`testdata/l1-c04-report.json`、`testdata/l1-c06-report.json`）：
> 1. **C04 三柱全可见 ≈F327**：bar22/bar23/bar24 生长锚分别为"二零二二"@6.6s→F198（6.6×30=198）、"二零二三"@8.7s→F261（8.7×30=261）、"二零二四"@10.1s→F303（10.1×30=303）；末柱 24 帧落定 → 303+24=**F327**（10.9s），实测"三柱最早同屏 ≈F327"吻合；帧表原值 F216 处实测仅 bar22 在生长（198+24 的 75%）。
> 2. **C06 说话人切换 onset=F232**：el_nameB 锚"窄场景"第 2 次@9.2s→F230（9.2×25=229.999…→230），12 帧姓名条 scaleIn 从 230 起；帧差探针实测 229→230 起序列抬升、**onset_frame=232**（首个超阈值采样帧，230±2 窗口内 in-window ✓）——词锚推导 F230 + 观测采样步长解释 F232，推导值 230 为口径值。
> 3. **C06 结论句 F2130**：el_endline 锚"返工"@85.2s→**F2130**（85.2×25=2130），帧表原值 2025 偏早 105 帧；§4.4.5 的二选一标注按本条款收口为词锚 F2130（见该节定稿记录）。
>
> **存量回填**：C01（§3.1.5）/ C04（§4.2.5）/ C06（§4.4.5）三张帧表已按本条款并排回填"词锚推导列"（`[口径 round2]` 标注；差异 >±30 帧的行加 ⚠️，是 M2 重新验收重点）。其余六案（C02/C03/C05/C07/C08/C09）的帧表在各自案例进入实测批次时按同一规则回填，不预填。

**像素比对算法与阈值（L1 / L3 / L4 / L5 通用，可计算数值，禁止目视放行）：**

- 分区 MAE：画面划 16 列 × 9 行网格；每格每 RGB 通道 `MAE = mean(|a-b|)`；通过条件：全部格子 MAE ≤ 2/255，全帧 MAE ≤ 4/255。
- SSIM：全帧 SSIM ≥ 0.98（Y 通道，窗口 8×8）。
- 静帧帧差 RMSE：`RMSE = sqrt(mean((a-b)²))` ≤ 3/255。
- 跨镜像容差放宽：全帧 MAE ≤ 6/255、SSIM ≥ 0.95；同镜像不放宽。
- DOM 断言：`getBoundingClientRect()` 四向误差 ≤ 1 px；`TextMetrics.width` 误差 ≤ 2 px；元素存在性 / 顺序 / z-index 必须逐项相等。

**案例规格（已回填；帧量唯一来源 = 架构 §2.1，下表为其推导）：**

| 案例 | 内容类型 | 分辨率 | fps | 时长（s） | 帧数 F=ceil(d·fps) |
|---|---|---|---:|---:|---:|
| VS-C01 | 短视频带货 | 1080×1920 | 30 | 15 | 450 |
| VS-C02 | 品牌发布 | 1920×1080 | 25 | 30 | 750 |
| VS-C03 | 知识科普 | 1080×1920 | 30 | 45 | 1350 |
| VS-C04 | 数据可视化口播 | 1920×1080 | 30 | 60 | 1800 |
| VS-C05 | 旅行生活方式 | 1080×1920 | 30 | 30 | 900 |
| VS-C06 | 访谈字幕 | 1920×1080 | 25 | 90 | 2250 |
| VS-C07 | 招聘 / 企业宣传 | 1920×1080 | 30 | 40 | 1200 |
| VS-C08 | 节日促销 | 1080×1080 | 30 | 20 | 600 |
| VS-C09 | 产品功能演示 | 1920×1080 | 30 | 50 | 1500 |

合计 **10800 帧**；逐案时长求和 = 380s（已核对：§2.1 求和各案时长 = 380s，与本节一致；原 360s 系主表笔误，已修正）。

**产物路径与留存（本机本地存储根 `VIDEO_DATA_DIR`，默认 `data/video`；测试产物落临时目录，golden 基线入仓库或专用基线目录）：**

- L0：无产物；失败样本仅日志。
- L1 golden：`testdata/golden/<case>/frame-<NNN>.png` + `meta.json`（案例 ID、帧号、口径、fps、分辨率、生成镜像 digest）。
- L2 / L3：`tmp/video-test/<case>/<run-id>/{frames/,output.mp4,thumb.jpg,srt.txt,report.json}`；运行结束清理，仅失败样本留存 30 天。
- L4：`testdata/golden/<case>/dom-<NNN>.json`（rect / metrics / z 序）+ 像素快照。
- L5：`tmp/video-test/perf/<run-id>/{digests.txt,profile.pprof,report.json}`；100× 一致性 digest 序列入 `testdata/golden/<case>/digests-100.txt`。

### 7.1 L0 单测 / 纯函数

| 项 | 内容 |
|---|---|
| 目标 | IR 校验、锚点解析、`BuildCues`、`DurationFrames` 同源一致性、字幕断行、参数白名单、投影 HTML 转义；全部 fake / 纯函数，不依赖 Chrome / DB |
| 样本量与来源 | 9 案例各取 1 份最小合法 IR 作为夹具；边界与越界样本由参数化生成（对照 F-SIZE-01、F-VER-01）。锚点样本覆盖 exact / same_text / nearest / missing、重复词 + occurrence、跨词拼接锚点 |
| 时长 / 分辨率 | 不渲染画面；纯内存。夹具分辨率取 §7.0 定稿表值，仅校验通过 / 拒绝 |
| 机器与依赖版本 | 本机 go1.27.0 windows/amd64（[实测] 2026-11-15）；无 Chrome / FFmpeg 依赖；Node v22.23.2（[实测]，仅在 JS 逻辑被抽取测试时使用） |
| 单次预期耗时 | 数量级：秒级。估算：现有 `go test ./internal/video/app` 纯函数用例数十个，单用例 <50ms；L0 全量目标 <30s（CI `-short` 内）。依据：纯函数无 I/O，耗时正比于夹具规模（IR ≤256 KiB） |
| 通过阈值 | 校验拒绝字段与错误信息逐项匹配；锚点 reason 与 wordIndex 精确相等；cue 行数 / 行长 ≤16 rune、≤2 行、单 cue ≤6s；`DurationFrames` 按 ceil 公式计算，JS / worker / 管道三消费者同源值一致；投影数据块不含未转义 `</script>`；全部断言可计算 |
| 失败判定 | 任一参数化样本结果与期望表不符；错误码 / 字段路径缺失；三消费者帧数不一致 |
| 产物路径 | 无持久产物；`report.json` 记录夹具 ID、版本、通过率 |
| 当前状态 | **可执行待测**。已存在：`ir_test.go`（校验 / 锚点 / cues / 估算词表）、`projector_test.go`（转义 / 注入向量）、`service_test.go`（降级矩阵 / 门序 / 参数归一）。待补：同源帧数参数化用例、U+2028/2029 转义用例（受 F-XSS-01 缺口约束的部分除外——转义实现缺失前测试会失败，先补实现再落断言） |

### 7.2 L1 still 单帧 golden

| 项 | 内容 |
|---|---|
| 目标 | 固定帧截图与 golden PNG 逐帧比对；验证投影 DOM、时间轴定位、字体 / 颜色 / 布局在关键帧正确；不跑完整编码 |
| 样本量与来源 | 每案例 8–12 个关键帧：首帧、入场动画帧、锚点词命中帧、特效峰值帧、尾帧；帧号取自案例分镜表（§4.5 预期帧表）。9 案例 × 10 帧 ≈ 90 帧 |
| 时长 / 分辨率 | 帧规格同 §7.0 定稿表（1080×1920 / 1920×1080 / 1080×1080）；单帧截图，不输出 MP4 |
| 机器与依赖版本 | 本机：Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`（[实测] 存在）；FFmpeg N-117763-ge35587250c-20241113（[实测]，L1 可不用）；Go 1.27.0。固定镜像见 §7.7 |
| 单次预期耗时 | 数量级：分钟级。估算：单帧 = 新 tab + `setDocumentContent` + ready 等待 + seek + 双 rAF + 截图；现有 `renderer_test.go` 3 帧用例在本机秒级；按每帧 1.5–3s（含 ready 60s 超时预算，正常路径远低于此）估，90 帧 ≈ 3–5 分钟。ready 超时上限 60s/文档（[代码] `renderer.go:111`），实测 warm 路径 <1s |
| 通过阈值 | §7.0 分区 MAE ≤ 2/255、全帧 MAE ≤ 4/255、SSIM ≥ 0.98；golden 首次生成时人工复核一次（矩形区域 + 前景占比），之后自动比对 |
| 失败判定 | 任一帧越过 MAE / SSIM 阈值；ready 超时；截图为空或非 PNG 前缀；golden 与当前 recipe 字体 / 分辨率 / fps 不一致 |
| 产物路径 | `testdata/golden/<case>/frame-<NNN>.png` + `meta.json`；失败帧留 `tmp/video-test/l1/<case>/` |
| 当前状态 | **部分可执行待测**。capx `RenderFrames` 与 Chrome 探测在位（`renderer.go:92-115`；`capx.go:246-258`），现有 `TestRenderFrames_ThreeFrames` / `Deterministic` 已驱动真实 Chrome（`renderer_test.go:75,112`）。受缺口阻塞的子场景：坏图帧的服务端预检与像素炸弹上限（F-RES-01 剩余缺口；JS decode fail-closed 探针已在位）、缺字帧（F-FNT-01）、未解析锚点帧（F-ANC-01）——这些帧在缺口修复前不应进入 golden 基线 |

### 7.3 L2 短片段 MP4（≤5s，验证编码与音轨）

| 项 | 内容 |
|---|---|
| 目标 | 验证 PNG 帧流 → libx264 编码 → MP4 封装；voice / BGM / 静音 / 仅 voice / 仅 BGM 混音分支；字幕 sidecar；不跑完整案例时长 |
| 样本量与来源 | 每案例截取 1 段 ≤5s 连续帧（首 5s）；另设 4 个合成音频分支样本（静音、仅 voice、仅 BGM、voice+BGM）。9 案例 + 4 分支 ≈ 13 段 |
| 时长 / 分辨率 | ≤5s；fps 同案例；标准偶数分辨率（1080×1920 / 1920×1080 / 1080×1080）。奇数尺寸样本仅作 F-DIM-01 拒绝路径测试，不进编码 golden |
| 机器与依赖版本 | 同 L1 + FFmpeg 实测版本；编码参数 CRF 18 / preset medium / yuv420p（默认值 [代码] `encode.go:60-65`） |
| 单次预期耗时 | 数量级：分钟级。估算：编码耗时 ≈ 帧数 × 单帧编码 + mux；5s@30fps = 150 帧、@25fps = 125 帧；案例段 7×150 + 2×125 = 1300 帧，4 音频分支 ×150 = 600 帧，合计 ≈1900 帧；libx264 medium 在 1080p 量级单帧约 20–50ms [待验证]，13 段编码 ≈ 2–5 分钟（不含 Chrome 截图，截图复用 L1 帧流） |
| 通过阈值 | MP4 含 `ftyp` 盒；帧数 = 输入帧数；视频时长 Δ ≤ 1 帧；音频轨：voice 存在且 RMS > 阈值（非静音误判），BGM 音量按 `bgm_volume` 缩放误差 ≤ 0.05；帧像素阈值同 L1；字幕轨（soft）存在且 cue 数 = `BuildCues` 输出 |
| 失败判定 | 无视频轨 / 帧数不符；音频轨缺失或静音；滤镜分支构造了不存在的输入；编码 stderr 含错误；输出尺寸与规格不符 |
| 产物路径 | `tmp/video-test/l2/<case>/output.mp4` + `report.json`（ffprobe 流信息、时长、码率） |
| 当前状态 | **部分可执行待测**。编码 / 帧协议 / 混音 / 字幕探测在位（`encode.go:50-115,147-183,206-235`；现有 `encode_test.go` 静音视频 / 缩略图 / 无 libass 降级用例）。受缺口阻塞：soft 字幕封装（F-ASS-01）、BGM loop / apad / 响度链（`encode.go:159-178` 现状）、跨月配额与原子提交不在本层断言（属 L3 DB 集成） |

### 7.4 L3 完整成片（9 案例全量）

| 项 | 内容 |
|---|---|
| 目标 | 端到端：IR 快照 → worker claim → capx 帧流 → 编码 → 混音 / 字幕 → 对象 Put → DB 终态 + 审计 + WS；验证配额、版本、状态机在真实 DB 上一致 |
| 样本量与来源 | VS-C01…C09 全量 9 段，合计 10800 帧（§7.0 定稿表，单案 450–2250 帧）；每案例含成功路径 + 1 条故障注入路径（F-WKR-01 对应子场景） |
| 时长 / 分辨率 | 全时长；规格见 §7.0 定稿表；输出 MP4 + thumb + 可选 SRT |
| 机器与依赖版本 | 同 L2；DB 用 `TEST_DATABASE_URL`（`make test-db` 口径）；River video 队列独立 client（`main.go:1279-1297`）；capx 构建标签 `-tags capx` |
| 单次预期耗时 | 数量级：半小时级。估算：帧循环每帧 seek+截图约 50–150ms [待验证]，编码单帧 20–50ms；10800 帧合计截图 ≈ 9–27 分钟、编码 ≈ 3.6–9 分钟；单案例耗时按帧数线性（最长 C06 2250 帧 ≈ 单案 3–6 分钟）。9 案例串行（Go worker MaxWorkers=1）全批 ≈ 15–40 分钟；并发上限受 F-POOL-01 在途计数 / 泄漏断言缺口约束（信号量本身已在位） |
| 通过阈值 | 终态 `succeeded`；输出对象存在且可 Range 读取；帧序列像素阈值同 L1；时长 Δ ≤ 1 帧；`ir_snapshot` 与提交时 IR 字节一致；审计事件齐全（created / completed）；WS 状态帧最终态正确；配额计数 = 成功提交数；失败路径释放恰好一次 |
| 失败判定 | 终态与对象存储不一致；重复输出对象；重复 / 缺失配额释放；快照被后续编辑污染；WS 旧状态覆盖新状态；故障注入后行卡死 running |
| 产物路径 | `tmp/video-test/l3/<case>/<run-id>/`；失败样本留存；report 含行 / job / 配额三者最终状态对照 |
| 当前状态 | **受缺口阻塞为主**。worker 状态机单测在位（`worker_test.go`），DB 幂等提交与 Tx 配额 / 周期固化已在位（F-IDM-01 / F-QTA-01 仅余 River 去重分工与跨月时钟测试）；真实管道默认构建为桩（`stub.go:17-19`）。阻塞项：reconciler + heartbeat（F-WKR-01）、资产登记表与文件归属（F-AUTH-01 / F-TRA-01）、recipe 落库（F-DET-01）。L3 中不依赖 DB 事务的纯渲染子路径（固定 IR → MP4）可先在 L2 规模跑通；端到端 DB 断言必须等剩余缺口关闭 |

### 7.5 L4 浏览器逐像素 / DOM golden

| 项 | 内容 |
|---|---|
| 目标 | 在真实浏览器内读取 DOM 几何与文本度量，与 golden JSON 比对；补充像素快照；验证元素位置、层级、文本宽度、counter 宿主、锚点命中帧的 DOM 状态 |
| 样本量与来源 | 复用 L1 的 8–12 关键帧；每帧导出：元素清单（id / type / rect / z-index / text / 可见性）、`TextMetrics.width`、counter 文本、时间轴 `durationFrames` 与当前 frame |
| 时长 / 分辨率 | 同 L1；DOM 采样在 seek 完成、双 rAF 之后读取 |
| 机器与依赖版本 | 同 L1；chromedp Evaluate 读取 `getBoundingClientRect` / `document.fonts`；无额外浏览器依赖 |
| 单次预期耗时 | 数量级：分钟级。估算：每帧在截图基础上增加 1 次 Evaluate 序列化 DOM 树（元素 ≤64），约 50–150ms/帧；90 帧 ≈ 1–3 分钟 |
| 通过阈值 | rect 误差 ≤1 px；TextMetrics 宽度误差 ≤2 px；元素 id 集合 / 顺序 / z-index 精确相等；像素阈值同 L1；时间轴 frame 与期望帧号一致 |
| 失败判定 | 元素缺失 / 多余；rect 越界；文本度量不符；z 序错误；DOM 读取发生在 ready 之前；跨镜像 DOM 阈值放宽同 §7.0 |
| 产物路径 | `testdata/golden/<case>/dom-<NNN>.json` + 像素快照；diff 报告列不一致字段 |
| 当前状态 | **部分可执行待测**。投影 DOM 结构由 `elementMap` 确定性产出（`projector.go:217-273`）；现有测试止于 HTML 文本包含断言，尚无 rect / metrics 采样夹具与读取实现——需新增测试 seam（chromedp Evaluate 脚本），属 L4 新增工作，不修改业务代码的前提下可在测试辅助层完成。受缺口阻塞：字体度量一致性（F-FNT-01）、未解析锚点 DOM 位置（F-ANC-01） |

### 7.6 L5 性能与稳定性

| 项 | 内容 |
|---|---|
| 目标 | 并发上限、长时间运行、内存与句柄泄漏、100 次一致性；profile 采集；worker / pool 生命周期 |
| 样本量与来源 | (a) 一致性：取最短案例 VS-C08（20s / 600 帧），一致性跑批缩小到 30 帧采样段（首 / 中 / 尾各 10 帧）连跑 100 次；(b) 并发：PoolSize=2 提交 6 job 观测在途峰值；(c) 长稳：同一案例循环 20 轮，对比内存 / 句柄 / 浏览器子进程基线；(d) 崩溃恢复：claim 后 / Put 后各注入一次进程取消 |
| 时长 / 分辨率 | 一致性采样段 30 帧；并发与长稳用 ≤5s 短片段控制成本；分辨率标准偶数 |
| 机器与依赖版本 | 同 L3；Go pprof（heap / goroutine / process）；浏览器子进程枚举；FFmpeg 进程计数 |
| 单次预期耗时 | 数量级：半小时级。估算：100× 采样段 = 3000 帧 digest 比对（像素帧不落盘），每段 seek+截图约 50–150ms，100× ≈ 25–75 分钟；并发 6 job + 长稳 20 轮 ≈ 20–40 分钟。精确耗时以首次基线实测回填 |
| 通过阈值 | 同镜像 100 次逐帧 PNG SHA-256 全部相等；在途实例 / 浏览器进程峰值 ≤ PoolSize；20 轮后 heap 增长 ≤ 10%（无单调上升）；goroutine 数回到基线 ±10%；无残留 Chrome / FFmpeg 子进程；崩溃恢复后行 / job / 配额最终一致 |
| 失败判定 | digest 序列任一不一致；实例峰值超上限；内存 / 句柄单调增长；子进程泄漏；取消补偿后行卡死或配额未释放 |
| 产物路径 | `tmp/video-test/perf/<run-id>/{digests.txt,profile.pprof,processes.json,report.json}` |
| 当前状态 | **部分受阻塞**。100× digest 机制可复用现有 `TestRenderFrames_Deterministic` 的 SHA 思路（`renderer_test.go:121-141`，现仅 2 次）；硬信号量已在位（F-POOL-01），剩余阻塞项：在途计数 / 进程泄漏断言与上下文分离测试（F-POOL-01）、真实管道编译与 DB 崩溃注入（F-WKR-01）、recipe 与字体 digest（F-DET-01）、长稳所需的 worker / pool Close 泄漏测试基线。一致性采样段可在 capx 层先行，不依赖 worker |

### 7.7 环境矩阵与 golden 基线流程

**环境矩阵（三列；版本必须固化进 recipe 与报告）：**

| 维度 | 本机 Windows（开发 / 调试） | Linux CI（自动化） | 固定渲染镜像（golden 基线） |
|---|---|---|---|
| OS | Windows（本机，版本号以 `winver` 回填）[实测] go1.27.0 windows/amd64 | Linux（容器，发行版 / 内核待 CI 镜像定稿） | 固定 digest 镜像：Chrome + FFmpeg + 字体集 + 依赖库版本全部锁定 |
| Go | 1.27.0 [实测] | 与本机同版本或工具链文件锁定 | 同 CI 工具链 |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` [实测 存在]；完整版本号 `chrome --version` 待回填 | pinned Chromium 版本（与固定镜像一致） | pinned full version，digest 入 recipe |
| FFmpeg | N-117763-ge35587250c-20241113 [实测]，含 `subtitles`(libass) 滤镜 [实测]、libx264 [实测] | 同构建版本 | 同构建版本，含 libass |
| 字体 | 系统回退链（Noto Sans SC / PingFang SC / Microsoft YaHei）[现状] | 镜像内安装字体子集 | 字体子集打包进镜像，digest 入 recipe（受 F-FNT-01 缺口约束） |
| GSAP | vendored 3.13.0（`capx.go:34` 注释） | 同 vendored 文件 | 同 vendored 文件，sha256 入 recipe |
| DB | `TEST_DATABASE_URL`（`make test-db` 口径） | CI Postgres 服务容器 | 同 CI 版本 |
| 适用层级 | L0 / L1 / L4 调试；L2 抽样 | L0–L5 全量自动化 | L1 / L3 / L5 golden 唯一基线来源 |

**golden 基线生成流程：**

1. 在固定渲染镜像内，用锁定版本工具链跑通对应案例 IR；首帧 / 关键帧导出 PNG + DOM JSON + digest。
2. `meta.json` 记录：案例 ID、帧号、帧数公式版本（`ceil(d·fps)` 单一口径）、fps、分辨率、IR sha256、recipe（Chrome / FFmpeg / GSAP / 字体 digest）、生成时间与镜像 digest。
3. 基线必须经一次人工复核（区域亮度、元素边界、文本无豆腐块），复核记录写入报告；此后自动比对。

**基线更新流程：**

- 内容有意变更（版式 / 动画 / 文案）：先改 IR 与案例规格，在固定镜像重新生成对应帧，MR 中附新旧帧 diff（MAE / SSIM / 不一致字段清单）。
- 依赖升级（Chrome / FFmpeg / 字体 / GSAP）：整批重生成基线，不得单帧热更；MR 说明升级理由与跨镜像容差评估。
- 基线文件入仓库前过体积检查：PNG 经无损优化；DOM JSON 不含浮点噪音位。

**评审规则：** 基线变更 MR 必须由非生成者复核；跨镜像 diff 只在容差阈值内放行；bit-identical 承诺仅限固定镜像内部（架构 D12）。

### 7.8 成本估算（算式与量级）

**帧量唯一来源 = 架构 §2.1；本节数字均为 §7.0 定稿表的推导。**

- 帧数（每案例）：`F = ceil(d · fps)`，见 §7.0 表；9 案例合计 **10800 帧**。
- 时长：逐案求和 15+30+45+60+30+90+40+20+50 = **380s ≈ 6.33 min（6 分 20 秒）** 画面（已核对：§2.1 = 380s，与本表一致；原 360s 系主表笔误，已修正）。

**分层帧数与时长：**

| 层 | 帧数算式 | 帧数估算 | 视频时长估算 |
|---|---|---:|---:|
| L0 | 0（纯函数） | 0 | 0 |
| L1 | 9 案例 × 10 帧 | 90 帧 | 0（单帧截图） |
| L2 | 案例段 7×(5s×30=150) + 2×(5s×25=125) + 4 音频分支×150 | 1300 + 600 = **1900 帧** | ≈ 45s 画面 + 4 分支片段 |
| L3 | 全量 9 案例 | **10800 帧** | **380s ≈ 6.33 min** 画面 |
| L4 | 复用 L1 帧 | 90 帧（+ DOM 采样） | 0 |
| L5 | 一致性 30 帧采样段 × 100 次；并发 / 长稳复用 L2 片段 | 3000 帧（digest） + 并发 / 长稳 ≈ L2 量级 | 采样段 ×100 |

**PNG 磁盘占用（算式；系数已按 L5 实测回填，[口径 round3]）：**

- 像素量：1080×1920 = 1920×1080 = 2,073,600 px；1080×1080 = 1,166,400 px。
- 原始 RGB = 像素量 × 3：HD ≈ 6.22 MB/帧，1080² ≈ 3.50 MB/帧。
- **[修正 2026-11-15 round3]（依据 consistency-l5-report.json 实测）**：原 3–8× 压缩比估算对扁平色运动图形**不成立**——L5 采样夹具实测 238.6×，真案例 golden 帧交叉验证 C01 178.3× / C04 132.0× / C06 178.6×。实测 HD 帧 **~35–47 KB/帧**（均值 26–47KB，按内容复杂度）。据此：L1 golden 90 帧 ≈ **3–4 MB**（非 68–182 MB，原估算高估 ~20-25 倍）；L3 临时帧 10800 帧 ≈ **430 MB**（非 8.2–21.8 GB）。原估算行保留如下存证：
  - ~~运动图形 PNG 压缩比按 3–8× 估 → HD **0.78–2.07 MB/帧**，1080² **0.44–1.16 MB/帧** [待验证：以 L1 首批真机样本实测均值回填]。~~
  - ~~L1 golden：90 × 0.76–2.02 MB ≈ **68–182 MB**~~；~~L3 临时帧：10800 × 0.76–2.02 MB ≈ **8.2–21.8 GB**~~
- 帧加权均值、L5 一致性 digest 条目不变（digest 仅文本 <1 MB）。

**MP4 磁盘占用（算式）：**

- 码率估算：CRF 18 运动图形 4–10 Mbps [待验证]；文件大小 `MB ≈ bitrate(Mbps) × d(s) / 8`。
- L3 合计 380s：`4×380/8 = 190 MB` ～ `10×380/8 = 475 MB`。
- L2 ≈ 45s 画面：22.5–56.3 MB；4 音频分支片段另计；L5 并发 / 长稳片段 ≤ L2 量级。

**计算前提与不确定性：** 以上系数（PNG 压缩比、x264 码率、单帧耗时）均为工程估算，首次真机基线实测后必须回填 §7.6 与本表；L3 帧流是否落盘取决于管道实现，当前现状为流式 pipe（`render_pipeline.go:163-174`）。

### 7.9 执行顺序、依赖图与门禁

**依赖图（→ 表示前置；缺口编号对应 §6）：**

```text
L0 纯函数 ──→ L1 still golden ──→ L2 短片段 MP4 ──→ L3 完整成片
                  │                  │                 │
                  └──→ L4 DOM golden ┘                 ├──→ L5 并发 / 长稳
                                                        └──→ L5 100× 一致性

缺口前置关系：
F-IDM-01 DB 幂等 + Tx 已闭环；River UniqueOpts 分工 + 跨层中间态回放测试 ──→ L3 重复提交断言、L5 并发计费断言
F-QTA-01 Tx 端口 + 周期固化已闭环；跨月时钟 seam + E_QUOTA_EXCEEDED 映射测试 ──→ L3 跨月 / 阻断断言
F-WKR-01 reconciler + heartbeat + 真实管道编译 ──→ L3 崩溃注入、L5 崩溃恢复
F-POOL-01 硬信号量已在位；在途计数 / 进程泄漏断言 + 上下文分离测试 ──→ L5 并发峰值与长稳断言
F-AUTH-01 CanIn 端口 + 文件归属表（MCP PAT-only / scope 已在位）──→ L3 越权断言、L3 文件 Range 断言
F-TRA-01 fileID 层 + handler key 校验 ──→ L3 / L4 文件访问用例
F-RES-01 服务端素材预检 + magic bytes + 像素炸弹上限（JS decode fail-closed 已在位）；F-MIME-01 内容嗅探 ──→ L1 坏图帧基线、L2 素材拒绝用例
F-FNT-01 字体子集 + recipe ──→ L1 字形 golden、L4 度量基线、L5 跨镜像容差
F-DIM-01 capx 层偶数拒绝 + pad 兜底已在位；产品层偶数 + 白名单 ──→ L2 标准尺寸全量（非标准尺寸走拒绝路径单测）
F-ASS-01 soft 封装 + warnings ──→ L2 字幕轨断言
F-XSS-01 source 校验 + 行分隔符 ──→ L4 消息协议用例（转义部分 L0 已覆盖）
F-ANC-01 未解析锚点阻断 ──→ L1 / L4 锚点帧基线
F-DET-01 recipe + 随机源扫描 ──→ L5 100× 一致性入库
F-SEE-01 帧数口径已统一；NaN / 类型校验 ──→ L1 / L3 seek 输入断言
```

**分层门禁（哪些必须先做、哪些可立即执行）：**

| 层 | 当前可执行性 | 门禁条件 |
|---|---|---|
| L0 | **立即执行**（本机 Go 齐全） | 无前置；补同源帧数回归、锚点四分支、字幕边界用例 |
| L1 | **立即执行（标准尺寸 + 合法素材帧）** | Chrome / FFmpeg 在位 [实测]；坏图 / 缺字 / 未解析锚点帧待 F-RES-01 / F-FNT-01 / F-ANC-01 关闭后入基线 |
| L2 | **部分立即执行** | 视频编码分支本机可跑；soft 字幕轨断言待 F-ASS-01；素材拒绝用例待 F-MIME-01；产品层白名单 / 偶数拒绝用例待 F-DIM-01（capx 层拒绝与 pad 兜底已在位） |
| L3 | **受缺口阻塞** | 前置：F-WKR-01（真实管道 + reconciler）、F-AUTH-01、F-TRA-01；F-IDM-01 / F-QTA-01 的 DB 幂等、Tx 扣费与周期固化已在位，仅余 River 去重分工与跨月时钟测试；DB 集成测试框架已有 `service_db_test.go` 自举迁移模式可复用 |
| L4 | **部分立即执行** | 需先新增 DOM 采样测试 seam（测试辅助层，非业务代码）；字体度量基线待 F-FNT-01；消息协议用例待 F-XSS-01 补齐 |
| L5 | **部分受阻塞** | 100× 一致性采样段可在 capx 层先跑（复用 `renderer_test.go` digest 思路）；并发信号量已在位，在途计数 / 泄漏断言与上下文分离测试待 F-POOL-01；崩溃恢复待 F-WKR-01；长稳泄漏基线待管道 Close 路径测试补齐 |

**合入门禁（对齐架构 §16.4，不另立标准）：** `make -C example db-up` → `make test-db` → `make verify` → `make verify-ui` → `python tools/check_api.py`。其中 `check_api.py` 扫描范围已含 video HTTP 适配层（[代码] `tools/check_api.py:45`）；2026-11-15 实测 spec / code 路由 172 : 172 零漂移（[实测] 命令 `python tools/check_api.py`，exit 0；本机运行记录待回填命令输出副本）。任何 L3 / L5 缺口未关闭前，不得把 Video Studio 标记为可部署（架构 §20）。

### 7.10 判定表模板（单次执行结果记录）

每次 L1–L5 运行填一张；字段与 §7.0 阈值、§6 故障编号一一对应，便于跨次比对。

| 字段 | 填写说明 |
|---|---|
| `run_id` | 唯一运行标识（时间戳 + 机器名） |
| `layer` | L0 / L1 / L2 / L3 / L4 / L5 |
| `case_id` | VS-C01 … VS-C09；L0 填夹具 ID |
| `env` | local-windows / linux-ci / fixed-image；记录 OS、Go、Chrome、FFmpeg、GSAP、字体 digest |
| `recipe` | IR sha256、project version、params（width / height / fps / subtitleMode）、镜像 digest |
| `frame_spec` | width、height、fps、durationSec、`frames=ceil(d·fps)`（单一口径）、公式版本 |
| `samples` | 样本清单：帧号 / 片段起止帧 / 音频分支 / 注入故障编号（F-…） |
| `thresholds` | MAE 分区 ≤2、全帧 ≤4、SSIM ≥0.98、RMSE ≤3（跨镜像 6 / 0.95）；DOM rect ≤1px、metrics ≤2px；配额释放次数；digest 一致性 |
| `result` | pass / fail / skip-blocked；skip 必须填阻塞缺口编号与 file:line |
| `per_sample` | 每样本：状态、实测 MAE / SSIM / RMSE、rect / metrics 误差、digest 是否一致、耗时、产物路径 |
| `quota_audit` | （L3）消费次数、释放次数、目标周期、render 行状态、River job 终态、审计事件清单 |
| `errors` | 错误码、脱敏 message、stderr tail 截断长度；不得记录 script 全文 / 凭证 / 对象 URL query |
| `perf` | （L5）单帧耗时分布、heap / goroutine / 进程峰值、在途实例峰值、内存增长率 |
| `artifacts` | golden 文件、临时目录、profile、report.json 的相对路径与留存策略 |
| `review` | 复核人、复核结论、基线是否更新；跨镜像 diff 摘要 |
| `evidence` | 命令行、关键输出摘录、日期；`[实测] / [代码] / [待验证]` 标记 |

---

**附：本文未修改任何业务代码、SQL 迁移、OpenAPI 或前端文件；产物仅为本文档一个 markdown。**

## 8. 交叉审查记录、裁定与未决项

本章记录本轮审查实际做了什么、推翻了哪些旧结论、还有哪些没有结论。它不是"质量说明"，是**这套文档下一次修订的入口**。

### 8.1 审查用了什么方法

| 层 | 执行者 | 做了什么 | 产出 |
|---|---|---|---|
| 机械校验 | 主控 | 把 §3/§4 的 9 个 IR JSON 块全部解析，逐块清点字段、校验 `words[].index == 下标`、`anchor.lastIndex == 对应词 index`、`targetElementId` 与 `trackId` 引用闭合、`ceil/round` 帧数一致；另核对 `python tools/check_api.py`、`go -C example test ./internal/video/app`、`go test ./platform/capx` | 4 处 `lastIndex` 错位、7 个元素 `src` 层级错、优先级 9 处不一致、帧量两套口径 |
| 语义互审 | 独立审查代理 | 对照共享基线逐节读五份分章稿，逐 T 项比对判定，逐条核代码事实，清查超纲字段与"看起来有但不可判"的断言 | 15 条必修清单（12 条阻塞） |
| 事实复核 | 各自作者 | 每位作者在收到审查意见后回读源码，重新取证并改稿 | §1.8 双列、§5 双列、§6 四条现状重写、9 案 IR 拆包 |
| 主控终检 | 主控 | 修后重跑机械校验；核对时长求和（380s）；核对仓库基线时点 | 见 §8.3 状态列 |

### 8.2 能力判定的最终口径（全文唯一裁定）

原始分歧：同一技术项在 §1.8 与 §5 被给出不同档位（T-05/T-06/T-09/T-10/T-11/T-12/T-15 共 7 项）。根因不是谁算错了，而是**把两件不同的事压进一个档位**。裁定为两列：

| 列 | 定义 | 判据 |
|---|---|---|
| `结构可表达性` | 不改代码，现 IR 字段与现 builder 能否**表达**该效果的结构（含降级结构） | ✅ 字段/类型在位；⚠️ 只能用近似元素组合表达；⛔ 无对应类型或字段 |
| `视觉达标性` | 现实现（含降级）产出的画面能否**通过**该技术项的验收断言（容差内） | ✅ 可通过；⚠️ 可见误差可登记为降级；⛔ 不可达或误差超容差 |
| `范围` | 该能力是"包内函数在位"还是"产品端到端接通" | 仅 T-15 这类"函数有、链路断"的条目需要 |

**三条使用规则**（不遵守就会退回原来的混乱）：

1. 文档里任何"支持 / 不支持"的表述，**必须指明是哪一列**。只说"支持数字滚动"而不说是"结构可表达"还是"视觉达标"，等同于没说。
2. 案例的降级承诺与验收阈值**只按"视觉达标性"判**。结构能表达但视觉不达标的效果，必须写成 ⛔ 并在断言里排除，不能拿"画面上有个数字"充当通过。
3. T-15 必须带范围。包内 `ExtractThumbnail` 是 ✅，端到端（service → render 行 → UI）是 ⛔，两者不能互相顶替。

**15 项裁定结果**（§1.8 与 §5 已按此对齐）：

| T | 结构可表达性 | 视觉达标性 | 一句话后果 |
|---|---|---|---|
| T-01 CJK 排版 | ⚠️ | ⚠️ | 能出字，字距/行高/禁则不可达 |
| T-02 多图层 | ✅（静态） | ⚠️ | 层级可做，轨道级重排不可达 |
| T-03 遮罩裁剪 | ⛔ | ⛔ | 只能靠叠 shape 挡边伪装 |
| T-04 粒子 | ⛔ | ⛔ | 只能用 shape 阵列静态摆放 |
| T-05 伪 3D | ⚠️ | ⛔ | 对称缩放近似，真梯形/侧边形变不可达 |
| T-06 镜头推进 | ⚠️ | ⚠️ | 单层推拉可现，视差与 dolly-zoom 不可达 |
| T-07 转场 | ⛔ | ⛔ | 单一 composition，跨镜转场无处安放 |
| T-08 路径运动 | ⚠️ | ⚠️ | 两点折线可拼，样条不可达 |
| T-09 错峰入场 | ⚠️ | ⛔ | 无元素时间窗、无 opacity；入场前隐藏依赖未验证语义 |
| T-10 数字滚动 | ⚠️ | ⛔ | 数字只能出现在画布原点，无法定位 |
| T-11 图表生长 | ⚠️ | ⛔ | transformOrigin 固定中心，基线生长不可达 |
| T-12 逐词高亮 | ⚠️ | ⚠️ | 原生高亮作用于整层，只能拆成逐词元素替代 |
| T-13 混音/响度 | ⚠️ | ⚠️ | amix 可做，loop/loudnorm/apad/aresample 全无 |
| T-14 字幕 | ⚠️ | ⚠️ | 烧录可做，CJK 禁则与词边界折行不可达 |
| T-15 缩略图 | 包内 ✅／端到端 ⛔ | ⛔ | 封面帧选不出来，也存不下来 |

### 8.3 阻塞项修正登记

| # | 问题 | 修法 | 状态 |
|---|---|---|---|
| 1 | §6 `F-IDM-01` 称幂等未实现 | 改为"DB 唯一索引 + Tx 内消费已闭环，缺口收窄为 River `UniqueOpts` 分工未定义" | 已修正 |
| 2 | §6 `F-QTA-01` 称无 Tx 端口、无周期列 | 改为"`ConsumeWithTx/ReleaseTx` + `quota_period` + 按行内周期释放已在位，缺口为时钟 seam 与错误码映射测试" | 已修正 |
| 3 | §6 `F-POOL-01` 称池非信号量 | 改为"硬信号量已在位（取槽后才 launch），缺口为泄漏断言与上下文分离测试" | 已修正 |
| 4 | §6 `F-DIM-01` 漏掉 FrameSpec 奇数拒绝 | 补 `renderer.go` 奇数分支与 `encode.go` 截断兜底；缺口重述为 IR 层无偶数校验与白名单 | 已修正 |
| 5 | 7 项能力档位冲突 | §1.8 与 §5 统一改为两列口径（见 §8.2） | 已修正 |
| 6 | 9 个案例优先级与主表不一致（含不存在的 P3 档） | 以 §2.1 为单一来源回填：P0=C01/C04/C06，P1=C02/C03/C09，P2=C05/C07/C08 | 已修正 |
| 7 | 帧量两套口径（10800 vs 4030；C02 fps、C08/C09 画幅冲突） | §7.0 回填定稿值，§7.8 按 10800 帧 / 380 秒重算，§2.1 与 §7.8 同源 | 已修正 |
| 8 | C09 断言 `elements=12`，IR 实际 9 | 断言改 9，IR/分镜/帧表不动 | 已修正 |
| 9 | 复合参数键超纲且无归属 | 进 §5.16 `P2-7/P2-8` 提案；各案降级映射补汇总行；附录 A.3 给全局处置规则 | 已修正 |
| 10 | 动画 `from/to/easing` 包在 `params` 内（现实现读顶层，会静默失效） | 9 个案例全部拆到顶层；§1.2 增裁定行；§5.16 增 `P1-7` | 已修正 |
| 11 | §4 图片 `src` 放进 `params`（现实现读顶层 `Src`） | 7 个图片元素上移；目标 schema 需补 image 元素字段 | 已修正 |
| 12 | C03 `el_title` 引用不存在的 `trackId: tr_overlay` | 改为 `tr_annotation`；其余四案引用本就闭合 | 已修正 |

### 8.4 本轮被推翻的旧结论（旧审计口径不再成立）

这一节是这个文档最容易被误用的地方：架构文档 v2.0 的 §0.3 与 §16.3 记录的是 2026-11-15 早些时候的快照，其中多条已失效。

| 旧结论 | 当前事实 | 证据 |
|---|---|---|
| 11 条 video 路由为 spec-only | 路由零漂移：172 / 172，exit 0 | `python tools/check_api.py`，且 `tools/check_api.py:45` 已把 video 适配层纳入扫描 |
| `main.go` 未装配 video | 已装配 capx / storagex / service / ws scope / authz 权限键 | `example/cmd/app/main.go:1215,1228,1243,982,520` |
| capx 奇数尺寸用例失败 | `go test ./platform/capx` → `ok 15.973s`；且 `FrameSpec.Validate` 显式拒绝奇数、编码侧另有 pad 兜底 | 本轮实测；`renderer.go:80-81`、`encode.go:78` |
| 浏览器池不是硬上限 | `sem chan struct{}` 硬信号量，取槽后才 launch | `capx.go:102-105,184,187-191,200` |
| 坏图 decode 被吞、ready 仍 true | 已改为记录 `__player.error` 并 rethrow，`Promise.all` 拒绝 → ready 保持 false | `timeline-builder.js:148-160`、`renderer.go:234-239` |
| 渲染提交无幂等、配额在事务外 | DB 唯一索引 + Tx 内消费 + 周期列已在位；缺口只剩 River 层去重分工 | `routes.go:206-213`、`service.go:816-850`、`1009_video_render_idem.up.sql:8-19` |

**仍然成立的旧结论**（不要因为上面一批被推翻而连带否掉）：counter 节点不可定位、非 counter 特效作用于整层 `#canvas`、未解析动画落 0 帧、MuxAV 无 loudnorm/apad/aresample/loop、SRT 注释称 CRLF 而代码输出 LF、IR 层 `validateMeta` 无偶数校验与分辨率白名单、缩略图未接通服务层。

### 8.5 未决项（有结论才算解决，这里都还没有结论）

| # | 未决项 | 阻塞什么 | 需要的输入 |
|---|---|---|---|
| 1 | 三个错误码未定值（`E_VIDEO_INVALID_PARAMS` 的素材子集、`E_TTS_UNAVAILABLE`、`E_ALIGNER_UNAVAILABLE`） | 对应故障用例只能人工核验，不能写成自动化断言 | 错误码表定稿 |
| 2 | IR 与 recipe 的服务层字段划分未落地（附录 A.4 只给了文档侧口径） | 改了 crf 是否产生一次 IR 变更，语义未定 | 架构侧决定 |
| 3 | 封面帧验收判据只有定性描述 | 缩略图无法进 L1/L2 自动化 | 主体 bbox 覆盖率 / 文字截断判据 |
| 4 | 双语字幕缺第二字幕轨的时间结构 | C06 的中英对齐无法自动判定 | IR 扩展 |
| 5 | CJK 禁则字符集未列全 | 字幕断行断言只能抽查 | 禁则字符集清单 |
| 6 | 音频时长边界四例（末词 `end` > 时长 / BGM 短于 voice / voice 短于 BGM / 恰好相等）未进故障集 | 出片尾部黑屏或截断风险未被覆盖 | 四个用例 + `apad/atrim` 现状 |
| 7 | `anchor.status` 与 `resolvedFrom` 的枚举全集未定义 | 案例只用到 `resolved/exact` 等少数值 | IR 契约补枚举 |
| 8 | 素材缺 sha256 | L2/L3 不可复现，"同一素材"只能靠文件名 | 素材清单补哈希 |
| 9 | 代码基线时点与并发改写 | 本轮期间仓库被另一会话提交过（`timeline-builder.js` 13:15，工作区 git clean），file:line 以该时点为锚 | 每次改能力后重跑 §1.8 |
| 10 | golden 更新流程缺责任人与触发阈值 | 基线会随环境漂移无人审批 | 评审责任人 + 触发条件 |

### 8.6 这套文档什么时候失效

不是"过一段时间就该更新"，而是**触发即失效**，必须重算对应部分：

| 触发 | 失效范围 |
|---|---|
| §1.8 任一 ⛔ 转 ✅/⚠️ | 对应案例的「现状降级映射」与断言阈值必须重算；§2.3 里程碑结论作废 |
| IR schema 落地（`tracks[]`、`elementWindow`、`element.params`、顶层 `animations`） | 9 个案例的 IR 全部要迁移，§1.2 差异矩阵清零 |
| 渲染镜像 / 字体 revision / Chrome 版本变更 | 全部 golden 失效（§7.7 只定义流程，不豁免重生成） |
| 渠道规格变更（平台改画幅、时长上限） | §2.1 索引表的帧数基数变，§7.8 成本全变 |
| OpenAPI 字段级对账落地 | §1.7 的字段偏差条目（`output_key` vs `output_url`、201 vs 202、`thumb_url` 无后端字段）需重述 |

### 8.7 结论

这份文档当前可以支撑三件事：按 §3/§4 构造 IR（字段与锚点已校验闭合）；按 §7 的 L0/L1 立刻执行低成本测试；按 §8.2 的两列口径判断"某个效果到底算不算做出来了"。

它不能支撑一件事：**宣称任何一项已经通过**。全文没有任何一条 `[实测]` 记录来自这九个案例的出片；`[实测]` 只覆盖工具链本身（测试能否跑、契约是否漂移、编码器是否拒绝奇数尺寸），不覆盖任何一个案例的画面质量。

### 8.8 round1 实测差异登记（2026-11-15 第 1 批实测，Medium/Low 不逐条改正文）

第 1 批实测（delivery-audit-video-studio-round1-2026-11-15.md，代码基线 HEAD `d25362e`）共产出 **16 条文档-现实差异**，全量清单（含 file:line 证据与 actual_behavior）登记在 `example/internal/video/testdata/spec-audit-report.json`（C04 8 条 + C06 8 条，另有 cross_cutting_findings X-1..X-4）。**其中 4 条 High 已按两列口径在正文修正**（M-C04-04 → §4.2.4 修正框；M-C04-07 → §4.2.3/§4.4.3 修正框；M-C06-01 → §4.4.6 修正框；X-4 → §1.8/§5.12/§4.2.6/§4.4.6 修正框）。其余 Medium/Low 不逐条改正文，在此登记入口，执行 L1/L2 前必须对照：

| ID | 级别 | 一句话差异 | 正文涉及处 |
|---|---|---|---|
| M-C04-01 | medium | "z 值仅作字段保留"已过时：z 是活的（timeline-builder.js:66 `zIndex = 1+el.z`），本案片尾卡覆盖正依赖它 | §4.2.4 多 track 行 |
| M-C04-02 | low | counter "固定左上"结论成立，但引用行号漂移 232-241→245-255 | §4.2.4 T-10 行 |
| M-C04-03 | medium | nearest 静默回退结论成立，行号漂移 500-575→507-546；另 `E_VIDEO_ANCHOR_AMBIGUOUS` 错误码不存在（只有 `E_VIDEO_ANCHOR_NOT_FOUND`） | §4.2.4 锚定行、§4.2.6 F-C04-03 |
| M-C04-05 | low | "现实现 round=1800"表述过时：帧数公式已统一为 ceil 单源（service.go:898-911）；本案数值无差 | §4.2.1 案例头 |
| M-C04-06 | low | 错误码名实际是 `E_VIDEO_IR_INVALID`（非 `E_VIDEO_INVALID_IR`），src 校验行号漂移 355-365→365-372 | §4.2.6 F-C04-04 |
| M-C04-08 | medium | §4.2.3 目标 IR 的 anchor `{wordId,...}` 照抄会因缺 `anchor.text` 校验失败（ir.go:260-262），须先做 wordId→{text,occurrence} 映射 | §4.2.3 |
| M-C06-02 | low | "预览不播音频"结论成立，引用行号漂移 36-40→31-33 | §4.4.2 音频策略 |
| M-C06-03 | medium | `E_VIDEO_ANCHOR_AMBIGUOUS` 不存在、不会 400；"取首个匹配"不准确（occurrence 越界落 same_text 最近候选） | §4.4.6 F-C06-03 |
| M-C06-04 | low | CJK 硬切/行首标点结论成立，行号漂移；且 `isCJKPunct` 标点集已存在但未被折行引用（subtitle.go:150-156） | §4.4.4 T-01 行 |
| M-C06-05 | low | 最短 cue 时长无校验结论成立；L0 校验应加在 SRT 生成处（BuildCues），IR 层无 cue 概念 | §4.4.4 / §4.4.6 F-C06-02 |
| M-C06-06 | medium | Element 结构无 `params` 字段，`extra` 存在但投影仪不输出——"params 内保留扩展键"说法自相矛盾 | §4.4.4 动画参数层级行 |
| M-C06-07 | medium | 结论句帧 2025 vs 词锚 2130 差 105 帧（文档内部矛盾）——已在 §4.4.5 帧表处加"二选一"标注（L1 按词锚 2130） | §4.4.5 帧表 |
| M-C06-08 | low | "软字幕 asset kind=subtitle"、"11 条 cue 时间码"断言对象不存在：现 IR 无 asset 表，cue 是 SRT(words) 运行时输出，属 L0 断言 | §4.4.6 IR 层断言 |

另两条 cross-cutting：X-2（ceil 单源口径，全文档"现实现 round="表述统一按此改）与 X-3（目标 schema→现实现 7 条转换规则，含 §4.2.3/§4.4.3 修正框点名的"顶层 animations 内嵌"——实测 projector 丢弃顶层动画）。两案降级 IR 已过 `videoapp.Validate`（c04.degraded.json 1800 帧 / c06.degraded.json 2250 帧），是 §4.2.3/§4.4.3 目标 schema 的可运行替代。round1 其余产出（L0/L1/L2 判定、M1 门槛、修复提交 F-DB-1/F-G3-1、缺陷 D-01）见 delivery-audit-video-studio-round1-2026-11-15.md。

## 附录 A：目标 IR 字段速查与实现映射

A.1 目标 IR（架构文档 §5.1，案例按此书写）

| 字段 | 类型 | 语义 | 现实现状态 |
|---|---|---|---|
| `schemaVersion` | int | IR 结构版本，与行级 `version` 不得混用 | ⛔ 缺失（`ir.go` 只有 `version`） |
| `meta.width/height` | int | 产品白名单 1080×1920 / 1920×1080 / 1080×1080，且须偶数 | ⚠️ 仅校验 360–2160，未强制偶数与白名单（`ir.go:310`） |
| `meta.fps` | int | 24/25/30/50/60 | ✅ `ir.go:161` |
| `meta.durationSec` | float | 验收口径 `durationFrames = ceil(durationSec*fps)` | ✅ Go 与 Player 均已 `ceil`（`timeline-builder.js:37`，HEAD `d25362e`） |
| `meta.background` | string | 画布底色 | ⛔ 缺失（模板固定 `#000`，`projector.go` 模板） |
| `voice{provider,voice,rate,audioKey}` | object | TTS 参数与产物引用 | ⚠️ 现为 `audio.voice{key,durationSec,volume}`（`ir.go:136`） |
| `words[].id` | string | 稳定词身份（锚点唯一权威） | ⛔ 缺失（只有 `index`，`ir.go:64`） |
| `words[].start/end` | float | 词级时间，须单调不重叠 | ✅ `ir.go:225` |
| `words[].source` | enum | `tts/aligner/manual/estimated` | ⚠️ 文档 §5.1 示例写 `aligned`，代码是 `aligner`，须统一为后者 |
| `words[].confidence` | float | 对齐置信度 | ⛔ 缺失 |
| `words[].scriptStart/scriptEnd` | int | Unicode code point 偏移 | ⛔ 缺失 |
| `tracks[]` | array | 轨道（main/overlay/bgm），含 `z` 与 `volume` | ⛔ 缺失（层级靠 `element.z` 单点表达） |
| `elements[].trackId` | string | 归属轨道 | ⛔ 缺失 |
| `elements[].startFrame/endFrame` | int | 元素可见时间窗 | ⛔ 缺失（元素整片可见，`timeline-builder.js:143`） |
| `elements[].params{...}` | object | 类型相关参数（text/x/y/fontSize/color…） | ⚠️ 现为扁平字段（`ir.go:118`） |
| `animations[]`（顶层） | array | 含 `targetElementId` | ⚠️ 现内嵌在 `element.animations`，无 `targetElementId` |
| `effects[].targetElementId` | string | 视觉作用目标 | ⛔ 缺失；现 pulse/highlight/shake/fade 一律打 `#canvas`（`timeline-builder.js:190`） |
| `anchor{wordId,lastText,lastIndex,resolvedFrom,status}` | object | 锚点与解析状态 | ⚠️ 现只有 `{text,occurrence}` + `resolvedFrom{wordIndex,reason}`（`ir.go:74`） |
| `assets[]` | array | 资产登记（key/类型/字节/许可） | ⛔ 缺失 |
| `render{}` | object | 渲染配方（crf/preset/pixFmt/音频/字幕/缩略图） | ⛔ 缺失（不外显，无法复现） |

> 结论：案例按目标 IR 书写是对的，但**任何"照此 IR 就能出片"的表述都是错的**。每个案例必须带「现状降级映射」，把每一行映射到上表的现实现状态。

A.2 现实现独有的字段（目标 IR 未定义，但代码在用）

| 字段 | 位置 | 说明 |
|---|---|---|
| `element.colorn/fontSize` | `ir.go:118` | 文字与形状的唯一样式入口，无字重、无字距、无对齐 |
| `element.z` | `ir.go:129` | 唯一层级手段，映射到 `zIndex = 1+el.z` |
| `animation.from/to`（Point） | `ir.go:104` | move 专用，绝对画布坐标，builder 内部换算为偏移量 |
| `animation.fromValue/toValue` | `ir.go:108` | scaleIn/rotate 专用标量 |
| `animation.extra` | `ir.go:116` | 预留 JSON 槽，当前 builder 未消费 |

A.3 案例 IR 中"扩展草案字段"的处置约定（**读文档的人必须知道这一条**）

§3 / §4 的案例 IR 是**目标 schema 的超集草案**：为了把"这个案例真正需要什么"写清楚，案例里会出现目标 schema 尚未定义、现实现也不消费的键（例如 `params` 内的 `staggerMs`、`loop`、`gradient`、`mask`、`opacity`、`tracking`、`reveal`、`zoom`、`pct`、`path`、`crop`、`shape`、`segments`、`axis`、`swatches` 等）。

处置规则（全文档统一）：

1. 凡不在附录 A.1 字段表、且不在 A.2 现实现字段表内的键，**一律视为"扩展草案（未实现）"**，不得当作已具备能力。
2. 扩展草案字段的档位一律为 ⛔：现 builder 不消费这些键，写进 IR 不会报错，但画面不会出现对应效果——这是"静默缺失"，比报错更危险，验收必须靠断言而不是靠"没报错"。
3. 每个案例的「现状降级映射」必须包含一行汇总条目，声明本案例用到了哪些扩展草案键（逐键铺开没有必要，但键名要列全）。
4. 若某键连语义都没定义（纯冗余），应删除而不是标注——**标注的前提是它确实表达了某个未来要实现的意图**。
5. 扩展草案的落地排序见 §5.16；本文档不承诺任何提案的实现时间。

A.4 IR 与 render recipe 的字段边界（案例同时给出两块，但归属不同）

案例的 JSON 里同时出现 `assets[]` 与 `render{}`，它们**不属于 IR 持久化模型**，属一次出片的 recipe。若不分清，会出现"改了 crf 就产生一次 IR 变更"这类语义错误。

| 归属 | 字段 | 理由 |
|---|---|---|
| **IR**（持久化、可锚定、可被 Agent 编辑、进 `ir_sha256`） | `schemaVersion`、`meta{width,height,fps,durationSec,background}`、`script`、`voice{provider,voice,rate}`、`words[]`、`tracks[]`、`elements[].{trackId,startFrame,endFrame,params}`、`animations[]`、`effects[]`、`tracks[].assetKey`（**只放引用**） | 这些字段决定"创作内容是什么"，改动必须走乐观锁与版本 |
| **recipe**（渲染时决定、不进 IR、随 render 行持久化以便复现） | `crf`、`preset`、`pixFmt`、`audio{bitrate,loudness,codec,sampleRate}`、`subtitle{mode,fontSizePx,lineRunes}`、`thumbnail{atSec}`、renderer/Chrome/FFmpeg 版本、实际滤镜链、字体 revision、`assets[]{key,kind,bytes,sha256,license}` 清单 | 这些字段决定"这一次怎么出片"，同一 IR 可以有多个 recipe |
| **两者都不该有** | 页面级视觉常量（如 `qrSize`、`paddingX`、`cardColor` 这类复合组件样式键） | 它们要么拆成扁平元素进 IR，要么进 §5.16 P2-7/P2-8 的子 schema；留在 IR 顶层只会成为静默失效的键 |

**因此**：案例里 `assets[]` / `render{}` 两块一律读作"recipe 草案"，验收断言里依赖它们的部分必须写成"recipe 层断言"，不得与 IR 层断言混在一张表里判"IR 合法"。

## 附录 B：断言写法规范

B.1 四层断言的分工（不要跨层越权）

| 层 | 判定对象 | 能回答 | 不能回答 |
|---|---|---|---|
| IR 层 | 校验函数返回值、`resolvedFrom`、`durationFrames` | 输入是否合法、锚点解析到哪、口径是否一致 | 画面长什么样 |
| DOM 层 | `getBoundingClientRect`、`TextMetrics`、`zIndex`、计算样式 | 元素位置/尺寸/层级/文本宽度是否正确 | 像素颜色、动画中间态 |
| 帧层 | PNG 像素、区域统计、帧差 | 视觉是否正确、动效是否发生 | 音频、时长、字幕时序 |
| MP4 层 | 容器元数据（时长/帧数/音轨/字幕流） | 出片是否完整、音轨是否存在、软字幕是否嵌入 | 画面细节 |
| 运维层 | DB 行、River job、配额快照、审计记录 | 一致性、幂等、配额账目 | 视觉质量 |

B.2 像素断言的可计算写法（全部给公式，不留"目视"）

1. **分区平均绝对误差（同镜像回归主判据）**
   `MAE(R) = (1/|R|) · Σ_{(x,y)∈R} Σ_{c∈{R,G,B}} |I₁(x,y,c) − I₂(x,y,c)| / 3`
   阈值：同镜像同版本回归 ≤ 2/255；跨机器/跨 Chrome 版本 ≤ 6/255。区域 `R` 必须是**断言关心的小区域**（文字块、图表柱、价格数字框），不能整屏——整屏 MAE 会被大面积纯色背景稀释到接近 0，从而放过局部错误。
2. **前景占比（用于"元素是否出现/是否被裁掉"）**
   对目标色 `C`，`cover(R,C) = |{(x,y)∈R : ‖I(x,y) − C‖∞ ≤ 12}| / |R|`
   判据形如"价格数字框在第 120–179 帧 `cover ≥ 0.35`，第 0–60 帧 `cover ≤ 0.02`"。前者证明出现，后者证明**没有提前出现**——错峰入场最容易漏的正是后半句。
3. **结构相似度**：`SSIM ≥ 0.98`（整片）/ `≥ 0.995`（单帧）。SSIM 对压缩噪声宽容、对结构错位敏感，适合 L2 成片比对；不适合判断"文字是否被整体平移 2px"（它对平移不敏感），所以文字类必须补 B.2.1 的局部 MAE。
4. **帧差跳变（检测闪烁与关键帧落地）**
   `d(i) = RMSE(I_i, I_{i+1})`；判"无闪烁"：对任意 `i`，`|d(i) − d(i−1)| ≤ 3·median(d)`；判"该帧确有变化"：`d(k) ≥ 5·median(d)`（`k` 为该技术项的生效帧）。
5. **边缘锐度（检测缩放导致的重采样糊）**：`var(Laplacian(I_R))`，与基线比下降超过 20% 即判定缩放插值异常。这条专门用来钉住 T-05/T-06 的伪 3D 缩放。

B.3 DOM 断言的容差

| 断言 | 写法 | 容差 |
|---|---|---|
| 元素位置 | `getBoundingClientRect()` 与 IR 的 `x/y/w/h` 比对 | ±1 device px（`deviceScaleFactor=1`） |
| 元素层级 | 计算样式 `zIndex` 与 `1+el.z` 比对 | 精确相等 |
| 文本宽度 | `canvas.measureText` 或 `TextMetrics.width` | ±1 px（同一字体同一字号下稳定） |
| 缺字检测 | `document.fonts.check('700 48px "Noto Sans SC"', 待测字符)` | 返回 `false` 即判定缺字，必须失败而非回退 |
| 可见性 | `opacity` / `transform` 计算值 | 精确比对，不接受"接近" |

B.4 时序断言的硬约束

- `seek(f)` 后 `__player` 回报的 `frame` 必须等于 `f`（现实现内部 `Math.round`，输入整数帧时零偏差）。
- 字幕 cue：单条 ≤2 行、每行 ≤16 rune、单条 ≤6s、相邻 cue 间隔 ≥ 2 帧；行首不得为 `，。！？；：、` 等禁则标点。
- 音频：voice 最后一个词的 `end` 必须 ≤ `voice.durationSec`（`ir.go:263` 已强制，测试必须验证它真的会拒绝）。

B.5 每条断言的必备字段

`assert_id | 判定对象 | 判据（公式/字段/容差） | 采样点（帧号或时刻） | 失败含义 | 对应技术项`

缺任一字段的断言视为无效断言，不进 §7 的判定表。

## 附录 C：素材、字体与命名规范

C.1 图片

| 项 | 规格 | 依据 |
|---|---|---|
| 格式 | 文字/图表/UI 截图用 PNG；实拍用 JPEG q≥85 | 文字边缘锐度直接决定 B.2.5 判据 |
| 单图上限 | 解码后 ≤1 MiB；单项目 ≤64 张 | 架构文档 §5.2.8 |
| 尺寸 | 不超过画布 2 倍（如 1080×1920 画布用 ≤2160×3840），避免 `object-fit: contain` 后过度缩小 | `projector.go` 模板 `img{width:100%;height:100%;object-fit:contain}` |
| 命名 | `video/<workspace_id>/<purpose>-<hash8>.<ext>`，如 `video/ws_01/shot-cover-a1b2c3d4.png` | `ir.go:355` 要求 `video/` 前缀；禁止 `://` 与 `data:` |
| 禁止 | 外链 URL、SVG（可含脚本与实体）、polyglot 文件 | 安全用例见 §6 |

C.2 音频

| 项 | 规格 |
|---|---|
| voice | 48 kHz / 单声道 / AAC 128k 或 WAV；时长必须 ≥ 末词 `end` |
| BGM | 44.1 kHz 源，合成前重采样到 48 kHz；`volume ∈ [0,1]`（`ir.go:452`） |
| 响度目标 | `I = -16 LUFS`，`TP = -1.5 dB`，`LRA = 11`（架构文档 §9.3；现 `MuxAV` 未实现，见 §5.13） |
| BGM 时长不足 | 必须显式 loop 或 pad，现实现不 loop（`encode.go:147`），案例要按"BGM 覆盖全片"选曲 |

C.3 字体

| 项 | 规格 |
|---|---|
| 字体族 | `Noto Sans SC`（正文）+ `Noto Sans`（拉丁/数字），`PingFang SC`/`Microsoft YaHei` 仅作本机回退，**不得作为验收依据** |
| 字重 | 现有模板只区分常规与 `.counter` 的 700；`font-weight` 无 IR 入口（`projector.go` 模板 CSS） |
| 子集 | 必须覆盖案例脚本全部字符 + 数字 + 标点；生僻字、异体字、emoji 需单独验证 |
| 授权 | OFL / 商用授权文件随仓库登记，`assets[]` 记录 |
| 缺字策略 | 渲染路径必须 fail closed（架构文档 §9.1）；当前 `img.decode` 吞错、字体无检测，属缺口 |

C.4 命名与 ID

- 元素 `el_*`、动画 `an_*`、特效 `ef_*`、轨道 `tr_*`、词 `w*`（案例内从 `w01` 起编号）。
- ID 在各自命名空间唯一；案例编号 `VS-C01…VS-C09`；断言 `A-C01-01…`；故障 `F-<域>-<序号>`；性能 `P-<序号>`。

## 附录 D：术语表

| 术语 | 含义 |
|---|---|
| IR | 中间表示，创作状态的唯一真值；项目行只存运营元数据 |
| composition | 一个时间轴单元；现实现只有一个 `timelines['main']` |
| track | 轨道，承载一组元素与统一 `z`/音量语义 |
| element | 画布上的一个图层，`image/text/shape` |
| word anchor | 以词为时间定位点；稳定身份应为 `wordId`，现实现用"文本+出现序号" |
| resolvedFrom | 锚点解析审计结果（`wordIndex` + `reason`） |
| seek | 出片用的定帧；`play` 只服务预览 |
| still | 单帧 PNG，L1 golden 的基本单位 |
| golden | 经评审固化的基线图/基线数据，未评审的产物不是 golden |
| recipe | 可复现一次出片的配方（依赖版本、滤镜链、资产清单、IR 哈希） |
| at-least-once | 队列语义；worker 必须幂等，不能假设 exactly-once |
| rescue | River 对超时/失联 job 的重新调度机制 |
