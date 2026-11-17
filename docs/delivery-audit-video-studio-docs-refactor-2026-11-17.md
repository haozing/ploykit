# Video Studio 文档重构交付审计（2026-11-17）

> 审计对象：本轮「框架文档全面修复重构」批——6 改 3 新共 9 个文档 + MaxElements 热修 + 试点 harness
> 审计基线：方案 `plan-video-studio-ir-v2-2026-11-17.md` §3 + 四份 agent 任务书
> 纪律：只出报告不动代码；⚠️ 判定全部带 file:line 证据；覆盖率强制报告

---

## 0. 总判定

| 项 | 结果 |
|---|---|
| 条目取证覆盖率 | **32/32（100%）**——修复轮后 🟡 全部闭合 |
| ✅ 已实现 | 32（原 29 ✅ + 2 🟡 修复闭合 + 1 判定澄清） |
| 🟡 部分 | 0 |
| ❌ 缺失 | 0 |
| ⚪ 无法验证 | 0 |
| 门禁 | `check_docs_language.py` OK ✓ `check_api.py` 175:175 ✓ `go build ./...` ✓ 视频 4 包单测 ✓ |
| 范围纪律 | ✓ 文档批未越界改 .go/.yaml（ir.go/service.go 属 MaxElements 批，任务书已声明） |
| **修复轮（2026-11-17）** | 9 处陈旧状态已处理，见 §6 修复记录 |
| **发现的真问题** | spec 自证 4 bug 全部独立复验为真（含 **P1 级音量静音 bug**）；1 项范围外 env var 分叉 |

---

## 1. 可追溯矩阵

### A 工具面真值（8/8 ✅）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| A1 | 26 个唯一 video_* MCP 工具 | ✅ | `mcpAdd(s,` 调用 26 处；全词 30 次 = 26 调用 + 1 定义（tools.go:1502）+ 3 注释 |
| A2 | G-01~G-11 逐项行号证据为真 | ✅ | set_audio:312 / preview_frames:510 / list_templates:682 / validate:742 / list_elements:822 / remove_element:875 / set_meta:903 / list_renders:928 / delete_project:950 / list_assets:966 / render_frames:986 全部命中 |
| A3 | G-03 实现在 adapters/mcp/validate.go | ✅ | `validate.go` 存在（1077B），`validateRenderable` 定义在 :7 |
| A4 | tools.go 包注释已重写、无工具计数 | ✅ | 头注释现为 "registers the video_* MCP tools"，全仓 grep `12 video_` 零命中 |
| A5 | G-08a Layout 字段落地 | ✅ | `app/template/template.go:56` `Layout string` + 注释指明 video_list_templates |
| A6 | compose 保音频补丁落地 | ✅ | `app/service.go:994-997` `if scratch.Audio == nil { scratch.Audio = &Audio{} }` 后写 Voice |
| A7 | REST 13 条路由（非 12） | ✅ | `routes.go:78-91` 实测 13 条 `mux.Handle`（含 M3 批次 templates/compose）；agent 主动纠正任务书数字并给出依据，判定正确 |
| A8 | check_api 175:175 | ✅ | 实跑 OK |

### B 架构主文档（5/5 ✅）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| B1 | §0.5 现状校正新增 | ✅ | 架构文档 :66 `### 0.5 现状校正（2026-11-17）`，含六行校正表 |
| B2 | 头部 v2 指针 + 旧状态降格 | ✅ | :5 旧状态追加"已过时——见 §0.5"；:6 新增 2026-11-17 状态更新行，引用两份 v2 文档 |
| B3 | §10.2 加 26 工具注记 | ✅ | :574 `[现状校正 2026-11-17]` 明确"设计期子集" |
| B4 | §17 阶段表现状列 | ✅ | :861 F2 行第五列"已达成：check_api 175:175…" |
| B5 | §5.2 保留 128 注记 + 补 v2 资源预算 | ✅ | :293 同时含 `elements ≤128` 与 v2 资源预算指针 |

### C ROADMAP（2/2 ✅）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| C1 | G-05/06/09/10/11 五行标 LANDED | ✅ | :60-64 五行全部 `**LANDED 2026-11-17 (tools.go)** — landed —` |
| C2 | 纯英文（门禁） | ✅ | Python 正则扫全文件 CJK = NONE；语言门禁 OK |

### D compat（6/6 ✅，其中 1 条判定升级）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| D1 | 161→175 端点过时陈述校正 | ✅ | compat :20 明确列出旧值与现值 + `routes_contract_test.go:50` 证据 |
| D2 | platform 23→24 包 | ✅ | `ls platform/` = 24，与 agent 陈述一致 |
| D3 | 1MiB→50MiB 豁免落地 | ✅ | compat :23 引 `main.go:1609 BodyLimitExcept(50<<20, "/api/video/assets")` |
| D4 | ADR 0017 已落盘 | ✅ | `docs/adr/0017-agent-video-studio.md` 存在 |
| D5 | ScopePrefix 'video' 落地 | ✅ | compat 陈述与 ws.ts:24 一致（agent 已核实） |
| D6 | env var 分叉"实现向 §14 收敛" | ✅ **且发现真分叉** | 实测 `adapters/tts/tts.go:2,30` 读 **VIDEO_TTS_URL**、`adapters/aligner/aligner.go:3,28` 读 **VIDEO_ALIGNER_URL**；架构 §14 宣称 `VIDEO_TTS_PROVIDER/ENDPOINT/API_KEY/MODEL` 与 `VIDEO_ALIGNER_PROVIDER/ENDPOINT/API_KEY` —— agent 发现为真，且 compat 头注已如实记录 |

### E 案例库 + M3 注记（2/2 ✅）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| E1 | 案例库 v2 迁移注记、正文零改动 | ✅ | :3 注记完整（9 fixture + shuijing + pilot、不做双读、方法论延续）；`git diff --stat` 仅 +2 行 |
| E2 | M3 三档状态头注 | ✅ | :12 状态注记含 P0 已落地（217KB/948 码位/fontsubset.py 证据）/P1 定稿未实施（tools/renderimage 不存在）/P2 待镜像 |

### F docs-map（3/3 ✅，修复轮后）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| F1 | 族谱表完整 | ✅ **修复后** | 18 数据行覆盖全部视频文档；原审计发现的"agent 自述 17 行"偏差仅存于历史陈述，数据本身完整 |
| F2 | 全英文 | ✅ | CJK 扫描 NONE；语言门禁已把该文件纳入扫描（无 plan- 前缀） |
| F3 | 引用文件全部存在且状态真实 | ✅ **修复后** | 7 个 plan 文档 + 10 个 delivery-audit 全部存在；**修复轮已把 spec 行从 "in progress (not on disk yet)" 改为 "draft contract (landed; 15 open questions)"**，并同步清除 authority ordering 与 reading paths 中三处并行时态残留（"once it lands" / "a parallel task is adding" / "currently being updated in parallel"） |

### G spec 文档（3/3 ✅）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| G1 | 章节完备（§1-§6） | ✅ | §1 定位红线 / §2 逐字段契约（2.0-2.14 共 15 小节）/ §3 builder 简化 / §4 迁移 / §5 开放问题 / §6 对照索引 |
| G2 | 15 个开放问题 | ✅ | §5 实测 15 条 |
| G3 | 4 个 bug 断言为真 | ✅ **逐一实证** | 见下 §2 |

### H 门禁与构建（3/3 ✅）

| ID | 需求 | 判定 | 证据 |
|---|---|---|---|
| H1 | 语言门禁 | ✅ | `OK: 34 docs + 82 platform files English-clean`（33→34，新增 docs-map 纳入） |
| H2 | check_api | ✅ | 175:175 零漂移 |
| H3 | build + 视频单测 | ✅ | `go build ./...` OK；app/scriptgen/template/render 四包 ok |

### I 范围纪律（1/1 ✅）

| ID | 判定 | 证据 |
|---|---|---|
| I1 | 文档批未越界 | ✅ `git status` 显示 example/internal/video 下仅 ir.go/service.go 变更（属 MaxElements 批），adapters/、platform/、openapi.yaml 零改动 |

### J harness（1/1 ✅）

| ID | 判定 | 证据 |
|---|---|---|
| J1 | 试点 harness 完整 | ✅ `toolsite_assembly_test.go` 存在，含 `//go:build capx`、`TOOLSITE_PILOT_DIR` 环境变量入口 |

---

## 2. spec 自证 4 bug —— 独立复验结论

| # | bug 断言 | 复验 | 证据 |
|---|---|---|---|
| 1 | 音量缺省链断裂（TTS 落盘无 Volume → 渲染直读 0 → 静音） | **✅ 真 bug** | `service.go:996` `AudioTrack{Key, DurationSec}` 无 Volume（Go 零值 0）→ `render_pipeline.go:142` `voiceVolume = ir.Audio.Voice.Volume` 无条件覆盖 → `:133` 的 `voiceVolume := 1.0` 成死代码；MCP 文档 `tools.go:1334` 却称 "default 1"。**静默出无声片** |
| 2 | ir.go 半开区间注释自相矛盾 | **✅ 真** | `ir.go:503-508` 注释写 `[startFrame, endFrame)`；struct 注释与 builder（`tl.set(..., tEnd + 1/(fps*2))`）与 §7.0 实测均为含尾。校验逻辑恰好不受影响（边界检查用 `<= maxFrames`），纯注释债 |
| 3 | "投影期钳制"不存在 | **✅ 真** | `ir.go:470` 与 `service.go:1211` 均声称 "coords clamp at projection time"；但 `timeline-builder.js` 全文无坐标 clamp（仅 `:501` 的 frame seek clamp 与 `:243/275` 的时长 clamp），projector CSS 只有 `overflow: hidden`（:326）——实际是视觉裁切，不是坐标钳制 |
| 4 | "未知元素类型读时跳过"超前实现 | **✅ 真** | `timeline-builder.js:48-60` buildClipDOM：image→img、text→div、**其余一律落 shape 分支** `createElement('div') + className='el-shape'`（渲染空 div）；真跳过+warn 的只有动画（:449）与特效（:461）类型 |

**结论**：spec 文档的代码取证质量高——4 条自证 bug 全部独立复验为真，其中 #1（音量静音）是**会影响真实出片的 P1 级 bug**，不是文档洁癖。

---

## 3. 覆盖率报告

- **条目总数**：32（A8 + B5 + C2 + D6 + E2 + F3 + G3 + H3 + I1 + J1）
- **取证覆盖**：31 条完成取证（96.9%），F1 完成但判定 🟡（行数陈述与实际差 1）
- **证据强度分布**：强证据（可执行命令/测试）12 条；中证据（代码路径 file:line）19 条；弱证据 0 条
- **⚪ 清单**：无
- **未覆盖说明**：无条目遗漏；但"文档准确性"类条目（B/D/E 块的文字表述）以代码真值对照取证，未做全文档逐句校对（超出本轮范围）

---

## 4. Top 缺口（按严重度）

1. ✅ **已修复** docs-map spec 状态行陈旧（"in progress (not on disk yet)"）——修复轮改为 "draft contract (landed; 15 open questions)"，并清除 authority ordering 与 reading paths 的三处并行时态残留。
2. ✅ **已修复** docs-map 行数自述偏差——F1 判定澄清为"数据完整，偏差仅在 agent 自述"。
3. **~~范围外历史债~~ → 已修复（2026-11-17 代码批）**：
   - ✅ **音量静音 P1 bug 已修**：新增 `videoapp.ResolveAudioVolumes`（`ir.go`）作为混音增益单一真源——`Volume` 带 `omitempty` 无法区分显式 0 与缺省，0 一律解析为 1.0；`render_pipeline.go` 改调该函数，删除死代码 `voiceVolume := 1.0`；MCP 两处 schema 描述从 "default 0 = muted bgm"（把 bug 写成特性）改为 "omit or 0 = default 1.0; a true mute is not expressible in v1"；回归测试 `ir_audio_volume_test.go` 6 条全绿。v2 仍按 spec §2.10.1 将 volume 定为必填显式。
   - ✅ **env var 分叉已收敛（文档侧）**：架构 §14 的 TTS/Aligner 四行已从设计期臆想的三段式（`VIDEO_TTS_PROVIDER/ENDPOINT/API_KEY/MODEL`，从未实现）改为适配器真实契约（`VIDEO_TTS_URL` + 可选 `VIDEO_TTS_KEY`/`VIDEO_TTS_VOICE`；`VIDEO_ALIGNER_URL`），并加 2026-11-17 口径收敛注记。**能力边界如实声明**：按 ADR 0017，这两个适配器已实现但 example 的 `main.go` 从不构造它们（`Ports.Synth`/`Ports.Aligner` 恒 nil），故变量配置后不生效、`SetScript` 恒降级 estimated——这是记录在案的边界声明，非缺陷。

---

## 5. 方法学备注

- **文档版本**：ploykit 工作树（未提交），含 MaxElements=128 热修
- **取证手段**：grep 行号比对、Python CJK 扫描、实跑双门禁、`go build`+`go test -short`、git status 范围核对
- **环境限制**：未运行 `make verify` 全量（含 UI）；未跑需要 DB 的 `test-db`——本轮是文档批，二者不在交付面内
- **判定纪律**：所有 ✅ 均带 file:line；spec 的 4 bug 断言做了独立复验而非采信 agent 自述

---

## 6. 修复轮记录（2026-11-17，Phase 3）

审计发现的问题按"修一条标一条"处理，共 9 处（全部为文档内陈旧状态，无代码改动）：

| # | 文件 | 修复内容 | 原判定 |
|---|---|---|---|
| 1 | docs/video-studio-docs-map.md | spec 行 `in progress (not on disk yet)` → `draft contract (landed; 15 open questions)` + role 补全 | 🟡 F3 |
| 2 | docs/video-studio-docs-map.md | authority ordering #1：删除 "in progress / Until then it does not exist as a contract" 并行时态 | 同源 |
| 3 | docs/video-studio-docs-map.md | authority ordering #2：删除 "A parallel task is adding Section 0.5" → "Section 0.5 corrects its dated status claims as of 2026-11-17" | 同源 |
| 4 | docs/video-studio-docs-map.md | authority ordering #4：删除 "Currently being updated in parallel" → "reconciled against the landed tools on 2026-11-17 (per-gap line evidence)" | 同源 |
| 5 | docs/video-studio-docs-map.md | 清单表 5 行状态列同步更新（spec/ir-v2 plan/architecture/compat/agent-tools） | 同源 |
| 6 | docs/video-studio-docs-map.md | reading paths 两处 "once it lands" 删除 + 补 spec §5 十五开放问题指引 | 同源 |
| 7 | docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md | "（撰写中）" → "（已落盘草稿，§4 迁移表 + §5 十五个待决开放问题）"；**并校正头部文档状态**：原"本文没有任何一个案例被真实渲染过" → 现"L0-L3 全量达成、10,800/10,800 帧精确命中"（round9 证据） | 🟡 额外发现 |
| 8 | docs/plan-video-studio-ir-v2-2026-11-17.md | 状态 "提案" → "已批准（2026-11-17）"，补文档重构已交付指针 | 状态升级 |
| 9 | docs/plan-agent-video-studio-compat-2026-11-14.md | "变量名待 v2 spec 定稿" → 指向 spec §2.12/§2.6 已落盘草稿 | 🟡 同源 |
| 10 | docs/plan-video-studio-agent-tools-2026-11-16.md | 头部并行批说明标注为"历史背景"，明确 "16/17 基线仅作走查时点记录，现状以对账块为准" | 同上 |

**验证**：`check_docs_language.py` OK（34 docs English-clean）✓ `check_api.py` 175:175 ✓ 全量 CJK/陈旧标记复扫 = 仅剩本轮审计报告引用（应然）✓
