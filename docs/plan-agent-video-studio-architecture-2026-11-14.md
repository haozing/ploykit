# Agent 视频工作室：详细架构设计

- **版本**：v1.1（2026-11-14，审计修订；记录见 §12）
- **状态**：设计稿（未实施）
- **性质**：工作记录（`plan-` 前缀中文文档，豁免于 docs 语言守卫）；正式决策另落 `docs/adr/0017-agent-video-studio.md`（英文）
- **前置输入**：外部设计稿 v2.0（远程 MCP 工具层 + 语义 IR + HyperFrames 确定性渲染）
- **配套文档**：兼容性影响评估见 [plan-agent-video-studio-compat-2026-11-14.md](./plan-agent-video-studio-compat-2026-11-14.md)
- **一句话**：保留"IR 唯一真相源 + Agent 操数据不操页面 + 词锚点"的全部思想；把 L1–L4 的载体换成 ploykit 已有件（mcpx / wsx / river / storagex / quota / audit / authz），净新增只有平台包 `capx` 与产品域 `video`。

---

## 1. 设计原则与决策总览

### 1.1 五条不变量（贯穿全文）

1. **IR 是唯一真相源**：Agent（MCP）、人肉 UI（HTTP）、预览（iframe）、渲染（worker）全部读写同一份 `video_project.ir`；不存在第二份"预览用数据"。
2. **工具层零渲染**：MCP/HTTP handler 只做 IR 状态变更（校验、锚点、持久化、通知），绝不做截图/编码/seek。
3. **预览与成片同代码同帧语义**：投影函数只有一份（Go），GSAP 暂停时间线只有一条（timeline-builder.js），iframe 预览与无头渲染消费同一投影产物；scrub 与服务端 seek 是同一个函数。
4. **渲染定格于快照**：每次渲染携带 `ir_snapshot`；渲染过程中 Agent 改 IR 不影响在途任务，出片可复现、审计可回放。
5. **影响半径受控**：业务语义隔离在产品域（example/internal/video），框架侧只新增零业务依赖的 `platform/capx` + 一个 UI 组件；既有接口零修改（见配套兼容性文档）。

### 1.2 决策表（对外部设计稿 v2.0 的取舍）

| # | 决策 | 原方案对应 | 依据 |
|---|---|---|---|
| D1 | **MCP 工具面用 `platform/mcpx`，不建独立 Node 服务** | L1 Node.js MCP Server | mcpx.go:55 `NewMount`；stateless 传输把 Authenticate 的 Principal 带进每个工具 handler ctx（ADR 0014:21）；PAT scope 工具内强制（devx tools.go:157 模式）；example 已挂 `/mcp`（main.go:831-844） |
| D2 | **取 HyperFrames 契约、不引其依赖**：HTML + `data-*` + 注册在 `window.__timelines` 的 `{paused:true}` GSAP 时间线 + 逐帧 seek 截图 | L3 HyperFrames 渲染层 | 全仓无 chromedp/rod/playwright（go.mod 盘点）；契约自有化后引擎可插拔（§3.5 的 Renderer 接口留远程 render server 槽位），且保持单二进制、单鉴权、单审计 |
| D3 | **单一投影函数**：预览=同一 HTML 的 iframe，渲染=同一 HTML 的 SetDocumentContent | L2 "React + GSAP 重映射" | 原方案自身担心"预览/渲染两套数据"；我们把同构延伸到代码层——动效语义只有一份实现，杀死漂移 |
| D4 | **词锚点 = (text, occurrence)，重写脚本时最近邻重解析并写 resolvedFrom** | 4.2 词锚点语义 | 纯 text 锚点在重复词上语义破碎；位置最近邻是可表驱动测试的确定算法（§4.2.4） |
| D5 | **渲染 = river 异步作业**（自有 video 队列，MaxWorkers 1），工具只提交 | 决策 3 | 渲染是长 CPU 任务；schedule 域自有 river client 直接先例（schedule/fireworker.go:24 + main.go:1015-1020） |
| D6 | **语音/对齐是可选端口**：TTS 供应商优先直出词级时间戳；WhisperX sidecar 仅在上传音频场景需要；缺 env 时降级为估算词时（`source=estimated`） | L4 WhisperX 必经 | AGENTS.md：可选外部能力"全接线、env 缺失静默降级"；少一跳、少一个 sidecar |
| D7 | **video 表走 example 产品迁移 1xxx；配额度键 = plan.limits 数据** | 隐含 DB | 框架迁移 001–999 冻结（最大编号 053）；quota 键本就是 plan.limits 数据声明（quota.go:93-95）；quota fail-closed 意味着迁移与功能必须同批（§4.9.5） |
| D8 | **文件下发必须自建授权 + Range；WS `video` scope 必须接 hub.Authorize** | 未覆盖 | example 现有 `GET /uploads/` 是匿名路由（main.go:1138），storagex 注释明说鉴权是产品责任（storagex/http.go:1-7）；成片含私密内容，不得复制匿名先例。hub 对自定义 scope 在 `Authorize == nil` 时 **fail-closed 拒绝订阅**（hub.go:437）——不接回调 = video 推送功能不可用（非泄露）；接了但校验写错才有泄露面 |

---

## 2. 总体架构

```
外部 Agent (Claude Code / Cursor / 任意 MCP Client)
     │  PAT（scope: video:read / video:write / video:render）
     │  POST /mcp（streamable-HTTP, stateless）—— 超时豁免、CSRF 豁免、1MiB body limit
     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ ploykit 产品二进制（单进程，example/cmd/app）                             │
│                                                                        │
│  /mcp ── mcpx.Mount                                                    │
│    └─ video_* 工具（video/adapters/mcp）                                │
│         │ 每 handler：requireToolScope → membership → service 变更       │
│         │ → audit.RecordTx → wsx 推送                                   │
│         ▼                                                              │
│  ┌──────────────────────┐      ┌──────────────────────────────────┐    │
│  │ video 域             │      │ /api/video/*（人肉 UI 面）         │    │
│  │  app/ir.go    IR契约  │◄─────┤  同一 service 层（校验/锚点/版本） │    │
│  │  app/service.go 变更  │      │  GET preview.html（投影直出）      │    │
│  │  app/projector.go 投影│      │  GET files/{key}（Range+授权）     │    │
│  └──────┬───────────────┘      └──────────────┬───────────────────┘    │
│         │ IR + 快照                            │ 同一 HTML               │
│         ▼                                      ▼                        │
│  render/worker.go（river，queue "video"）   浏览器 /studio 页            │
│   1. 载快照 → 投影 HTML                      │ iframe ← preview.html     │
│   2. capx.RenderFrames（逐帧 seek+截图）      │ scrub = timeline.pause()  │
│   3. ffmpeg 编码/混流/字幕                    │ 与 worker seek 同一函数   │
│   4. storagex.Put → 状态机/进度/审计          │                          │
│                                                                        │
│  platform/capx（新）：chromedp 池 + 帧捕获契约 + ffmpeg 管道 + 远程槽位   │
│  platform/storagex（已有）：assets / renders                            │
│  platform/wsx + wswire（已有）：scope "video" → 帧推送                   │
│  quota（已有）：video_renders_monthly；audit（已有）：video.* 动作        │
└────────────────────────────────────────────────────────────────────────┘
```

**层间契约**：工具层（MCP/HTTP）→ 只写 IR；预览与渲染 → 只读 IR；worker 只读 `ir_snapshot`。三方向无循环依赖。

**并发模型**：所有 IR 变更串行化在 `video_project.version` 乐观锁上（§4.3）；渲染作业在 river `video` 队列串行（MaxWorkers 默认 1，可调）。

---

## 3. `platform/capx` 详细设计

### 3.1 定位、门控与边界

- **定位**：通用帧捕获能力（headless Chrome 逐帧 seek + 截图 → PNG 流 → ffmpeg 编码），零业务依赖（arch 测试同样约束它）。
- **门控**：默认关。`Config.Enabled` 为 nil/false 时 `New` 返回 inert runtime，`RenderFrames` 返回 `ErrNotConfigured`；可诊断、不静默（ADR 0014 契约）。
- **探测顺序**（启动时一次）：`CAPX_CHROME_PATH` → `exec.LookPath("chrome"/"google-chrome"/"chromium"/"msedge")`；`CAPX_FFMPEG_PATH` → `exec.LookPath("ffmpeg")`。任一缺失 → capability 不可用（`Available() bool`）。
- **边界声明**（AGENTS.md boundary clause）：`remote.go`（远程 render server）v1 **不接线**，在 ADR 0017 与平台索引中声明的未消费路径；example 只消费 LocalChrome 路径。
- **健康检查不接 Chrome/ffmpeg**：可选能力不得拖垮 readiness（未用视频的产品升级后健康检查照旧全绿）。

### 3.2 Go 接口契约

```go
package capx

type Config struct {
    Enabled       *bool         // nil/false = inert（metrics/mcpx 同款契约）
    ChromePath    string        // 空 = 自动探测
    FFMpegPath    string        // 空 = 自动探测
    PoolSize      int           // 浏览器实例数，默认 1
    LaunchTimeout time.Duration // 默认 20s
}

func New(cfg Config) (*Runtime, error)
func (r *Runtime) Available() bool
func (r *Runtime) Close() error

// Renderer 是唯一捕获契约：Document 由调用方（video 域投影层）生成。
type Renderer interface {
    RenderFrames(ctx context.Context, doc Doc, spec FrameSpec, onFrame FrameFunc) error
}

type Doc struct {
    HTML    string // 完整自包含文档（内联 gsap + player + IR JSON）
    TimelineID string // 注册在 window.__timelines 下的 composition id
}

type FrameSpec struct {
    Width, Height int      // 视口 = 输出分辨率
    FPS           int
    DurationFrames int     // 总帧数（= ceil(duration*fps)）
}

type Frame struct {
    Index int      // 0 起
    Time  float64  // Index/FPS
    PNG   []byte
}

type FrameFunc func(ctx context.Context, f Frame) error

func (r *Runtime) EncodePNGStream(ctx context.Context, w io.Writer, spec FrameSpec, opts EncodeOptions) error // 内部 ffmpeg
```

### 3.3 捕获流程与确定性清单

`RenderFrames` 单页流程（复用浏览器实例，不每帧起进程）：

1. `chromedp` 新 target（`about:blank`）→ `page.setDocumentContent` 注入 `doc.HTML`（不经 HTTP，无鉴权问题、无网络抖动）。
2. `Runtime.evaluate` 等待就绪：`window.__player.ready === true`（player 在 `document.fonts.ready` + 所有 `img.decode()` 完成后置位）。
3. 帧循环：`Runtime.evaluate("window.__timelines['<id>'].pause(t)")` → 双 `requestAnimationFrame` flush → `Page.captureScreenshot`（PNG）→ `onFrame` 回调流式交给编码器。
4. 任意帧失败：中止并返回带帧号的错误；defer 关闭 target。

**确定性清单**（写进 capx 契约注释 + ADR）：

| 保证 | 做法 |
|---|---|
| 无 CSS 动画干扰 | 投影文档契约禁止 CSS animation/transition（动效只允许 GSAP 时间线驱动） |
| GSAP 时钟不漂移 | player 内 `gsap.ticker.lagSmoothing(0)`，且时间线 `paused:true`，只用 `pause(t)` 定位 |
| 字体就绪 | 等 `document.fonts.ready`；字体以 woff2 内嵌进投影文档（§4.4.6） |
| 图片就绪 | 等所有 `img.decode()`；图片以 data URI 内联（渲染路径）或同源授权 URL（预览路径） |
| 固定视口 | viewport = spec.Width/Height，deviceScaleFactor=1，无滚动条 |
| 可复现验证 | 同机两次渲染逐帧 SHA-256 向量一致（M3 验收测试） |

### 3.4 编码与合成助手（`encode.go`）

- **编码**：`ffmpeg -f image2pipe -framerate <fps> -i - -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart out.mp4`（PNG 流式 stdin，无磁盘中转）。
- **混流**：`-i video.mp4 -i voice -i bgm -filter_complex "[2:a]volume=<bgm_v>[bgm];[1:a][bgm]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy`。
- **字幕**：烧录 `-vf subtitles=<srt>:force_style=...`（需 ffmpeg 带 libass；缺 libass 时降级软封装 `-c:s mov_text` 并在 render.error 里注明）。
- 纯 os/exec，无 cgo、无库依赖；命令超时由调用方 ctx 控制。

### 3.5 扩展点：Remote Renderer（v1 不接线）

`Renderer` 接口即插槽：未来分布式渲染 = 实现 `RemoteHTTP`（对接 HyperFrames Producer 式 render server）并在装配层换实现，video 域零改动——这正是外部设计稿"决策 5（IR 不绑 HTML 细节）"的引擎侧镜像。

---

## 4. `example/internal/video` 域详细设计

### 4.1 目录结构（严格按 task 域解剖）

```
example/internal/video/
  doc.go                      # 域边界与不变量注释
  app/ir.go                   # IR 类型 + Validate + ResolveAnchors + EstimateWords（纯函数）
  app/service.go              # ProjectService：唯一变更入口（乐观锁/事务/端口/审计/推送）
  app/ports.go                # Synthesizer / Aligner / Enqueuer / Publisher / Auditor / Quota / Membership
  app/projector.go            # IR → 自包含 HTML（Go html/template）
  app/timeline-builder.js     # ★ 唯一 GSAP 时间线构造器（go:embed）
  app/subtitle.go             # words[] → 分组 cue → SRT（纯 Go）
  adapters/http/routes.go     # Mount(mux, Deps)：REST + preview.html + 文件（Range+授权）
  adapters/mcp/tools.go       # RegisterTools(s *mcp.Server, deps)：video_* 12 工具
  adapters/tts/tts.go         # Synthesizer 适配器（HTTP 供应商，直出词级时间戳）
  adapters/aligner/aligner.go # Aligner 适配器（WhisperX sidecar HTTP）
  render/worker.go            # river Worker[RenderArgs]：投影→capx→ffmpeg→落地→状态机
```

依赖纪律：域内**只 import** `platform/*` 与 `authz`；对 quota/identity/notify/audit 全部经 `ports.go` 接口在 main.go 注入（同 example/internal/task 的 `d.Quota.Consume` 形态）。域不是框架域，不受"业务域互不 import"直接约束，但保持可晋升性（晋升框架时零改 import）。

### 4.2 IR 契约

#### 4.2.1 完整示例

```json
{
  "version": 7,
  "meta": { "fps": 30, "width": 1080, "height": 1920, "durationSec": 12.4 },
  "script": "这款产品发布后，留存率提升了三倍。",
  "words": [
    { "index": 0, "text": "发布", "start": 1.80, "end": 2.10, "source": "tts" },
    { "index": 1, "text": "留存率", "start": 3.20, "end": 3.60, "source": "tts" },
    { "index": 2, "text": "三倍", "start": 4.80, "end": 5.00, "source": "tts" }
  ],
  "effects": [
    { "id": "fx_1", "anchor": { "text": "发布", "occurrence": 0 }, "type": "pulse",
      "params": { "scale": 1.2 },
      "resolvedFrom": { "wordIndex": 0, "reason": "exact" } },
    { "id": "fx_2", "anchor": { "text": "三倍", "occurrence": 0 }, "type": "counter",
      "params": { "from": 0, "to": 3 },
      "resolvedFrom": { "wordIndex": 2, "reason": "exact" } }
  ],
  "elements": [
    { "id": "sticker_1", "type": "image", "src": "video/<ws>/assets/<project>/<sha>.png",
      "x": 100, "y": 100, "w": 200, "h": 200, "z": 1,
      "animations": [
        { "id": "an_1", "type": "move", "from": {"x":100,"y":100}, "to": {"x":400,"y":300},
          "startAnchor": { "text": "发布", "occurrence": 0 },
          "durationFrames": 45, "easing": "power2.out" }
      ] }
  ],
  "audio": {
    "voice": { "key": "video/<ws>/assets/<project>/voice.mp3", "durationSec": 12.4 },
    "bgm":   { "key": "video/<ws>/assets/<project>/bgm.mp3", "volume": 0.3 }
  }
}
```

#### 4.2.2 字段与校验规则

| 字段 | 规则 |
|---|---|
| `meta.fps` | ∈ {24,25,30,50,60}，默认 30 |
| `meta.width/height` | 360–2160；比例建议 9:16 / 16:9 / 1:1，不强限 |
| `script` | ≤ 5000 字符（CJK 按字符计） |
| `words[]` | ≤ 2000 个；`start<end`、相邻不重叠、单调递增；`source` ∈ tts/aligner/manual/estimated |
| `effects[]` | ≤ 128；`type` ∈ 注册表；`params` 按 type 校验 |
| `elements[]` | ≤ 64；`type` ∈ image/text/shape；坐标 clamp 到画布（允许部分出画） |
| `elements[].animations[]` | 每元素 ≤ 16；`easing` ∈ 白名单（linear/power1.out/power2.out/power3.out/back.out/expo.out） |
| `elements[].src` | **只允许本域 storagex key**（`video/<ws>/...`）；外部 URL v1 拒绝（SSRF 面收窄，§6） |
| `effects[].anchor` / `startAnchor` | `{text, occurrence≥0}`；写入时解析，解析失败即 400（人工/agent 挂错词要立刻知道） |
| `ir` JSONB 总量 | ≤ 256 KiB（/mcp 1MiB body limit 内富余） |

#### 4.2.3 写时校验 vs 读时容错

- **写时**：service 层全体校验，非法即拒（400 / MCP 工具错误 `E_VIDEO_IR_INVALID` + `details.field`）。
- **读时**：投影层对未知 effect type / element type 跳过并 warn（前向兼容：新客户端写、旧 worker 渲）。

#### 4.2.4 锚点解析算法（`ResolveAnchors`）

```
输入：anchor{text, occurrence}, words[], prevWordIndex（上次解析位置，可能未知）
1. exact      ：存在 words[i].text==anchor.text 且它是该文本的第 occurrence 个 → 命中
2. same_text  ：文本存在但 occurrence 越界 → 取同文本词中 |i - prevWordIndex| 最小者
3. nearest    ：文本不存在 → 取全词表中 |i - prevWordIndex| 最小者
4. missing    ：words 为空 → 置 unresolved（reason=missing），投影跳过该效果，inspect 暴露
规则：prevWordIndex 缺失时按词表长度归一化旧位置（旧 index / 旧长度 * 新长度）。
结果写回 effect.resolvedFrom = {wordIndex, reason}，供 inspect 审计（原方案 M5）。
```

### 4.3 服务层（`app/service.go`）

```go
type ProjectService struct {
    pool   *pgxpool.Pool
    ports  Ports        // 见下
    log    *slog.Logger
    now    func() time.Time
}

type Ports struct {
    Synth      Synthesizer   // nil = 降级（估算词时）
    Aligner    Aligner       // nil = 降级
    Enqueue    Enqueuer      // river 提交（InsertTx）
    Publish    Publisher     // wsx BroadcastEvent
    Audit      Auditor       // audit.Recorder（RecordTx 优先）
    Quota      QuotaPort     // Consume/Release
    Membership Membership    // (wsID, userID) → bool（文件/预览/WS 授权）
}
```

**唯一变更入口**（MCP 与 HTTP 共用）：

```go
func (s *ProjectService) Mutate(ctx, p *webx.Principal, projectID string, expectedVersion *int,
    fn func(ir *IR) error) (newVersion int, resolutions []AnchorResolution, err error)
```

- 事务内：`SELECT ir, version FROM video_project WHERE id=$1 AND workspace_id=$2 FOR UPDATE` → 校验归属（p.WorkspaceID；平台管理员豁免）→ `expectedVersion` 不符即 `E_VERSION_CONFLICT`（details.current_version）→ 变更函数 → `Validate` → 锚点重解析 → `UPDATE ... SET ir=$new, version=version+1` → 域内审计 `RecordTx`。
- 提交后：`Publish(video.ir.updated)`（拆到 committed hook，避免推送早于提交）。
- 变更动作集合：`SetScript`、`SetWords`、`AddEffectAtWord`、`UpsertElement`、`MoveElement`、`AnimateElement`、`SetAudio`；MCP 工具与 PATCH/PUT REST 一一对应同一方法。

**`SetScript` 内部**（原 v2.0 的 realignWords 融合版）：

```
1. 更新 script 文本
2. 若 TTS 已配置：调 Synth.Synthesize（ctx 自带 60s 预算）→ 若返回词级时间戳直接用；
   否则若 Aligner 已配置且已有 voice 音频 → Align(script, audio)
3. 都没有 → EstimateWords（按字符均分 durationSec，source=estimated）——工具不阻塞、不报错
4. ResolveAnchors（全量 effect + element animation 的锚点）
5. 返回 resolutions 列表（agent 可立即看到哪些锚点漂移了）
```

### 4.4 投影层（`app/projector.go` + `timeline-builder.js`）

#### 4.4.1 单一投影

```go
type Projector struct {
    gsapJS    []byte // go:embed assets/gsap.min.js（固定版本，ADR 记录）
    builderJS []byte // go:embed timeline-builder.js
    fontWOFF2 []byte // 可选：内嵌字体（§4.4.6）
    assets    AssetResolver
}

type AssetResolver interface {
    // 预览：返回同源授权 URL /api/video/files/<key>
    // 渲染：返回 data: URI（worker 从 storagex.Open 预载内联）
    URL(ctx context.Context, key string) (string, error)
}

func (p *Projector) HTML(ctx context.Context, ir *IR, origin string) ([]byte, error)
```

产物 = 自包含 HTML：`<style>`（画布/文字/元素布局）+ `<script>`（内联 gsap + timeline-builder + `window.__IR` JSON + 启动调用）。**渲染路径与预览路径的唯一差异是 AssetResolver 的实现**（data URI vs 授权 URL），DOM 与时间线逐字节同构。

#### 4.4.2 player 契约（与 capx 的接口）

`timeline-builder.js` 生成：

```js
window.__player = { ready: false, seek(frame), play(), pause(), durationFrames }
window.__timelines[compositionId] = gsap.timeline({ paused: true })  // HyperFrames 同款契约
gsap.ticker.lagSmoothing(0)
// ready = document.fonts.ready && Promise.all(img.decode())
```

- capx 用 `window.__timelines[id].pause(t)`；iframe scrub 用 `window.__player.seek(frame)`（内部同一 `pause(t)`）。
- 动效注册表（v1）：`pulse` / `counter` / `highlight` / `shake` / `fade` + 元素动画 `move` / `scaleIn` / `rotate`。新增动效 = registry 加一个 builder 函数 + IR 类型字段 + 校验白名单（一处扩展点）。

#### 4.4.3 iframe postMessage 协议（Studio 页 ↔ 播放器）

```
页面 → iframe：{type:"player", cmd:"seek"|"play"|"pause"|"getState", frame?}
iframe → 页面：{type:"player:state", frame, t, durationFrames, ready}
校验：双方均校验 event.origin === window.location.origin
```

#### 4.4.4 preview.html 端点

`GET /api/video/projects/{id}/preview.html`：鉴权（workspace membership）→ 投影 → `Content-Type: text/html; charset=utf-8`，`Cache-Control: no-store`，CSP：

```
default-src 'none';
script-src 'sha256-<内联 gsap+builder 的哈希>' ...;   // 常量脚本可按哈希放行
style-src 'unsafe-inline';                             // 布局样式内联
img-src 'self' data:; media-src 'self';
frame-ancestors 'self';                                // 只许同源 iframe 嵌入
```

IR 文本以 `script[type="application/json"]` 数据块承载（非可执行脚本，不受 script-src 约束；builder 读取 `textContent`），因此哈希 CSP 成立。

#### 4.4.5 渲染侧资产内联（SSRF 收窄）

worker 不加载任何网络资源：投影前把 elements 的 image key 经 storagex.Open 预载 → data URI；音频不进浏览器（ffmpeg 直接读 storagex 流→临时文件）。capx 侧再叠一层保险：`Network.setBlockedURLs` 拒绝一切 http(s) 请求，文档只能靠内联资源渲染。

#### 4.4.6 字体（开放决策）

- 默认：系统字族栈（预览与渲染同机近似，跨机不保证像素级一致）。
- 推荐（F2 内定）：内嵌 OFL 字体子集 woff2（如 Noto Sans SC Regular 子集，构建期 pyftsubset 产出），投影文档 `@font-face` 引用——跨机预览/渲染像素级一致，代价是文档体积 +1–3MB（渲染 SetDocumentContent 无感，预览首屏多一次同源下载）。
- ADR 0017 记录选择与理由。

### 4.5 数据模型与迁移（example 产品迁移 1xxx）

```sql
-- 1001_video_project.up.sql
CREATE TABLE video_project (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  title text NOT NULL,
  script text NOT NULL DEFAULT '',
  ir jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL DEFAULT '', updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_video_project_ws ON video_project (workspace_id, updated_at DESC);

-- 1002_video_render.up.sql
CREATE TABLE video_render (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES video_project (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,               -- 冗余列：quota/审计/列表免 join
  status text NOT NULL,                     -- queued|running|succeeded|failed|interrupted
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ir_snapshot jsonb NOT NULL,
  output_key text NOT NULL DEFAULT '', error text NOT NULL DEFAULT '',
  frames_done integer NOT NULL DEFAULT 0, frames_total integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX idx_video_render_project ON video_render (project_id, created_at DESC);
CREATE INDEX idx_video_render_ws_status ON video_render (workspace_id, status);

-- 1003_video_quota_keys.up.sql（数据声明）
UPDATE plan SET limits = limits || '{"video_renders_monthly": 5}'::jsonb WHERE code = 'free';
UPDATE plan SET limits = limits || '{"video_renders_monthly": -1}'::jsonb WHERE code = 'pro';
```

- down 迁移对称（删表 / `limits - 'video_renders_monthly'`）。
- 表名 `video_*` 是产品表（框架表名裁决只约束 001–999）；未来晋升为框架域时表名无需变动。
- **不新增框架表、不 ALTER 框架表、不涉及 `x_` 扩展列合同**。

### 4.6 MCP 工具面（`adapters/mcp/tools.go`）

命名：`video_` 前缀（mcpx 无命名空间机制；devx 裸名是因为它是唯一所有者，产品工具混布同一 server 需防碰撞）。工具实现模式 = devx：输入 struct + `jsonschema` tag + 第一行 `requireToolScope`。

| 工具 | scope | 输入要点 | 输出 |
|---|---|---|---|
| `video_list_projects` | video:read | 无 | `[{id,title,version,updated_at}]` |
| `video_create_project` | video:write | title | `{id, version}` |
| `video_inspect` | video:read | project_id | IR 快照 + `resolutions[]`（锚点审计视图） |
| `video_set_script` | video:write | project_id, script, expected_version? | `{version, words_source, resolutions[]}` |
| `video_set_words` | video:write | project_id, words[], expected_version? | `{version}`（降级/精修路径） |
| `video_add_effect_at_word` | video:write | project_id, anchor{text,occurrence}, type, params | `{version, resolvedFrom}` |
| `video_upsert_element` | video:write | project_id, element | `{version}` |
| `video_move_element` | video:write | project_id, element_id, x, y | `{version}` |
| `video_animate_element` | video:write | project_id, element_id, from, to, start_anchor, duration_frames, easing | `{version, resolvedFrom}` |
| `video_upload_asset` | video:write | filename, content_type, data_base64（≤ ~700KB，受 /mcp 1MiB body limit 约束；大素材走 REST） | `{key, url, size}` |
| `video_render` | video:render | project_id, params{fps,width,height,burn_subtitles,subtitle_mode,bgm_volume}, expected_version? | `{render_id, status:"queued"}` |
| `video_get_render` | video:read | render_id | `{status, frames_done, frames_total, output_url, error}` |

**每个 handler 的固定骨架**：

```go
func (t *tools) render(ctx context.Context, _ *mcp.CallToolRequest, in renderIn) (*mcp.CallToolResult, renderOut, error) {
    if err := requireToolScope(ctx, "video:render"); err != nil { return nil, renderOut{}, err }
    p := webx.PrincipalFrom(ctx)
    // service 内再校验 membership（p.WorkspaceID vs project.workspace_id；平台管理员豁免）
    out, err := t.svc.SubmitRender(ctx, p, in.ProjectID, in.Params, in.ExpectedVersion)
    return nil, out, err
}
```

- **`video_render` 前置检查顺序**：`capx.Available()` → 不可用直接 `E_NOT_CONFIGURED`（不建 render 行、不扣配额）；可用才走到 `ConsumeWith(idempotency=render_id)`。
- **工具错误码**（结构化，MCP error text 带 code）：`E_VIDEO_PROJECT_NOT_FOUND` / `E_VIDEO_VERSION_CONFLICT` / `E_VIDEO_IR_INVALID`（details.field）/ `E_VIDEO_ANCHOR_NOT_FOUND` / `E_NOT_CONFIGURED` / `E_QUOTA_EXCEEDED`（沿用 webx.NewQuotaExceeded 语义）/ `E_SCOPE_DENIED`（requireToolScope 既有）。
- **/mcp 契约豁免**：不登 openapi.yaml（ADR 0014:27 约定，check_api 不扫 mcpx 与 main.go 的 method-less mount）。
- **/mcp 五坑合规**：超时豁免已有（main.go:1365）→ 工具自设预算（DB 5s / TTS 60s / 渲染提交 10s）；body limit 已有（main.go:1337）→ 上传走小体+base64 或 REST；scope 在 handler 内（五坑 #3）；审计 RecordTx（五坑 #4）；statement_timeout 由自设 ctx 预算兜底（五坑 #5）。

### 4.7 HTTP 面（`adapters/http/routes.go`）

```go
func Mount(mux webx.Router, d Deps)   // 与 notify/adapters/http/routes.go:18 同款
```

| 路由 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/video/projects` | session/PAT + membership | 列表（workspace 内） |
| `POST /api/video/projects` | 同上 + CSRF | `{title}` |
| `GET /api/video/projects/{id}` | 同上 + membership | `{project, ir, version}` |
| `PUT /api/video/projects/{id}/ir` | 同上 + CSRF | 全量 IR 替换，`expected_version` 必填（乐观锁） |
| `DELETE /api/video/projects/{id}` | 同上 + CSRF | 级联删 renders（DB CASCADE） |
| `GET /api/video/projects/{id}/preview.html` | 同上 + membership | 投影直出（§4.4.4） |
| `POST /api/video/projects/{id}/renders` | 同上 + CSRF | 与 `video_render` 工具同服务方法 |
| `GET /api/video/projects/{id}/renders` | 同上 | 历史列表 |
| `GET /api/video/renders/{id}` | 同上 + membership | 状态/进度/输出 |
| `POST /api/video/assets` | 同上 + CSRF | multipart（`storagex.ParseUpload`，maxBytes=1MiB） |
| `GET /api/video/files/{key...}` | 同上 + membership | **Range 下载**（见下） |

**文件 handler（§D8 硬约束）**：

```go
// key 形如 video/<wsID>/...；先校验 key 前缀解析出 wsID，
// 再 Membership(ctx, wsID, p.UserID)（平台管理员豁免），再下发。
// Local 后端：storagex.Open → http.ServeContent（Range/If-Range/HEAD 全支持，mp4 拖动必需）。
// S3 后端：storagex.Presign 302（已有能力）。
// 响应头：Content-Type 取 meta、X-Content-Type-Options: nosniff、Cache-Control: private, max-age=31536000, immutable（key 内容寻址；但禁止 public 缓存——内容私密）。
```

- **openapi.yaml**：上述 11 条全部入契约（check_api 扫 `*/adapters/http/*.go` 与 example main.go）；`routes_contract_test.go` 的 `expectedRouteCount`/mount 列表同批更新。
- **body limit**：`POST /api/video/assets` 继承 `/api/` 1MiB（main.go:1337）。v1 素材上限按 1MiB 设计；需要更大时用 `webx.BodyLimitExcept` **为该前缀单独放宽**（bodylimit.go:30 存在该 API；禁止再叠一层 pathGate 的 BodyLimit——五坑 #2 嵌套 MaxBytesReaders 会失效）。
- CSRF 由全局 `csrfMW` 覆盖 `/api/`（main.go:1231 豁免面不含 video）——浏览器写操作自动受保护。

### 4.8 WS 面

- 装配：`wswire.RegisterScope("video")`（wswire.go:65；命名 [a-z0-9_]≤32 合规）**必须在 main.go:966 `hub.Capabilities = wsx.Capabilities()` 之前**。
- 房间：`ScopeKey("video", projectID)`。帧（Frame{Type,Payload,EventID} 格式不变）：

| 帧 type | payload | 触发点 |
|---|---|---|
| `video.ir.updated` | `{project_id, version, updated_by, origin:"mcp"\|"ui"}` | service 提交后（committed hook） |
| `video.render.updated` | `{render_id, project_id, status, frames_done, frames_total, error?}` | worker 状态迁移 + 每 15 帧进度 |

- **订阅授权（§D8 硬约束）**：`hub.Authorize` 回调（hub.go:57）在 main.go 装配为：

```go
hub.Authorize = func(ctx context.Context, p *webx.Principal, connWorkspace, scopePrefix, id string) bool {
    if scopePrefix != "video" { return true }   // 既有 scope 行为逐字节不变
    // video: 校验项目归属当前工作区 + 成员资格（经 Membership 端口）
    return videoAccess(ctx, p, connWorkspace, id)
}
```

- 前端：`useWsScope('video', projectId, wsClient)` + `useWsFrame('video.ir.updated', ...)`。注意：`packages/client` 的 `ScopePrefix` 联合类型需增加 `'video'`（类型层加法，向后兼容，semver minor；hooks 无需改动）。

### 4.9 渲染管线（`render/worker.go`）

#### 4.9.1 状态机

```
提交：queued ──worker──► running ──► succeeded
                            │├─► failed（error 明细）
                            │└─► interrupted（进程被 drain/杀掉；river 重试后回到 running）
失败补偿：failed/interrupted 一律 quota.Release(render_id)
```

#### 4.9.2 worker 步骤（`river.Worker[RenderArgs]`）

```
1. 载入 render 行 + ir_snapshot；置 running + WS 推送
2. IR 校验（快照可能来自旧客户端）→ 不合法的渲染立刻 failed（E_VIDEO_IR_INVALID）
3. 资产预载：image key → storagex.Open → data URI；voice/bgm key → 临时文件（defer 清理）
4. projector.HTML(snapshot, AssetResolver=data URI) → capx.RenderFrames
   （onFrame：写 ffmpeg stdin；每 15 帧 UPDATE frames_done + WS 进度帧）
5. 字幕：subtitle.SRT(words) → burn/soft/none 分支
6. 混流：voice（有则）+ bgm（有则，volume 取 IR）
7. storagex.Put(output.mp4) + 首帧 thumb.jpg；UPDATE succeeded + finished_at
8. audit.Record("video.render.completed") + WS 终态帧
```

- **并发/隔离**：自有 river client 挂 `Queues{"video": {MaxWorkers: 1}}`（默认 1，env `CAPX_RENDER_WORKERS` 可调）；独立队列避免挤占 events 队列（MaxWorkers 10, lifecycle.go:77-78）与 schedule 队列。
- **Drain**：worker 归入既有 `wk.Drain(45s)` 窗口（main.go:1424）；river soft stop ctx 取消 → worker 置 `interrupted` + Release；river MaxAttempts=2 重试时从快照重头渲染（快照确定 → 幂等）。
- **启动清扫**：worker 启动时把 `running` 且 `updated_at < now()-10min` 的孤儿行置 `failed(error="interrupted: process restarted")`（防进程崩溃留僵尸状态）。
- **容量估算**（F3 实测校准）：1080×1920@30fps，逐帧 seek+capture 通常 4–8 fps → 30s 成片约 2–4 分钟；PNG 经 image2pipe 直通 ffmpeg，临时磁盘占用可忽略（仅音频/字幕小文件）。M3 用 2–3s 短片（60–90 帧）做冒烟。

#### 4.9.3 配额与审计

- **提交时**：`Quota.ConsumeWith(ctx, wsID, "video_renders_monthly", 1, now, {IdempotencyKey: renderID})`；失败 → 事务回滚（render 行不落）。
- **失败/中断**：`Quota.Release(ctx, wsID, key, 1, now)`（task.go:269-274 同款补偿）。
- **审计动作**：`video.project.created` / `video.ir.updated`（meta: origin, tool, version）/ `video.render.created` / `video.render.completed` / `video.render.failed` / `video.asset.uploaded`。
- **错误码语义注记**：`E_QUOTA_EXCEEDED` 在 HTTP 面是 402 语义（`webx.NewQuotaExceeded`，apperr.go:35 / respond.go:123）；MCP 工具侧复用同一错误对象时 Agent 收到的是 error text（MCP 无 HTTP 状态码），tools 层不另造码。
- **fail-closed 部署顺序**（硬约束）：配额键与 render 功能同批迁移；plan 没键的库渲染会被拒（consume.go:115-146）——ADR 记录"迁移必须先于功能启用"。

#### 4.9.4 存储布局

```
video/<wsID>/assets/<projectID>/<sha256>.<ext>     # 素材（内容寻址，幂等覆盖）
video/<wsID>/renders/<renderID>/output.mp4
video/<wsID>/renders/<renderID>/thumb.jpg
```

- 成功上传后删临时帧目录（defer）；产物保留策略 v1=全保留（ROADMAP 触发项：按项目保留最近 N 条 + 定时清理）。
- 缩略图 = 首帧 PNG 转 jpg（ffmpeg 单帧）。

#### 4.9.5 渲染参数（params）

`fps`（默认 meta.fps）/ `width`、`height`（默认 meta）/ `burn_subtitles` bool / `subtitle_mode` ∈ burn|soft|none / `bgm_volume` 覆盖 IR。params 与 ir_snapshot 一起定格，`output_key` 与 params 共同可复现。

### 4.10 语音、对齐与字幕

#### 4.10.1 端口

```go
type Synthesizer interface {
    Synthesize(ctx context.Context, text, voice string, speed float64) (VoiceResult, error)
}
type VoiceResult struct {
    AudioKey    string   // storagex key
    DurationSec float64
    Words       []Word   // 供应商直出词级时间戳；nil = 只出音频
}

type Aligner interface { // 仅"上传已有音频"场景
    Align(ctx context.Context, audioKey, script string) ([]Word, error)
}
```

#### 4.10.2 供应商策略

- 优先选择**响应内含词级时间戳**的 TTS 供应商（多家支持；ADR 记录具体契约）→ 一步拿到 `words[]`，绕过 WhisperX。
- 上传音频 + 需要对齐 → `Aligner`（WhisperX sidecar，`ALIGNER_URL` 指向 HTTP 服务；sidecar 部署文档进 dev-environment）。
- **降级矩阵**：

| TTS | Aligner | set_script 行为 | 渲染 |
|---|---|---|---|
| 有 | — | words.source=tts，精确时间戳 | 正常（有配音） |
| 有 | 有 | 同上；上传音频时可用 Aligner | 正常 |
| 无 | — | words.source=estimated（按字符均分） | 正常但无声（bgm 可混）；inspect 显示 estimated |
| 无 | 有 | 仅上传音频路径可用 | 上传音频→对齐→正常 |

#### 4.10.3 字幕（`app/subtitle.go`）

- cue 分组：按标点 + 长度（CJK ≤ 16 字符/行，≤ 2 行，≤ 6 秒）切分 `words[]`；单 cue = `{start: 首词.start, end: 末词.end, text}`。
- SRT 生成纯 Go；烧录需 ffmpeg libass（缺则自动降级 soft + error 注明）。

---

## 5. 前端设计

### 5.1 路由、侧栏、权限

- 路由（`example/web/src/routes-table.tsx` 工厂，`buildRouteTable` 内追加两条，csr + `lazyPage`）：
  - `/studio` → 项目列表（`StudioListPage`）
  - `/studio/:id` → 工作室（`StudioPage`）
- `providers.tsx` `PAGE_TITLES` 加两条；`shell.tsx` workspaceNav 加 `{href:'/studio', label:'视频工作室', permKey:'video:read'}`。
- 权限：main.go 装配 `authzCatalog.Register("video:read","video:write","video:render")`；`roles.Grant(owner, 全量自动)；admin: read+write+render；member: read+write`（示例策略，产品可改）。未授予的角色侧栏不可见（permKeyVisible 语义，useWorkspaceRoleSafe.ts:55-59）。

### 5.2 Studio 页布局

```
┌ PageHeader: 项目名 · version · Agent 在线指示 ─────────────────────────┐
├ 左栏 (320px)                 │ 中央 9:16 预览               │ 右栏 (360px) │
│ 脚本编辑区（textarea）        │ ┌──────────────────────┐    │ 效果列表      │
│ 词条时间轴（words chips，    │ │ iframe preview.html   │    │ (click→seek) │
│ 点击 seek）                  │ │ 9:16 自适应缩放        │    │ 元素列表      │
│                              │ └──────────────────────┘    │ 渲染参数面板   │
├ scrub Slider + 播放/暂停 + 帧号 ──────────────────────────────────────┤
├ 渲染历史（DataTable：status/progress/output 下载）─────────────────────┤
```

- 数据：`GET /api/video/projects/{id}` 初始载入；WS 增量（`video.ir.updated` → refetch IR，`video.render.updated` → 更新历史行/progress）。
- `bridgeWsToQuery` 映射 `video.render.updated` → `['video','renders',id]` 失效。
- 渲染按钮点击 → `POST .../renders`；进度来自 WS（降级：轮询 `GET renders/{id}`，`useInterval` 兜底）。

### 5.3 Slider 组件（`packages/ui`）

- 新件 `slider.tsx`：跟随现有 shadcn/Base UI 内核（`@base-ui/react ^1.8.0`，package.json:45），导出 `Slider` + index.ts 一行。
- 用途：scrub 条（step=1 帧、value=frame）、bgm volume（0–100）。
- 测试：vitest 覆盖受控/非受控、键盘方向键、disabled。

### 5.4 WS 接线

- `wsClient` 复用 example/web/src/ws.ts 单例；页面挂载 `wsClient.connect()`（若未连）、`useWsScope('video', projectId, wsClient)`。
- 类型：`ScopePrefix` 加 `'video'`（packages/client/src/ws.ts:24，加法）。

---

## 6. 安全与多租户清单

| # | 面 | 措施 |
|---|---|---|
| 1 | 数据隔离 | 所有 SQL 带 `workspace_id` 谓词；项目/渲染/文件 key 均含 ws 前缀 |
| 2 | MCP 授权 | `requireToolScope`（PAT scope）+ service 内 membership（session/PAT 都要过） |
| 3 | REST 授权 | 全局 Authenticate（已有）+ handler 内 membership；写方法 CSRF（已有中间件自动覆盖） |
| 4 | WS 订阅 | `hub.Authorize` 校验 video scope 项目归属（§4.8） |
| 5 | 文件下载 | key 前缀解析 ws + membership + Range；禁止匿名 `/uploads/` 式暴露 |
| 6 | 预览页 | CSP（哈希放行常量脚本）+ `frame-ancestors 'self'` + no-store |
| 7 | 渲染沙箱 | SetDocumentContent 无网络 + `Network.setBlockedURLs` 全拒 + 资产只允许本域 key（IR 校验拒绝外链） |
| 8 | 请求体 | /mcp 1MiB、/api 1MiB 已有；素材上限同批设计；大文件走 BodyLimitExcept 单前缀放宽（不叠层） |
| 9 | 查询预算 | /mcp 超时豁免 → 工具自设 ctx 预算（DB 5s / TTS 60s）；worker 步骤各自 deadline |
| 10 | 密钥 | TTS key 走 env（外部服务凭证 env 真源，同 OAuth/支付）；不入库 → 不触发 sealx；未来 DB 化必须 sealx |
| 11 | 审计 | 每次 IR 变更 RecordTx（含 origin/tool/version）；渲染生命周期全记 |
| 12 | 滥用 | 渲染以 quota 门控（fail-closed）；队列 MaxWorkers 受限；/mcp 暂无工具级限流（ADR 0014:43 既有现状，接受） |

---

## 7. AGENTS.md 纪律合规映射

| 约束 | 满足方式 |
|---|---|
| 依赖单向 product → framework | video 域只 import `platform/*` + `authz`；不 import identity/quota/notify（Membership/Quota/Audit 皆端口注入） |
| platform/* 零业务依赖 | capx 不 import 任何业务域；arch 测试覆盖 |
| authz 可被业务域依赖、不得反向 | video 只用 authz 注册键（装配层），不反向依赖 |
| authorization 强档自包含 | 未触碰 |
| 业务域互不 import | video 是 example 产品域；晋升框架域时端口注入形态保证零改 import |
| 迁移 001–999 冻结 | 一个不动；video 表走 example 1xxx（最大框架编号仍 053） |
| x_ 扩展列合同 | 不涉及（没有 ALTER 框架表） |
| internal/ 不暴露 | video 在 example/internal（task 先例） |
| wiring discipline | F1=DB+MCP+测试；F2=+页面/预览/WS（≥3 件）；F3=+渲染/配额/审计；每批 `make verify` 绿 |
| reverse clause | 已查：example 无任何既有视频/动画手写逻辑可替换（本特性全新增）；新平台能力无现存等价件 → 无需清理 |
| boundary clause | capx.Remote 未接线路径在 ADR/平台索引声明（"何时用、example 不消费"） |
| sealx | 无新增入库凭证（TTS env-only） |
| openapi 契约 | 11 条新路由入 spec；check_api 双侧同步；routes_contract_test 同批更新 |
| English-only 面 | ADR 0017、capx 注释、openapi summary 英文；本文件 plan- 前缀中文豁免 |
| 非浏览器挂载五坑 | #1 超时豁免已有且工具自设预算；#2 body limit 不叠层；#3 scope 在 handler；#4 RecordTx；#5 statement_timeout 自兜底 |
| HTTP/2 / 预压缩 | 不涉及（无新增 SSR 面；文件下载走 Range，proxy 层沿用既有部署建议） |

---

## 8. 里程碑（F0–F5）

| 阶段 | 交付物 | 验收标准 | 测试 |
|---|---|---|---|
| **F0** | `platform/capx`（Config/Renderer/RenderFrames/Encode + 探测/门控）；vendored gsap；ui Slider | `make verify` 绿；env 门控单测（无 Chrome 自动 skip）；静态 HTML 两次渲染逐帧哈希一致（CAPX_TEST_CHROME 门控） | capx 单测 + 确定性冒烟 + Slider vitest |
| **F1** | IR + service + 迁移 1xxx + MCP 7 工具（list/create/inspect/set_script/set_words/add_effect/upsert_element/move/animate/upload/…） | MCP 工具经 example 实调可用；乐观锁冲突 409；锚点解析表驱动全绿；`make test-db` 绿 | IR 单元（fake ports）+ 集成（TEST_DATABASE_URL） |
| **F2** | projector v1 + preview.html + Studio 页 + WS scope + Authorize + Slider 接线 | iframe 可 scrub；MCP 改 IR → WS 帧 → 预览刷新；openapi 增量 + routes_contract_test 同步绿 | e2e（httptest + WS 帧断言）+ check_api |
| **F3** | render worker + capx 集成 + ffmpeg + 配额/审计 + 文件 Range handler | 2–3s 短片出 MP4（CAPX 门控）；quota 超限拒绝；audit 断言；RA 文件拖动可播 | 集成渲染 + 配额 + 授权矩阵 |
| **F4** | TTS 适配器 + SRT + 混流/烧录 + 降级矩阵 | 有/无 TTS env 双路径全通；字幕与词时间对齐抽帧验证 | 降级矩阵测试 |
| **F5** | 锚点最近邻 + resolvedFrom + 改稿保效 e2e + WhisperX 适配器 | 改写脚本后效果存活、inspect 可见 resolvedFrom；WhisperX 路径可用（ALIGNER_URL 门控） | e2e 保效用例 |

每阶段合入前：`make verify` + `make -C example db-up && make test-db` +（F2 起）`python tools/check_api.py`；文档同批（openapi/ADR/索引）。

---

## 9. 部署与运维

### 9.1 环境变量

| env | 默认 | 消费方 | 缺失行为 |
|---|---|---|---|
| `CAPX_CHROME_PATH` | 自动探测 | capx | 渲染 `E_NOT_CONFIGURED`（预览/编辑不受影响） |
| `CAPX_FFMPEG_PATH` | `ffmpeg`（PATH） | capx | 同上 |
| `CAPX_RENDER_WORKERS` | 1 | river queue | — |
| `VIDEO_TMP_DIR` | `<data>/video-tmp` | worker | 用系统临时目录 |
| `VIDEO_TTS_URL` / `VIDEO_TTS_KEY` / `VIDEO_TTS_VOICE` | 空 | tts 适配器 | `set_script` 降级估算 |
| `VIDEO_ALIGNER_URL` | 空 | aligner | 上传音频对齐不可用（其余不受影响） |

### 9.2 系统依赖与镜像

- example Dockerfile 需追加 `chromium`（或基于 debian 装 google-chrome-stable）+ `ffmpeg`（含 libass 更佳）；两者**可选**——未装则视频渲染降级，其余功能全通。
- readiness **不得**探测 Chrome/ffmpeg（可选能力不拖垮老产品健康检查）。

### 9.3 监控

- 渲染吞吐/耗时：worker 结构化日志（frames_total/frames_done/duration_ms）；
- 队列积压：river 既有 jobs 表 + devx `/dev/jobs`；
- 失败分类按 error code 计数（日志侧）。

---

## 10. 风险、开放问题与 ROADMAP 触发项

| 项 | 级别 | 说明 / 处置 |
|---|---|---|
| 单机渲染吞吐上限 | 中 | 1080p 30fps ≈ 4–8 fps 捕获；超过则走 capx.RemoteHTTP（触发：单机队列 P95 等待 >10min 或日渲染量超阈值） |
| CJK 字体跨机一致性 | 中 | 内嵌 woff2 子集（推荐，F2 定）；否则接受预览与渲染跨机字距差异（同机确定性仍保证） |
| PNG 流吞吐/内存 | 低 | image2pipe 流式；单帧 PNG 1–4MB，管道背压由 ffmpeg 控制；内存峰值 ≈ 单帧 |
| 进程崩溃僵尸渲染行 | 低 | 启动清扫（§4.9.2）+ river MaxAttempts=2 |
| 单条成片过长（>5min） | 低 | 挂 ROADMAP 断点续渲触发项 |
| 取消渲染 | 低 | v1 不支持；ROADMAP `video_cancel_render` |
| 保留策略 | 低 | v1 全保留；ROADMAP 触发项（项目保留最近 N 条 + GC） |
| 计费口径 | 中 | v1 quota-only；超量出账追加 billing `metered_video_renders`（开放决策，compat §4.11） |
| 分享链接（对外观看） | 低 | v1 仅登录可见；ROADMAP 签名 URL 触发项 |
| 完整 HyperFrames 引擎（Lottie/three） | 低 | capx.Renderer 插槽；ROADMAP 触发项（需要 Lottie/3D 时） |
| React Flow 可视化时间轴 | 低 | ROADMAP 既有触发项可复用 |

---

## 11. 文档/契约待办（实施同批）

1. `docs/adr/0017-agent-video-studio.md`（英文）：D1–D8 决策、capx 边界、字体决策、部署顺序（quota 先迁移后启用）、Remote 未接线声明。
2. `docs/openapi.yaml`：11 条 video 路由 + schema；`python tools/check_api.py` 绿。
3. `docs/platform-api-index.md`：capx 条目（能力、门控、边界）。
4. `docs/dev-environment.md`：Chrome/ffmpeg 可选依赖 + WhisperX sidecar 说明。
5. `docs/ROADMAP.md`：§10 触发项（分布式渲染/断点续渲/取消/保留/分享/Lottie）。
6. `docs/api-index.md`：video 域无 hooks（v1 零钩子；注明保留钩子位）。
7. `packages/ui` 导出面 README（Slider 行）。
8. `example/cmd/app/routes_contract_test.go`：`expectedRouteCount` + mount 镜像列表同批更新。
9. `packages/client`：`ScopePrefix` 加 `'video'`（类型加法，minor）。

---

## 12. 审计记录（v1.1，2026-11-14）

对本文档 v1.0 的可证伪断言逐条与代码对账（方法同兼容性文档 §7）。结果：**1 处方向性错误、1 处过时风险表述、3 处表述精确化**；抽样核对通过的断言见末尾。

### 已修正

| # | v1.0 表述 | 实际 | 证据 |
|---|---|---|---|
| C1 | §4.8/§D8 暗示"不接 hub.Authorize 则任意已登录用户可订阅任意项目推送"（安全裸奔） | **方向性错误**。hub 对自定义 scope 的 subscribe：`Authorize == nil` 时直接 `rejected:subscribe`（fail-closed）。不接回调 = video scope 订阅全部被拒、WS 推送功能不可用（**功能性破坏，非泄露**）；泄露面只存在于"接了回调但校验写错"。装配义务不变（必须接 + 必须校验项目归属），风险定性已修正 | hub.go:437 `if h.Authorize == nil \|\| !h.Authorize(context.Background(), c.principal, c.connWS, in.Scope, in.ID)` → rejected；回调类型 hub.go:57 |
| C2 | §10 风险表"gsap 现行许可允许分发；ADR 记录版本号"（潜在付费疑虑） | **过时风险表述**。gsap 现为 100% 免费商用（Webflow 收购后整个库含原 Club 插件免费）；vendored 分发前过一遍 Terms of Use 即可，无许可成本 | gsap.com/pricing（2026-11-14 查证） |
| C3 | §4.9.3 未说明 `E_QUOTA_EXCEEDED` 的 HTTP 语义 | 该码在 HTTP 面是 **402** 语义（`NewQuotaExceeded` → 402）；MCP 工具侧复用同一错误对象，Agent 收到 error text（MCP 无状态码），tools 层不另造码 | apperr.go:35、respond.go:123 |
| C4 | §3.1 "探测顺序 ChromePath → LookPath(chrome/google-chrome/chromium/msedge)" | Windows 实机常无 PATH 内 Chrome（本机即装在 Program Files）；补充：探测列表应含平台默认安装路径（win: `%ProgramFiles%\Google\Chrome\Application\chrome.exe` 等；linux: `/usr/bin/...` 已覆盖；macOS: `/Applications/Google Chrome.app`），`CAPX_CHROME_PATH` 永远优先 | 实现注记（非代码错误） |
| C5 | §4.2.2 校验规则未覆盖 `audio.voice.durationSec` 与 `meta.durationSec` 一致性 | 补充：`Validate` 须校验 `audio.voice.durationSec`（存在时）≥ words 末词 end 且作为时长基准（渲染 frames_total 以 max(meta.durationSec, voice.durationSec) 计）——否则词时间戳可能超出视频长度 | 设计补漏 |

### 采样核对通过（无需修改）

- wsx：workspace scope 走 joinWorkspace 成员闸门（hub.go:409-418）、自定义 scope 走 IsRegisteredScope + validSubscribeID + Authorize（hub.go:421-444）——§4.8 装配描述与代码一致 ✓
- plan.limits 为 jsonb 且 seed 形态 `'{"...}'::jsonb`（migrations/007）——§4.5 `limits \|\|` 追加键的迁移写法成立 ✓
- `quota.Release` 存在且签名匹配（quota.go:152）✓；`ConsumeWith` 幂等键（consume.go:31）✓
- Base UI `^1.8.0`（packages/ui/package.json:45）——Slider 底座 ✓；ui 组件清单中确无 Slider ✓
- 既有域审计动作命名形态 `billing.metered_overage` / `role_perms.set`（billing service.go:769、workspace roleconfig.go:118）——§4.9.3 的 `video.*` 动作命名同构 ✓
- `storagex.ParseUpload`（http.go:81+）存在——§4.7 assets 上传写法成立 ✓
- routes_contract_test 注释原文与 expectedRouteCount=161 ✓（与 compat 文档 A5 一致）
