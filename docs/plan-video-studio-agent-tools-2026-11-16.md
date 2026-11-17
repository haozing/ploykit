# 视频创作 Agent 工具面：编排旅程走查与缺口提案（2026-11-16）

状态：提案（只读走查产物，本文档零业务代码改动）。
范围：`example/internal/video` MCP 工具面 + app 服务面 + render/capx 底层。
并行批说明（**历史背景；2026-11-17 对账见下文"落地对账"块**）：本文 §1 走查时的工树状态为
`adapters/mcp/tools.go` 共 16 个 `mcpAdd` 注册（未含批E），批E 合入后预计 17。**实际最终落地
26 个工具**——§1 表格的 16/17 基线仅作走查时点记录保留（当时各节"现有工具"描述亦以该基线为准），
现状以下方对账块为准。

---

## 落地对账（2026-11-17）

本文 §1 走查时的基线（16 个 `mcpAdd`、批E 合入后 17 工具）已增长到 **26 个唯一 `video_*` 工具**
（`example/internal/video/adapters/mcp/tools.go` 内 `mcpAdd(s, ...)` 注册 26 处 = 26 个唯一工具；
文件内 "mcpAdd" 字样共 30 处，另含 1 处函数定义与 3 处注释。REST 面 `adapters/http/routes.go:78-91`
共 13 条路由，check_api 契约零漂移）。**§2 缺口提案 G-01~G-11 全部落地**（仅 G-08(b) 静态缩略图
仍挂 ROADMAP 触发制），逐项行号证据：

| 提案 | 落地工具 | 证据行号 |
|---|---|---|
| G-01 | `video_set_audio` | tools.go:312（compose 保音频补丁 service.go:994 `Audio == nil` 回填） |
| G-02 | `video_preview_frames` | tools.go:510 |
| G-03 | `video_validate` | tools.go:742（实现拆在 adapters/mcp/validate.go） |
| G-04 | `video_list_elements` | tools.go:822 |
| G-05 | `video_remove_element` | tools.go:875 |
| G-06 | `video_set_meta` | tools.go:903 |
| G-07 | `video_render_frames` | tools.go:986 |
| G-08a | layout 字段并入 `video_list_templates` 目录投影 | tools.go:682；`app/template/template.go` Template struct `Layout` 字段（:54-57，中文版式摘要已随种子数据落地） |
| G-09 | `video_list_assets` | tools.go:966 |
| G-10 | `video_list_renders` | tools.go:928 |
| G-11 | `video_delete_project` | tools.go:950 |

- **G-08b（静态缩略图 24 张 golden PNG）仍挂 ROADMAP 触发制**，未落地——维持 §4 P2 的预
  agreed 方案，触发条件不变（首个 agent 反馈"文字版式描述仍盲选"）。
- **附带发现 #1 注释债复核**：tools.go:1-8 包注释已在批F 描述清理中重写，不再携带工具计数
  （"12 video_* MCP tools" 字样已不存在，全仓 grep 无命中）——该债已顺带清偿，无需再排
  代码批修。
- 本文其余章节（§1 走查、§2 提案正文、§3 驳回记录、§4 拍板建议）保留 2026-11-16 原文作为
  **设计记录**，仅加状态标记；文内行号引用以走查当时的工作树为准，与当前 26 工具态不对应，
  落地态一律以上表为准。v2 重构对本工具面契约的影响见文末 §5。

---

## 1. 编排旅程走查（agent 从零到成片的完整决策链）

| # | 旅程步骤 | 需要的能力 | 现有覆盖 | 结论 |
|---|---|---|---|---|
| 1 | 理解任务（主题/文案/参考） | 大模型自身认知，无需工具 | —（对话输入） | 覆盖 |
| 2 | 设计卡片结构（几张卡/版式/层级） | 模板目录 + 版式认知 | `video_list_templates`（tools.go:313）仅文字描述 + 尺寸参数 | 部分覆盖：agent 盲选版式（→G-08） |
| 3 | 填充内容 | script→IR 一键合成 + 手搭逐元素 | `video_compose`/`video_set_card`（tools.go:329,352）覆盖合成主路；手搭路有 `video_upsert_element`/`video_move_element`/`video_animate_element` | 合成路覆盖；手搭路缺 meta 调整（→G-06）与元素删除（→G-05） |
| 4 | 视觉自查（看一眼再改） | 单帧 + 多帧截图 | 批E `video_snapshot_frame`（在途）给单帧眼 | 单帧够用；多帧批量缺（→G-02 提效） |
| 5 | 精修循环（move/animate/effect） | 元素发现 + 定点修改 + 删除 | move/animate/add_effect 有；元素 id 发现只能拉全量 `video_inspect`（tools.go:90，回全 IR + resolutions） | 缺轻量清单（→G-04）、缺删除（→G-05） |
| 6 | 音频（BGM/配音） | 上传 + 挂载 + 验证 | `video_upload_asset` 收 audio（tools.go:236-240）；**挂载无工具**：`SetAudio` 服务方法存在（service.go:965）但 MCP/REST 均未暴露（http/routes.go 全表无 audio 路由） | **断链**：BGM 传得上去、上不了片（→G-01）；且 compose 会抹掉已挂音频（见下） |
| 7 | 出片前检查 | 验证 IR 可渲染、能力在线、配额 | 写时已有全量门（`Mutate` 内 Validate + validateAssetRefs + ResolveAll，service.go:273-286），存量 IR 永远合法；但能力/配额状态与帧数预览无读路径 | 提效缺口（→G-03） |
| 8 | 出片 | 提交 + 轮询 | `video_render`（幂等键，tools.go:272）/`video_get_render`（tools.go:295）；渲染历史无 MCP 工具（ListRenders service.go:1166 仅 REST，routes.go:85） | 基本覆盖；历史查询缺（→G-10） |
| 9 | 成片质检 | 验证编码后真实画面 | 只有 output_url 下载；**无成品抽帧**。capx.ExtractThumbnail 存在（platform/capx/encode.go:279）但硬编码 `-ss 00:00:01` 且无人调用（thumb 管线是 stub，render/render_pipeline.go:323-330） | 缺口（→G-07） |

### 走查中的四个关键事实（提案的依据）

1. **音频挂载是死胡同**：`video_upload_asset` 描述承诺 "Returns the storage key for element src
   / audio keys"（tools.go:240），但整个 MCP 面（及 REST 面）没有任何工具能把 key 写进
   `ir.audio.voice/bgm`——`SetAudio`（service.go:965-974）是唯一入口，未暴露。上传成功的音频
   永远到不了片里。配音同理：estimated 词表时 agent 想走"上传人声 + aligner 对齐"路，也需要先
   有 `audio.voice.key` 才能触发 aligner（service.go:777），MCP 下不可达。
2. **compose/set_card 会整体替换 IR 并抹掉 audio**：`ComposeProject` 闭包 `*ir = composed`
   （service.go:170-175），而 scriptgen.Compose 组装的 IR 不含 Audio 字段
   （app/scriptgen/compose.go:69-110）→ 已挂 BGM 在每次文案修改（set_card 即 compose）后静默丢失。
   SetScript 则保留 audio（service.go:663）——行为不一致。
3. **音频 key 无存在性校验**：写时 `validateAssetRefs` 只检查 image 元素的 src
   （service.go:375-378）；`validateAudio`（ir.go:487-510）只查 key 形状不查登记。挂一个
   未上传的 BGM key 会在渲染期才失败（worker tempFile 拉流失败 → render failed，配额有补偿
   release，render/worker.go:56-67、143）——错误暴露晚了整整一个渲染周期。
4. **BGM 大文件上传通道也不通**：MCP 路径 ≤700KB（UploadLimit，service.go:66）；REST multipart
   继承 /api 1MiB 默认门（service.go:63-65 注释）。一首 3 分钟 BGM（≈3MB）两个口都进不来。

---

## 2. 缺口提案

### G-01 video_set_audio（挂载配音/BGM）【已落地 2026-11-17（tools.go:312）】
- 旅程位置: 步骤6 音频（P0）
- 缺口: 音频资产传得上去、永远挂不到片上；且 compose 抹音频、音频 key 无写时校验、大文件无上传通道。
- 提案: `video_set_audio(project_id, voice{key,volume}|null, bgm{key,volume}|null, expected_version)`
  → 直接包 `ProjectService.SetAudio`（service.go:965，现成）。实现要点四件：
  (a) 工具层挂载前查 `video_asset` 登记行（同 validateAssetRefs 的查询，service.go:382-385），
  未登记报 `E_VIDEO_IR_INVALID`，把渲染期失败提前到写时；
  (b) **compose 保音频补丁**：`ComposeProject` 闭包在 `composed.Audio == nil` 时回填 `ir.Audio`
  （service.go:170-175，~3 行）——与 SetScript 行为对齐，消除 set_card 静默丢 BGM 的坑；
  (c) REST 资产路由按 AGENTS.md 挂载指引放宽 body limit（`webx.BodyLimitExcept`，example
  侧 wiring，随本工具一批做），否则 BGM 依旧进不来；
  (d) null 语义 = 清除对应轨（Audio 指针字段天然支持，ir.go:161-165）。
- 价值: **high**——音频是编排旅程的断链：上传工具承诺了 audio keys 却无消费路径（半接线，
  违反 "capability fully wired" 纪律）；aligner 降级链也被它卡死。
- 成本: 工具 ~40 行 + 服务补丁 ~5 行 + wiring 一处；小。
- 依赖: `SetAudio`（已存在）、`Mutate` 全量门、`video_asset` 表（migration 1011）。

### G-02 video_preview_frames（多帧批量截图）【已落地 2026-11-17（tools.go:510）】
- 旅程位置: 步骤4 视觉自查（P1，接近 P0 的提效）
- 缺口: 自查一轮要 N 次单帧调用，每次重复投影文档（字体/资产内联是重头）+ 浏览器 seek，RTT 与算力双浪费；"卡与卡切换对比"天然需要 ≥2 帧一次拿到。
- 提案: `video_preview_frames(project_id, times_sec[4..6], format=jpeg)` → 一次调用返回
  `[{time_sec, frame, image_base64}]`。实现要点：批E `video_snapshot_frame` 的文档构建路径
  直接复用（projector.HTML + capx seekTimeline，platform/capx/renderer.go:269）；差异只在
  "seek→capture" 循环 N 次而非 1 次，文档只构建一次。JPEG 默认（PNG 1080×1920 base64 单帧
  可达数百 KB，6 帧会撑爆 MCP 响应体；capx 抽帧既有 JPEG 先例 encode.go:290-293）。帧号口径
  沿 §7.0：frame = ceil(t × fps)。**依赖批E 合入后实现，避免 tools.go 文件冲突**。
- 价值: high（提效幅度最大的一项：6 帧 6 RTT → 1 RTT，文档构建成本 ×1）。
- 成本: ~80-120 行（含响应尺寸钳制）；中。
- 依赖: 批E snapshot 通路、capx RenderFrames/seekTimeline、PreviewResolver。

### G-03 video_validate（出片前预检门，dry-run）【已落地 2026-11-17（tools.go:742）】
- 旅程位置: 步骤7 出片前检查（P1）
- 缺口: agent 提交渲染前无法低成本回答"现在提交会发生什么"——渲染能力是否在线、大约出多少帧、锚点是否有 missing、音频轨摘要、词表是否会被静默截断。
- 提案: `video_validate(project_id)` → 只读预检，**不建 render 行、不扣配额、不 version++**。
  返回 `{renderable, capability_online, frames_total, resolutions(仅汇总计数+missing 清单), audio{voice,bgm 的 key/durationSec/words_source}}`。
  实现要点：**不重建 Mutate 校验管线**——存量 IR 经写时门必然通过 Validate + 素材引用检查
  （service.go:273-286），重建是浪费（此为对"全量 dry-run"候选的收窄，见 §3）。新增的检查
  只有两项：能力探针（`Ports.Cap.CapAvailable()`，ports.go:98-100）+ **末词截断检查**
  （`words` 末词 end ≤ max(meta.durationSec, voice.durationSec)——现有 Validate 只查 voice
  侧，ir.go:321-327，无配音时 words 超时长会被 DurationFrames 静默截掉，service.go:1091-1104；
  这项先落 preflight，是否升级为写时硬校验另行拍板）。配额余量 v1 置 `unknown`
  （QuotaPort 无读方法，ports.go:75-86，扩展端口另行挂账）。
- 价值: medium-high——写时门已把"IR 非法"提前到编辑期，预检的增量在能力/配额状态、帧数
  预览与截断告警；省的是一次注定失败的 submit 与往返排查。
- 成本: 服务 Preflight 方法 ~60 行 + 工具 ~30 行；小-中。
- 依赖: Get、CapProbe、DurationFrames、ResolveAll（全部现成）。

### G-04 video_list_elements（轻量元素清单）【已落地 2026-11-17（tools.go:822）】
- 旅程位置: 步骤5 精修循环（P1）
- 缺口: 精修需要 element id，唯一发现途径是 `video_inspect` 回全量 IR（≤256KiB，ir.go:207）+ resolutions，token 成本高；多数场景只需"id/type/几何/文本截断"。
- 提案: `video_list_elements(project_id)` → `[{id,type,x,y,w,h,z,text(截64字),start_frame,end_frame,animation_count}]`。工具层直接 `Svc.Get` 后投影，**零服务改动**。
- 价值: medium-high——精修循环高频调用，token 与 RTT 双省。
- 成本: ~40 行（纯投影）；小。
- 依赖: `Get`（service.go:516，现成）。

### G-05 video_remove_element（元素删除）【已落地 2026-11-17（tools.go:875）】
- 旅程位置: 步骤3/5 填充与精修（P1）
- 缺口: MCP 面只能 upsert/move，删不掉元素（手搭路放错一个 shape 只能 REST `PUT /ir` 全量替换，routes.go:81，MCP agent 不可达）。
- 提案: `video_remove_element(project_id, element_id, expected_version)` → 新服务方法
  `RemoveElement`（~15 行，走 `Mutate`，沿用 MoveElement 的 unknown-id 复用 `ErrAnchorNotFound`
  惯例，service.go:928）；注意级联：删除被 `Effect.TargetElementID` 引用的元素会被现有
  Validate 拒绝（ir.go:305-310）——报错信息已足够指引 agent 先删 effect。
- 价值: medium——手搭路径的完整性缺口（有写无删）。
- 成本: 服务 ~15 行 + 工具 ~20 行；小。
- 依赖: Mutate、现有 targetElementId 校验。

### G-06 video_set_meta（画布/时长调整）【已落地 2026-11-17（tools.go:903）】
- 旅程位置: 步骤3 填充内容·手搭路径（P1）
- 缺口: 手搭项目初始 IR 固定 10s/1080×1920（service.go:446），MCP 无任何工具能改
  meta.durationSec/width/height；合成路由 composer 派生时长不受影响，手搭路则被钉死。
- 提案: `video_set_meta(project_id, duration_sec?, width?, height?, fps?, expected_version)` →
  新服务方法 `SetMeta`（~20 行走 Mutate；fps 白名单/尺寸范围/时长>0 由现有 validateMeta 把关，
  ir.go:338-355；startFrame 窗口越界由现有窗口校验拒绝，ir.go:468-483）。注意事项写入工具
  描述：缩时长 + 无配音时末词会被截断（G-03 的 preflight 会告警）。
- 价值: medium-high（手搭路径的唯一时长出口；合成路径不需要）。
- 成本: 服务 ~20 行 + 工具 ~25 行；小。
- 依赖: Mutate、validateMeta、窗口校验（全部现成）。

### G-07 video_render_frames（成品抽帧）【已落地 2026-11-17（tools.go:986）】
- 旅程位置: 步骤9 成片质检（P1）
- 缺口: 拿到 output_url 后 agent 对"编码后的真实画面"零可见性——IR 截图（批E）看到的是
  投影文档，不是带字幕烧录/软字幕/音画合成/编码失真的最终 MP4。两者互补，缺后者则质检闭环
  少最后一环。
- 提案: `video_render_frames(render_id, times_sec[], format=jpeg)` → 从 `output.mp4` 抽帧
  返回 base64。实现要点：(a) capx 侧把 `ExtractThumbnail` 泛化为可传任意 `-ss` 的
  `ExtractFrameAt(ctx, videoPath, t, w)`（现硬编码 `00:00:01`，encode.go:279-297，~15 行平台改动）；
  (b) 域侧新增端口 `FrameExtractor`（与 CapProbe 同模式，ports.go:98-100 先例——app 不 import
  capx，实现在 render/ 包 capx tag 下，stub 默认 build 同款）；(c) 工具 handler：
  `Store.Open(outputKey)` → 临时文件 → 抽帧 → base64（复用 worker tempFile 模式，
  render/render_pipeline.go:306-321）。**顺带收益**：管线里 `firstThumb` 至今是返回 nil 的 stub
  （render_pipeline.go:323-330），而 `deriveURLs` 已在对外承诺 thumb_url（service.go:1156-1163，
  现恒 404）——本项落地时可一并接真 thumb。
- 价值: high（成片质检唯一手段；同时关闭 thumb 恒 404 的承诺缺口）。触发时机可与批E 后的
  G-02 同批（共享"返回 base64 图"的响应约定）。
- 成本: 平台 ~20 行 + 端口/adapter ~60 行 + 工具 ~50 行；中。
- 依赖: capx ffmpeg 通路、storagex.Open、render 行的 OutputKey。

### G-08 模板版式信息增强（设计卡片的眼）【(a) 已落地 2026-11-17（template.go `Layout` 字段 + tools.go:682 目录投影）；(b) 静态缩略图【挂触发制】】
- 旅程位置: 步骤2 设计卡片结构（P2）
- 缺口: `video_list_templates` 只有文字描述 + 画布参数（compose.go:32-38 目录投影），agent
  盲选版式，选错只能 compose 后截图返工。
- 提案（分层）: (a) 近零成本先行——目录数据源注入处（main.go 闭包，template 包可达）为每个
  模板补 `layout` 字段：按 card role 列元素清单（"cover: 标题条+副题+页码, listicle: 题头条+
  条目行×N+页码"），纯文本，~30 行；(b) 静态缩略图（6 模板 × 4 主题 = 24 张 PNG 内嵌资产，
  构建期用 scriptgen.Prepare + 真实渲染器产 golden 图）**挂 ROADMAP 触发**——因为 agent 已有
  零成本的替代路：`video_compose` + 批E snapshot 看真卡（代价是多一轮 RTT）。
- 价值: medium（(a) 够用；静态图锦上添花）。
- 成本: (a) ~30 行；(b) 构建脚本 + 24 资产，中。
- 依赖: template 包 Apply、目录注入闭包（compose.go:72-76）。

### G-09 video_list_assets（资产清单）【已落地 2026-11-17（tools.go:966）】
- 旅程位置: 步骤3/6 素材管理（P2）
- 缺口: 上传后 key 只在当次响应里；断线重连/跨会话找资产只能翻历史。`ListAssets` 服务方法现成（service.go:1313）仅 REST 未挂（http/routes.go 无 assets GET）。
- 提案: `video_list_assets(project_id)` → 薄包装（kind/key/bytes/content_type/created_at），~25 行。
- 价值: low-medium。成本: 小。依赖: `ListAssets`（现成）。

### G-10 video_list_renders（渲染历史）【已落地 2026-11-17（tools.go:928）】
- 旅程位置: 步骤8 出片（P2）
- 缺口: agent 只能按 render_id 查单条；"上一次渲染成功了吗"无查询路径。`ListRenders` 现成（service.go:1166，REST 已挂 routes.go:85）。
- 提案: `video_list_renders(project_id)` → 薄包装（id/status/frames/output_url/error 摘要），~25 行。
- 价值: low-medium。成本: 小。依赖: `ListRenders`（现成）。

### G-11 video_delete_project（项目清理）【已落地 2026-11-17（tools.go:950）】
- 旅程位置: 全旅程收尾（P2）
- 缺口: agent 试错会积累项目，无清理工具（`Delete` 现成 service.go:550，REST 已挂 routes.go:82；删除还带资产存储清扫）。MCP PAT 场景下的生命周期不完整。
- 提案: `video_delete_project(project_id)` → 薄包装，~20 行；描述里写明级联语义（renders/assets FK 级联 + 存储清扫，service.go:558-592）。
- 价值: low-medium（多轮试错后卫生问题）。成本: 小。依赖: `Delete`（现成）。

---

## 3. 候选验证与驳回记录

| 候选 | 裁定 | 理由 |
|---|---|---|
| video_preview_frames 多帧批量 | **采纳展开**（G-02，P1） | 价值成立；实现收窄为"批E 通路循环 N 次"，JPEG 默认控响应体；依赖批E 先合入 |
| video_validate dry-run | **采纳但大幅收窄**（G-03，P1） | "重建 Mutate 全量校验管线"驳回：写时门已保证存量 IR 合法（Validate + 素材引用 + 锚点，service.go:273-286），dry-run 重建是重复劳动。收窄为预检读路径：能力探针 + 帧数 + 锚点汇总 + 音频摘要 + 末词截断告警（后一项是真实存在的校验盲区） |
| video_list_elements 轻量清单 | **采纳**（G-04，P1） | 成立，零服务改动 |
| 成品抽帧 | **采纳展开**（G-07，P1） | 成立；指出 capx `-ss` 硬编码需平台小改、需走端口模式（app 禁 import capx）；顺带关闭 thumb stub 恒 404 |
| 版式缩略（模板目录带示意图） | **部分驳回**（G-08 降级，P2） | 24 张静态 PNG 的构建/维护成本与其增益不匹配——agent 已有 compose+snapshot 的替代路；先行落地近零成本的版式文字描述，静态图挂 ROADMAP 触发 |
| 音频探针（独立工具） | **驳回独立工具，折入 G-03** | 音频摘要（key/durationSec/words_source）只是 validate 响应里的一个块，不配一个独立工具；真正的音频缺口是挂载（G-01），不是探针 |
| （走查新发现）video_set_audio | **新提案**（G-01，P0） | 断链证据见 §1 事实 1-4 |
| （走查新发现）remove_element / set_meta / list_assets / list_renders / delete_project | **新提案**（G-05/06 P1，G-09/10/11 P2） | 服务方法均在、MCP 面缺失；REST-only 不算覆盖（MCP agent 不可达） |

---

## 4. 拍板建议

### P0 —— 编排闭环必需（本批就做）

| 项 | 建议批次 | 落地状态（2026-11-17 对账） |
|---|---|---|
| **G-01 video_set_audio**（含 compose 保音频补丁 + 音频键写时校验 + REST 资产路由 body limit 放宽） | **本批/紧随批E 的实现批立即排**。它是唯一"上传承诺了但消费不到"的半接线断链，且卡死 aligner 降级链与 BGM 全流程；四件实现点均小 | **已落地**（tools.go:312；compose 保音频补丁见 service.go:994） |

P0 仅此一项：批E 落地后"眼"即闭环，其余缺口均为提效而非断链。

### P1 —— 显著提效（小批跟进，建议 G-02/G-07 一批、G-03/04/05/06 一批）

| 项 | 建议批次 | 落地状态（2026-11-17 对账） |
|---|---|---|
| G-02 video_preview_frames | 批E 合入后紧随（同文件 tools.go，必须串行） | **已落地**（tools.go:510） |
| G-07 video_render_frames（成品抽帧 + thumb 接真） | 与 G-02 同批（共享 base64 图响应约定；capx 平台改动先行） | **已落地**（tools.go:986） |
| G-03 video_validate / G-04 video_list_elements / G-05 video_remove_element / G-06 video_set_meta | 一个小批打包（合计 ~300 行，互相独立可拆） | **已落地**（tools.go:742 / :822 / :875 / :903） |

### P2 —— 锦上添花（挂 ROADMAP 触发制）

照 docs/ROADMAP.md「Video Rendering」节既有风格登记：

| Area | Item | Trigger / Notes | 落地状态（2026-11-17 对账） |
|---|---|---|---|
| `video` MCP | 模板静态缩略图（G-08b） | 首个 agent 反馈"文字版式描述仍盲选"（G-08a 文本层先行落地）。预 agreed：构建期 scriptgen.Prepare + 真实渲染器产 6×4 golden PNG 内嵌 template 包 | **仍挂触发制**（未落地；G-08a 已落 template.go `Layout` 字段） |
| `video` MCP | video_list_assets（G-09） | 首个跨会话资产复用需求（agent 在多项目间搬素材）。薄包装现成 | **已落地**（tools.go:966） |
| `video` MCP | video_list_renders（G-10） | 首个"多轮渲染对比/审计"需求。薄包装现成 | **已落地**（tools.go:928） |
| `video` MCP | video_delete_project（G-11） | 首个 agent 试错积累导致项目列表失序。薄包装现成（级联语义已在 Delete） | **已落地**（tools.go:950） |
| `video` | validate 写时硬校验升级（末词 end ≤ max(meta, voice) 时长） | G-03 preflight 上线后若截断告警高频命中，再升写时门（契约变更，随 openapi 窗口） | **仍挂触发制**（preflight 已落 tools.go:742；写时门升级未做） |
| `quota` | QuotaPort 读方法（余量查询，G-03 配额字段从 unknown 变实数） | 首个 agent 需要在提交前规划配额时。端口加 `Remaining(ws, key, now)`，实现走 quota_counter 现行行 | **仍挂触发制**（未落地；ports.go 尚无 `Remaining`） |

### 一段话结论

工具面在"合成主路 + 出片"上已经闭环（compose/generate/render/get_render），批E 补上单帧眼。
真正的断链只有一个：**音频上传后无挂载路径**（G-01，P0）。其余缺口按价值排序是：多帧自查
（G-02）> 成品抽帧（G-07）> 预检（G-03）> 精修配套（G-04/05/06）> 目录/清单/清理（P2）。
所有 P1/P2 提案的服务侧方法多数已存在（薄包装），增量集中在 tools.go 注册与两处小平台改动
（capx 抽帧参数化、audio 键校验）。

### 走查附带发现（不立项，供批F/后续参考）

1. tools.go:2 包注释仍写 "12 video_* MCP tools"，实为 16（批E 后 17）——批F 描述清理时可顺手改。（2026-11-17 对账：批F 重写包注释后已不再携带任何工具计数，本项注释债已顺带清偿，无需再排代码批。）
2. `deriveURLs` 对外承诺 thumb_url（service.go:1156-1163）但管线从不产出 thumb（render_pipeline.go:323-330 stub）→ REST 响应里的 thumb_url 现恒 404；G-07 落地时一并接真。
3. `validateAudio` 不查音频 key 的资产登记（ir.go:487-510 只查形状），image src 有写时校验而音频没有——不对称，G-01(a) 补齐。
4. `video_generate_video` 的幂等键固定为 project_id（tools.go:447）→ 同一项目第二次调用 generate 永远返回首轮 render（重试安全，但"同项目再出一版"会被幂等挡住）；可在工具描述里补一句引导（改用 video_render + 自选 request_id）。

---

## 5. v2 对本工具面的影响（2026-11-17 附记）

`docs/plan-video-studio-ir-v2-2026-11-17.md` 已立项（schemaVersion 2 一次性迁移、不做兼容层，
builder 不保留 v1 推断路径）。本文的 26 工具面是 v1 IR 契约上的产物，v2 落地时以下工具契约
会变，届时需随 v2 同步改入参：

1. **时间锚第一类化（`at: {frame}|{wordId}`）**：v1 的词锚是分散的特殊入参
   （`video_animate_element` 的词锚挂点、`video_add_effect_at_word` 的按词定位）。
   IR v2 把时间锚升级为第一类联合类型后，两个工具的入参契约会收敛到统一的 `at` 字段
   （帧锚/词锚同形），词锚不再是硬编码特例。
2. **`audio.tracks[]` 多轨**（v2 §3.2）：v2 废除 `voice`/`bgm` 固定双轨，并入
   `tracks[]`（`assetKey` / `kind: voice|bgm|sfx` / `inSec` / `outSec` / `volume` /
   `fadeInSec` / `fadeOutSec`，轨内事件可 `at: {frame}` 锚定）→ `video_set_audio`
   （tools.go:312）从 voice+bgm 两参数扩展为 tracks 数组语义（sfx 轨与帧锚落点一并入契约）；
   v2 的写时资产登记校验对称 image src，本文 G-01(a) 的校验模式直接沿用。
3. **scene 元素类型（引擎即渲染器，v2 §3.5）**：IR v2 引入 scene 元素承载引擎 canvas
   分层合成（引擎 canvas z0 + IR 声明层 z10+，一个 IR、一个时钟、一套混音），工具面将新增
   一个工具家族（渲染器注册、scene 元素 upsert/编排等），超出本文 v1 的
   text/shape/image 三类元素范畴。
4. **探针一等化（v2 §3.4）**：capx seekTimeline 包装为 video 域导出的 `ProbeFrames`，
   harness 探针门与 MCP 的 `video_preview_frames`/`video_render_frames` 打通同一实现——
   本文 G-02/G-07 确立的"返回 base64 图"响应约定可平移复用。
5. **方法论复用**：本文的走查方法论（§1 编排旅程逐站对能力 → §2 缺口提案 G-xx →
   §3 候选验证与驳回记录 → §4 拍板分层 P0/P1/P2）在 v2 工具面设计时整套复用——v2 落地后
   按新 IR 契约重跑一轮 §1 走查，即可产出 v2 工具面缺口清单。
