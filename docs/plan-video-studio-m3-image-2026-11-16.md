# Video Studio M3「固定渲染镜像」落地方案（调研与选型）

- 日期：2026-11-16
- 性质：**只调研，不改代码/CI**。本文是 M3 起步项「固定渲染镜像」的选型建议与实施顺序（round6 §6 第 5 条：`docs/delivery-audit-video-studio-round6-2026-11-16.md`）。
- 依据：
  - 案例库 §7.7 环境矩阵三列（本机 Windows / Linux CI / 固定镜像；golden 唯一基线来源 = 固定镜像）：`docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md:3021-3048`
  - 跨镜像容差定稿：全帧 MAE ≤ 6/255、SSIM ≥ 0.95；同镜像不放宽（同上 `:2908`，§7.0 阈值表）
  - 确定性决策 D12：确定性 = "固定镜像 + 固定依赖 + 固定资产"，不承诺跨 OS / Chrome 版本 bit-identical（`docs/plan-agent-video-studio-architecture-2026-11-14.md:106,785`）
  - 实测记录：round1（157.0.8103.51）、round3（L5 100× 全等 = 同镜像语义；103ms/帧稳态）、round6（九案 golden 落盘、M2 未全收口、M3 起步清单）
  - 缺口台账：F-FNT-01（字体子集 + recipe，③ 缺失，P1）、F-DET-01（recipe digest 不足，② 部分在位）——案例库 §6

---

## 1. 现状盘点：渲染依赖栈的固化方式与缺口

### 1.1 逐项盘点

| 依赖 | 当前探测/获取方式（代码锚点） | 版本固化现状 | golden 实际记录值（meta.json） | 缺口评级 |
|---|---|---|---|---|
| 浏览器 | `platform/capx/capx.go:306-328` `ProbeChrome`：显式路径 → LookPath(`chrome`,`google-chrome`,`chromium`,`msedge`) → 平台默认安装位（Windows 仅 Google Chrome 目录；Linux 仅 LookPath） | **零固化**：不校验版本号，PATH 上抓到谁是谁 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（九案全部一致，round1 记录完整版本 **157.0.8103.51**） | **高**。golden 的真实出生浏览器是 **Edge**（探测顺序第 4 优先级在本机胜出——Chrome 未装 PATH）。同一台机器 Edge 自动升级即静默换渲染引擎 |
| ffmpeg | `capx.go:330-341` `ProbeFFMpeg`：显式路径 → LookPath(`ffmpeg`) | **零固化** | `ffmpeg version N-117763-ge35587250c-20241113`（2024-11-13 的 **git master 夜间构建**，非 release） | **高**。nightly 构建不可复现下载；且 burn 字幕依赖 libass（`subtitles` 滤镜 [实测] 在位），apt 发行版 ffmpeg 的 libass 版本各不相同 |
| GSAP | `example/internal/video/app/projector.go:19-20` `go:embed assets/gsap.min.js`，源 `gsap@3.13.0` jsdelivr | **已固化**（vendored，随仓库走，可 sha256） | 未入 recipe（F-DET-01 缺口：digest 未记录） | **低**（缺的只是把 sha256 写进 meta.json/recipe 一行） |
| 字体 | `projector.go:307` CSS 链 `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`；仓库内无任何 vendored 中文字体（仅 example web 的 Geist，与渲染无关） | **零固化**，完全依赖出片机器已装字体 | meta.json 不记录字体 | **最高（F-FNT-01 ③ 缺失）**。九案 golden 实际字形 = Windows 本机回退链第一命中者（链首 Noto Sans SC 大概率未装，实际命中的是 **Microsoft YaHei**[推断，待 `fc-list`/注册表回填]）；换机器即换字形，跨机 golden 逐像素必然不可比 |
| Player JS（timeline-builder.js + boot） | `go:embed`，同 GSAP 一起以 `InlineScript` 内嵌（`projector.go:120-121`） | 已固化 | — | 低 |
| Go 工具链 | go.mod toolchain；golden meta 记 `go1.27.0` | 已固化 | 一致 | 低 |

### 1.2 结论

四项里 **两项已固化**（GSAP、Player JS——都是 embed，天然随仓库），**两项零固化**（浏览器、ffmpeg——都是"探测 PATH 上有什么用什么"），**一项半固化**（字体——CSS 声明了但谁都没装，渲染结果取决于机器巧合）。CI 侧（`.github/workflows/verify.yml`）目前 **没有任何 capx/渲染 job**：capx 与 L1-L5 测试在找不到 Chrome/ffmpeg 时自跳过（`consistency_l5_test.go` 头注 "Skips itself when Chrome or ffmpeg is not found"），即九案 golden 全部证据链只存在于 Windows 本机，CI 对渲染确定性零覆盖。

镜像方案要补的就是这四个洞，其中**字体是唯一一处"不改代码就补不上"的洞**（其余三项镜像内装好即可）。

---

## 2. 镜像方案三档对比

### 2.1 对比表

| 维度 | a. Dockerfile 固定镜像 | b. GitHub 托管 runner 原生 | c. 混合（快车道 + 镜像专用 workflow） |
|---|---|---|---|
| **构建物** | 仓内 `tools/renderimage/Dockerfile`：golang 基础层 + pinned Chromium（Chrome for Testing 指定版本，见 §2.2）+ pinned ffmpeg static build（URL + sha256 校验）+ 字体子集（§3）+ Go toolchain；推送 GHCR，按 digest 引用（`ghcr.io/haozing/ploykit-render@sha256:...`） | 无构建物；runner 镜像随 GitHub 月度更新漂移 | a 的镜像 + b 的现有 verify.yml 原样保留 |
| **确定性保证** | **强**：OS/浏览器/ffmpeg/字体/GSAP 全部 digest 锁定；同镜像 bit-identical（round3 已在 Windows 证明 100× 全等可达成，机制同源）；跨镜像只承担 MAE≤6/SSIM≥0.95 容差 | **无**：ubuntu-latest 的 Chromium 版本随 runner 漂移（GitHub 每月更新镜像，Chromium 大约每 4 周一个 major），apt ffmpeg 随发行版走；golden 与"上个月"不可比，D12 的"固定"名存实亡 | golden 强（走 a）；日常 CI 弱（走 b，但 b 只跑不依赖像素的层，弱即可接受） |
| **维护成本** | 中：Dockerfile 本身稳定后几乎零维护；依赖升级 = 改 pin + 重建 + 整批重生成 golden（案例库 §7.7 已规定"整批重生成，不得单帧热更"） | **零** | 中偏低：与 a 相同 + 一条专用 workflow |
| **CI 集成方式** | `container: image@digest` 的 job，或专用 workflow（`workflow_dispatch` + golden 变更路径触发）；镜像内跑 `go -C example test -tags capx` | 塞进现有 verify.yml（装 chromium + apt ffmpeg 两个 step） | 日常 verify.yml 不动（L0/纯函数层照跑）；新增 `golden.yml` 专用 workflow 用 a 镜像跑 L1 golden tripwire 比对 + 按需重生成 |
| **单价成本** | runner 时间同 b，另加镜像构建（可缓存层，增量 <5min）+ GHCR 存储（公开仓免费；镜像 ~1.5-2GB） | 最低 | 日常 job 免费（现状不动）；golden job 每次 ~15-25min（见 §4 成本估算） |
| **违背目标的风险** | 无 | **直接违背**：golden 基线唯一来源要求"固定 digest"，b 的浏览器每季度换 major，基线要么反复重生成、要么比对失败无法归因 | 无（前提：golden 路径严格只走镜像） |
| **判定** | 可行，单独用略重（所有 CI 渲染跑批都走镜像，无快车道） | **否决**（作为 golden 基线时） | **推荐** |

### 2.2 两个关键 pin 的选型细节

- **Chromium pin：用 Chrome for Testing（CfT）而非 apt chromium。** Debian/Ubuntu 的 chromium 包版本随发行版滚动；CfT 是 Google 提供的按 milestone 固定版本的分发版（JSON API 可编程取下载 URL），与"pinned full version, digest 入 recipe"（§7.7 环境矩阵）逐字对应。镜像内 `Config.ChromePath` 显式指向（capx 已支持显式路径优先，`capx.go:307-312`），绕过探测顺序。注意：CfT 版本不必追平本机 Edge 157——反正字体（§3）落地后所有基线要整批重生成，新旧浏览器差异在重生成时一次性吸收。
- **ffmpeg pin：用 static build 固定 URL + sha256**（johnvansickle.com 的 release 构建 **自带 libass**，满足 burn 字幕；或 BtbN GitHub 构建）。同时把本机那个 N-117763 nightly 视为"待退役"：镜像里 pin 到一个正式 release（如 7.1.x），recipe 记 URL+sha256，不再依赖某个 master 快照。libass 的 burn 路径已有 ErrNoLibass 降级保护（`render/render_pipeline.go:279-289`），但 golden 语义要 burn/soft 两态都确定——镜像内两者都装死。

### 2.3 推荐方案：c（混合），golden 严格走 a 镜像

**理由：**

1. **b 被 D12 直接否决**：`ubuntu-latest` 的 Chromium 是 GitHub 按月刷的，"runner 自带 Chromium"与 §7.7 "固定 digest 镜像：Chrome + FFmpeg + 字体集 + 依赖库版本全部锁定"逐项冲突；用它出 golden 等于把基线绑在别人的发布节奏上。
2. **日常 CI 大部分不需要镜像**：现有 verify.yml 四个 job（go 单测 + DB 集成 / contract / example / ui）跑的都是不消费像素的层；capx 纯逻辑测试（池、FrameSpec、编码参数构造）在 runner 上照跑。只有"出 golden / 复验 golden"需要镜像——这正是 §7.7 的三列矩阵本意：**镜像列只服务 L1/L3/L5 golden，不是全量 CI 搬进去**。
3. **迁移成本最小**：verify.yml 一行不改；新增一个 `golden.yml`（workflow_dispatch + `paths` 触发 + `container: ghcr.io/...@sha256`）；镜像 Dockerfile 独立目录，不碰 example/Dockerfile（那是运行时镜像，职责不同，不要合并——运行时镜像追求小，渲染镜像追求可复现，两者的优化方向相反）。
4. **附带解锁 `-race`**：round6 记录 `-race` 被 Windows cgo 阻断（`delivery-audit-video-studio-2026-11-15.md:117`）；M3 的 race 环境项与镜像合用同一个 Linux 执行环境，一次投入两项收益。

**成本估算：**

- 镜像构建：一次性 ~30-60min（Chromium + 依赖层为主，Docker 层缓存后增量 <5min）；重建频率 = 依赖升级时（预期季度级）。
- GHCR 存储：镜像 ~1.5-2GB（Chromium 运行库占大头）；公开仓免费。
- golden workflow 单次：L1 九案重生成 ≈ 135 帧采样 + 浏览器池 warmup ≈ 10-15min；全量 tripwire 比对（不出帧只比对）≈ 5min。月度触发 + golden 路径变更触发，月 runner 配额消耗可忽略。
- 人力：Dockerfile + workflow + 字体脚本（§3）合计 2-3 人日；golden 整批重生成 + 人工复核（§7.7 要求一次人工复核）1 人日。

---

## 3. 字体子集方案（F-FNT-01 解法）

### 3.1 九案用字盘点（实测）

对 `example/internal/video/testdata/ir/c02..c09.degraded.json` 全部 text 元素与 words 做字符集并集：

- **唯一字符 359 个，其中 CJK 304 个**；非 CJK 为 `%+./0-9=@ADHINOQRSUYabdeghijlmnopqrstuxy·λ—""⁴∝`。
- C01（`l1_render_test.go` 内联 harness，含 script/words/元素文案）追加 82 字符集，新增非 CJK：`-79BCSU¥`（`¥` U+00A5 来自 "券后 ¥79"）。
- 案例规格声明的字体（案例库 §3.x 各案"字体"行）：中文 **Noto Sans SC 500/700/900**，英文 **Inter 600**（c01）、**Archivo 700/800 回退 Inter**（c02）、邮箱 **Inter**（c04）。
- **现实约束**：当前 IR 没有 fontFamily/fontWeight 字段（T-01 缺口，案例库 §1.4），投影只有一条 CSS 链（`projector.go:307`）——所以**今天的真实渲染字体 = 回退链第一命中者**，与案例规格声明的 Noto/Inter 无关。Windows 本机链首 Noto Sans SC 大概率未安装，实际命中 Microsoft YaHei[推断]。**子集化应当以"Noto Sans SC 三档字重"为目标字体**（案例规格是目标态；T-01 落地 fontFamily 后规格才真正生效），Inter 是否单独子集取决于 T-01 进度：M3 内可先不做 Inter（英文串量小，Noto Sans SC 的拉丁字形兜底，跨镜像一致性不受影响——关键是"同一份字体文件"，不是"哪种字体"）。
- **安全余量（必须加，不能只并集案例字符）**：
  - 全量 ASCII 可打印区 + CJK 标点 U+3000-303F + 全角形式 U+FF00-FFEF（字幕折行/禁则处理会把标点挪行首行尾，`subtitle.go` 禁则字符表内的字符必须全部在子集里，否则豆腐块）；
  - 用户生产项目会输入任意文案——子集只保证**九案 golden 确定**，不解决用户缺字。缺字检测（投影前置失败，F-FNT-01 期望行为）是另一个待办，本文只覆盖 golden 确定性路径。

### 3.2 pyftsubset 子集化流程（文字版流程图）

```
[输入]
  (1) 字符源收集脚本 tools/fontsubset.mjs（或 Python）：
      - 遍历 testdata/ir/*.degraded.json 的 elements[].text + words[].text
      - 解析 l1/l2 各 harness Go 文件中的 Text:/Script: 字符串字面量
      - 并上安全余量：ASCII 0x20-0x7E、U+3000-303F、U+FF00-FFEF、¥—…·
      - 输出 chars.txt（去重排序）+ sha256(chars.txt)
  (2) 目标字体（一次性入库 tools/renderimage/fonts-src/，记录上游 URL+版本）：
      - Noto Sans SC Regular(500)/Bold(700)/Black(900)（Google Fonts 官方 OTF）
[子集化]（pyftsubset，fonttools，镜像构建期或本地一次性执行）
  pyftsubset NotoSansSC-{Weight}.otf \
    --text-file=chars.txt \
    --layout-features='*' --no-hinting \        # CJK OTF 保留 layout 特性、去 hinting 缩体积
    --flavor=woff2 --output-file=NotoSansSC-{Weight}.subset.woff2
[产物入库]
  example/internal/video/app/assets/fonts/*.woff2 + fonts-digest.json
  （digest = sha256(woff2 字节) 三条 + chars.txt 摘要；预计每个 woff2 20-60KB，三档合计 ~150KB）
[消费]
  projector（改代码，M3 排期项，本文仅规划）：
  go:embed assets/fonts/*.woff2 → HTML <style> 注入
  @font-face { font-family:"PK Video SC"; src:url(data:font/woff2;base64,...); font-weight:500|700|900; }
  CSS 链改 "PK Video SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif
[入 recipe]
  meta.json / render recipe 增 fonts.sha256（三档）、chars_sha256、gsap.sha256、chrome.version、
  ffmpeg.version——把 §1.1 表里"未入 recipe"的四行一次补齐（F-DET-01 收口）
```

流程要点：**字符集变更 → chars.txt 变 → digest 变 → 需整批重生成受影响 golden**（与 §7.7 "整批重生成"规则对齐；digest 进 meta.json 后比对器可自动发现"基线字体与当前字体不一致"并拒绝放行，这正是 §7.2 失败判定里"golden 与当前 recipe 字体不一致"一条的可执行化）。

### 3.3 接入点：@font-face 内嵌 vs 镜像系统字体安装 —— **推荐 @font-face 内嵌（投影侧）**

**推荐投影侧内嵌，理由按权重排：**

1. **镜像系统字体装法救不了本机列**。环境矩阵三列里本机 Windows 仍是开发/调试主力（L0/L1/L4 调试），系统字体安装只覆盖镜像列——本机与镜像永远差一个字体变量，跨镜像 MAE≤6 容差里字体贡献无法归因。@font-face 内嵌后三列消费同一份 woff2 字节，字体变量在三列同时消失。
2. **`document.fonts.ready` 语义只在 @font-face 下有牙齿**。builder 的 ready 门等 `document.fonts.ready`（`timeline-builder.js:460-462`）；系统安装字体不经过 FontFace 加载队列，fonts.ready 立即 resolve，字形覆盖完全不可观测。@font-face + data URI 让 ready 门真正等到字体就绪，且缺字检测（F-FNT-01 后半）可以挂在 `document.fonts.check()` 上做投影前置校验——系统字体装法做不到。
3. **不破坏投影自包含不变量**。§4.4.5 要求文档内零网络（图片全走 data URI）；字体以 data URI 内嵌与该不变量同构，且 preview.html、L4 DOM 采样、镜像渲染消费的是同一份 HTML——一份产物三处一致。
4. **镜像系统字体还引入 fontconfig 变量**。Linux 下 fontconfig 的 hinting/antialiasing/替换规则本身是跨发行版差异源；data URI 字体绕开整套 fontconfig 替换逻辑，浏览器对内嵌字体的栅格化路径更收敛。
5. **体积代价可忽略**：~150KB 三档 woff2 内嵌进 HTML，对 render 路径（每帧截图前的单文档加载）无感。

镜像内系统字体安装（`fonts-noto-cjk`）作为**兜底**仍建议装上（防 CSP/投影异常时回退不致豆腐块），但它不进确定性承诺，不进 recipe。

---

## 4. Windows 本机基线与镜像的关系

### 4.1 现状盘点（实测）

`example/internal/video/testdata/golden/` 现有 **10 个目录、135 张 PNG**：c01=10、c02=13、c03=12、c04=11（已被 round3 修正版 c04-round3=25 取代语义）、c05=11、c06=11、c07=12、c08=14、c09=16。全部 meta.json 记录同一出生环境：**Windows + Edge 157.0.8103.51 + ffmpeg N-117763 nightly + 未记录的字体（推断 Microsoft YaHei）**。golden_sanity_test 的 tripwire 签名（如 C01 F90/F250 全帧 `#FFD166`）也编码在这套像素上。

### 4.2 建议：**不重生成覆盖、镜像基线另起、双基线并存过渡**

**理由：**

1. **字体落地前重生成 = 白生成两次**。§3 的 @font-face 内嵌是改投影的代码改动，落地后像素必然变（YaHei → Noto Sans SC 子集）。若先在 Windows 上整批重生成、字体再落地、镜像再出基线，等于重生成两轮。正确顺序是：**字体子集先落（§3）→ 镜像建好 → 在镜像内一次性整批重生成**。
2. **Windows 基线仍有开发期价值**。M3 过渡期内本机调试（L1 快速迭代、断言校准如 round6 的 C02 五处校准）还要在本机跑；本机基线保留可以让"改了断言/改了投影"在几秒内得到本机反馈，不必每次起容器。但它的身份要从"A 基线（golden 唯一来源）"**降级为"B 基线（dev-only 参考系）"**——round2 已有 A/B 基线语义（"复核通过后升级为 A 基线允许逐像素断言"），沿用即可。
3. **跨镜像容差需要一次"新旧 diff 证据"**。§7.7 要求基线变更 MR 附新旧帧 diff（MAE/SSIM）。保留 Windows 基线恰好提供跨镜像容差的首个实测样本：镜像基线生成时对 Windows 基线跑一次 MAE≤6/SSIM≥0.95 比对，把"跨镜像容差阈值定得对不对"从纸面变成实测。

### 4.3 迁移步骤（顺序即依赖）

1. **冻结标记**：现有 `golden/<case>/` 各 meta.json 增补 `"env":"windows-dev","baseline":"B-dev"`（不动 PNG；golden_sanity tripwire 照常有效——它仍描述 dev 环境）。
2. **字体子集落地**（§3，代码改动，先行——一切重生成的前置）。
3. **镜像构建**（§2 推荐方案 a 部分）：`tools/renderimage/Dockerfile` + GHCR 推送 + digest 记入文档；镜像内冒烟：跑 capx 现有确定性单测。
4. **镜像内确定性验证**：`consistency_l5_test.go`（100× 同镜像全等）在容器内复跑一次——round3 是在 Windows 上证明的，同镜像语义换到 Linux 容器需要独立证据（尤其 fontconfig 消失后的栅格化路径）。
5. **镜像基线生成**：新 workflow 在镜像内跑九案 L1，产物先落 `golden-image/<case>/`；**一次人工复核**（§7.7：区域亮度/边界/无豆腐块）后改名/移动为 `golden/<case>/`（A 基线），原 Windows 基线移入 `golden-win/`（或仅保留 meta 标记 + git 历史，仓库体积敏感时选后者——135 张 × ~40KB ≈ 5MB，建议就地保留）。
6. **跨镜像 diff 存证**：镜像基线 vs Windows 基线逐案 MAE/SSIM 报告入 `testdata/`，验证 §7.0 容差阈值（MAE≤6/SSIM≥0.95）是否有余量；超差的帧逐帧归因（预期差异源：字体 + 字形 rasterizer，其余应 <1）。
7. **tripwire 重审定**：`golden_sanity_test.go` 的签名按镜像基线刷新（round5 先例：X-4 修复后 F90/F250 全帧 #FFD166 是"新正确签名"——字体切换同理，全帧/区域签名要按新像素重写）。
8. **CI 收口**：`golden.yml` 上线（比对模式：PR 触碰 `testdata/golden/**` 或投影代码时在镜像内跑 tripwire + 像素比对；重生成模式：workflow_dispatch 手动）。verify.yml 不动。

**取舍说明**：也有人会选"保留 Windows 基线为正式基线、镜像只做 CI 复验"——被否决，因为它让 §7.7 "golden 唯一来源=固定镜像"变成空文：基线出生地决定语义，Windows 基线永远携带"换台开发机就不可复现"的隐性依赖。

---

## 5. 分阶段实施（依赖排序：字体先行）

| 阶段 | 内容 | 依赖 | 预估 | 为什么是这个顺序 |
|---|---|---|---|---|
| **P0 字体子集**（先行，必做） | §3 全流程：字符收集脚本、pyftsubset、woff2 入库、digest 字段设计 | 无外部依赖；pyftsubset 本地可跑 | 1 人日 | **golden 只应整批重生成一次**。字体是九案像素的最大变量，字体不先定，镜像里出的基线到了 T-01/fontFamily 落地时又得重生成。所有后续阶段的基线语义都压在这一步 |
| **P1 镜像构建** | Dockerfile（golang + CfT pinned Chromium + pinned static ffmpeg+libass + woff2 安装 + GO toolchain）、GHCR 推送、digest 记档 | P0 的 woff2 产物 | 1 人日 | 镜像是 P2-P4 的执行环境 |
| **P2 镜像内确定性验证** | 容器内跑 L5 100× 全等 + capx 单测冒烟；recipe/meta 字段补全（chrome.version / ffmpeg / fonts / gsap digest） | P1 | 0.5 人日 | 在花时间生成 135 张基线之前，先证明这个环境真的 bit-identical（round3 的 100× 是 Windows 证据，Linux 容器要独立复证） |
| **P3 golden 整批迁移** | §4.3 步骤 5-7：镜像内生成 → 人工复核 → A/B 基线换位 → 跨镜像 diff 存证 → tripwire 重审定 | P0+P1+P2 | 1 人日（复核占半天） | 基线变更有 MR 评审要求（非生成者复核，§7.7） |
| **P4 CI 收口** | `golden.yml`（比对模式 + dispatch 重生成模式）；verify.yml 不动 | P3 | 0.5 人日 | 最后接线，避免 CI 先红 |

总计 ~4 人日。P0/P1 可并行启动（字体脚本与 Dockerfile 互不依赖），P3 是唯一有人工瓶颈的环节。

---

## 6. 关键取舍点汇总

1. **方案 b 否决**：runner Chromium 随 GitHub 月度镜像漂移，违背 D12/§7.7 的"固定 digest"要求；作为 golden 基线来源不合格，仅保留其"日常快车道"角色（方案 c）。
2. **字体接入点选投影 @font-face 内嵌**而非镜像系统字体：三列共用同一份字体字节、`fonts.ready` 门获得真实语义（并为缺字检测铺路）、不破坏投影零网络不变量、绕开 fontconfig 变量。镜像系统字体只做兜底，不进确定性承诺。
3. **基线策略选"镜像基线另起 + Windows 降级 B 基线"**而非"全部重生成覆盖"：字体落地顺序决定重生成只做一次；Windows 基线保留以支撑开发期快反馈与跨镜像容差的首个实测证据。
4. **Chromium pin 选 Chrome for Testing** 而非发行版包；ffmpeg pin 选 release static build（含 libass）并退役本机 nightly；两者都不必追平本机 Edge 157——字体切换反正触发整批重生成，浏览器代差一并吸收。
5. **运行时镜像（example/Dockerfile）与渲染镜像不合并**：前者优化体积，后者优化可复现性，混写互相拖累。
6. **子集只解决 golden 确定性**，用户任意文案的缺字检测（F-FNT-01 后半：投影前置失败）是独立待办，挂在 @font-face 落地后的 `document.fonts.check()` 上，不在本方案范围内实现。
7. **golden 目录命名**：推荐 `golden-image/`（过渡期）→ 定稿后占用 `golden/`，Windows 侧退 `golden-win/`；不引入按环境分目录的长态双基线——长期只允许一套 A 基线（镜像），避免比对器需要"选基线"逻辑。

## 7. 遗留待回填项（本调研未能实测的）

- Windows 本机实际命中字体（链首 Noto Sans SC 是否安装）——需在开发机跑 `[System.Drawing.Text.InstalledFontCollection]` 或注册表查询回填；不影响方案结论（无论命中谁，都要换成子集内嵌）。
- CfT 具体版本号与 ffmpeg release 版本号——P1 落地时按当时 stable 选定并记 digest。
- 镜像内 L5 100× 是否复现全等（P2 验证项；若 Linux 容器内出现非确定性，优先排查 SharedArrayBuffer/时钟/字体栅格化缓存三类源）。
