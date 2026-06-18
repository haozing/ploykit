# ploykit 大模型模块开发 Wiki 建设规划

> 本规划给人看，据此实施真实代码。最终产物（Wiki）给大模型看。
> 实施基线：仓库现状 2026-06-18。涉及的真实抓手见正文标注的文件路径。

## 1. 定位与两条根本约束

ploykit 让用户用大模型在 `modules/<id>/` 内写产品模块。我们要建的，是一套**专为大模型读、从真实代码新写、自成体系、独立维护**的 wiki。

两条贯穿全程的约束，先立在最前面：

- **A. 事实来源是代码，不是老文档。** wiki 不引用、不依赖 `docs/*.zh-CN.md` 那批给人看的散文（它们篇幅长、靠人主动检索、与代码会漂移）。wiki 的每条内容都从 `src/module-sdk/`、`scripts/`、`modules/` 的真实代码派生，并尽量用生成 + 校验锁死，使其永远跟随代码。老文档可以并存给人读，但不是 wiki 的上游。
- **B. 从大模型视角通盘设计，而非补丁式修三个问题。** "自己画菜单、不懂能力、外部对接错"只是症状样本。下面第 2 节按大模型写模块的**完整旅程**，系统列出全部失败模式；wiki 的结构（第 3–4 节）就是为覆盖这张全图而设计的。

## 2. 大模型失败模式全图（按写模块的旅程分阶段）

大模型不是"少知道某几件事"，而是在一个陌生框架里**默认套用训练记忆中的通用 Web 项目直觉**，于是在旅程的每个阶段都会偏。逐阶段列清，才能让 wiki 有的放矢。

### 阶段 A — 入门认知（进项目的头 30 秒）
- 把仓库当普通 Next.js，看不出这是"宿主 + 模块"两层架构。
- 不知道自己只该动 `modules/<id>/`，会去改 `apps/host-next/*`、`src/*`、宿主脚本。
- 不知道 `module.ts` 是模块的契约中心（声明先行，实现跟随）。
- 不知道开发闭环：create → 在 module.ts 声明 → 实现 → `modules:scan` → `module:doctor` → `module:test`。

### 阶段 B — 能力发现（"我要做这个功能，用什么"）
- 不知道 `ctx.*` 暴露了 30+ capability（`ModuleContext`，`src/module-sdk/context.ts:1047`），于是**自建第二套**：自己做 session、租户、余额、文件、通知。
- 没有"我想做 X → 用宿主的 Y"这张映射，凭直觉乱接。
- 用了某能力却忘了在 `module.ts` 声明对应 `Permission.*`，运行期被 guard 拦。
- 宿主没暴露的能力，不报告缺口，而是写死文案 / mock 假装完成。

### 阶段 C — 编码约定（动手写时）
- **自绘壳**：模块页面自己写导航、侧边栏、布局、账号菜单、workspace 切换器——而这些本由宿主 chrome / navigation / surfaces 提供（见 `modules/hello/module.ts` 的 `navigation`/`surfaces`，`presentation.ts:172` 的 `chrome`）。
- **越界引用**：`import src/lib/*`、读 `process.env`、直接用 `fetch()`/`pg`/`fs`/`child_process`。
- **Data v2 误用**：`scope` 选错（`user`/`workspace`/`public-read`/`system` 语义不分）、migration 模式（generated vs manual）混淆、字段约束乱写。
- **声明与实现错位**：module.ts 里声明的 route/action/job/webhook handler 路径与实际文件对不上。
- **presentation 元数据缺失/写错**：shell/chrome/SEO/cache/i18n/theme 不会填。

### 阶段 D — 外部服务接入
- 跳过"契约优先"，照口头/Markdown 描述直接写页面，不先拿 OpenAPI 等机器契约。
- 自己拼 bearer / HMAC / 签名 header，而不走 `serviceRequirements` + `ctx.services.invoke`。
- mock 与 live 行为分叉，调用路径不统一，切换就炸。
- 不做错误码分层（平台码 / 产品码 / 服务端业务码），页面掉回宿主兜底页。

### 阶段 E — 商业完整性
- 自建权威 credits / entitlements / orders / 订阅 / 兑换 / API key hash 表，而非走 `ctx.metering`/`ctx.credits`/`ctx.entitlements`/`ctx.commerce`。
- 把支付 webhook 直接落进模块订单表自行发权益，而非映射后调 `ctx.commerce.applyCheckoutPaid/applyRefund`。
- AI 用量只记 `ctx.usage`，不换算成 credits 走 `ctx.metering.charge`；长任务不先 `reserve`。

### 阶段 F — 验证与自纠
- 不知道写完该跑什么来验证。
- 跑了 `module:doctor` 却读不懂诊断、不据此循环修复。
- 分不清哪个 check 覆盖哪类问题（doctor / presentation:check / host-boundary-check / module:test）。
- 卡住时倾向于伪造通过，而不是报告"缺通用宿主扩展点"。

### 元层 — 信任与漂移
- 大模型会照"看起来权威"的内容自信写错；若 wiki 与代码漂移，它无法察觉。
- 因此 wiki 必须可生成的就生成、引用的符号必须有 check 守护。

> 这张全图是验收基准：wiki 建成后，每一阶段的每一类失败都应有明确的"哪一层 wiki / 哪个机制"去拦它（见第 6 节映射表）。

## 3. 设计原则（LLM wiki ≠ 人类 wiki）

- **入口决定一切**：大模型只读"自动加载的入口"和"被明确指向的页"。没有 always-on 入口，再好的内容等于不存在。
- **少即是多**：大模型把读到的全部塞进上下文，长文档挤掉理解你代码的注意力。每页短、任务导向。
- **上下文预算是硬约束**：`AGENTS.md` ≤120 行、`docs/llm/index.md` ≤80 行、单篇 concept ≤80 行、单篇 recipe ≤200 行；能力地图只放一屏摘要，超出就按类别拆页。
- **能生成就别手写**：可从代码派生的（能力清单、权限枚举、契约字段、错误码）一律生成 + CI 校验。手写只留"判断与约定"这类生成不出来的部分，且其引用的代码符号要被 check 守护。
- **来源边界显式**：`.generated.md` 只承载机器可再生的事实清单；"我想做 → 用什么 → 别做"这类用途/反模式判断放普通 `.md`，并在文件头标明"文案人工维护，代码符号由 check 校验"。
- **自成体系**：wiki 是大模型的唯一事实面，不让它在 wiki 和老 docs 之间跳转择信。
- **老 docs 策略前置**：P1 即写清 legacy docs policy：旧 `docs/*.zh-CN.md` 可保留给人读，但不是 LLM 模块开发事实源；大模型入口只信 `AGENTS.md` 与 `docs/llm/`。

## 4. Wiki 结构：一套自有的、分层的内容体系

全部新写，集中在 `docs/llm/` 下自成一体（不外链老 docs）。事实性清单从代码派生，判断性内容手写但受符号校验守护：

```
AGENTS.md                              ← 第0层：唯一入口，一页纸，自动加载（手写，极少变）
docs/llm/
  index.md                             ← 第1层：wiki 总目录 + 任务路由表（半生成）
  capabilities.generated.md            ← 第1层：机器能力清单（从 context.ts + 权限枚举生成）
  capability-usage.md                  ← 第1层：用途映射（手写文案 + 符号校验）
  contract.generated.md                ← 第1层：module.ts 契约字段速查（从 SDK 类型生成）
  recipes/                             ← 第2层：任务配方（半手写，可抄的步骤模板）
    multi-tenant-crud.md
    billing-charge.md
    service-backed.md
    white-label-page.md
    background-job.md
    public-page.md
  concepts/                            ← 第3层：少量"判断与约定"短文（纯手写，生成不出来的部分）
    host-vs-module.md                  ← 宿主出壳 vs 模块填内容的边界
    scope-and-tenancy.md               ← scope/workspace/environment 多租户模型
    commercial-integrity.md            ← 为什么商业事实必须走宿主原语
    service-contract-first.md          ← 外部服务为什么契约优先
  errors.generated.md                  ← 第3层：平台错误码表（从 runtime 错误码常量生成）
modules/<选定样例>/                     ← 黄金样例模块（能跑、被测试、标注为"标准参考"）
```

四层职责递进：**入口路由 → 能力/契约索引 → 任务模板 → 概念与约定**。大模型从第 0 层进，按需向下拉取。

### 层级定位速查

| 层 | 文件 | 性质 | 何时被读 | 维护方式 |
| --- | --- | --- | --- | --- |
| 0 | `AGENTS.md` | 手写一页纸 | 每次进项目自动加载 | 人，极少改 |
| 1 | `docs/llm/index.md` | 半生成 | "我该看哪页" | 路由表手写，清单生成 |
| 1 | `docs/llm/capabilities.generated.md` | 生成 | "有哪些 `ctx.*` / `Permission.*` 可用" | 脚本，随代码 |
| 1 | `docs/llm/capability-usage.md` | 手写映射 + 符号校验 | "我想做 X 该用什么" | 人维护文案，脚本校验符号 |
| 1 | `docs/llm/contract.generated.md` | 生成 | "module.ts 字段怎么填" | 脚本，随代码 |
| 2 | `docs/llm/recipes/*.md` | 半手写模板 | "我要做某类任务" | 人 + 生成片段 |
| 3 | `docs/llm/concepts/*.md` | 纯手写短文 | "为什么要这样" | 人，少量 |
| 3 | `docs/llm/errors.generated.md` | 生成 | "这个错误码什么意思" | 脚本，随代码 |
| — | 黄金样例模块 | 真实代码 | 写新模块时模仿 | 人 + CI 守护 |

**为什么这套结构能覆盖全图**：第 0 层立规矩拦阶段 A；第 1 层的 capabilities/usage/contract 拦阶段 B、C 的"不知道、乱接、填错"；第 2 层 recipes 拦 C、D、E 的"不会做"；第 3 层 concepts 拦"知其然不知其所以然导致的越界"；errors 表 + 教学化 doctor 拦阶段 F。详见第 6 节逐条映射。

## 5. 各层详细规划

### 第 0 层 · AGENTS.md（最高优先，最小投入）

**为什么是它**：Claude Code / Cursor / Copilot 都会自动加载根目录 AGENTS.md。这是把全部护栏送到大模型面前的唯一开关。当前缺失 = wiki 再好也读不到。

**内容（一页纸，只做立规矩 + 路由，不写实现）**，正面拦阶段 A，并把其余阶段路由出去：
1. **架构与边界**：这是"宿主 + 模块"两层架构；你只动 `modules/<id>/`，不碰 `apps/host-next/*`、`src/lib/module-runtime/*`、`src/module-sdk/*`、`scripts/host-*`。
2. **开发闭环**：create → 在 `module.ts` 声明契约 → 实现 → `npm run modules:scan` → `npm run module:doctor -- <id>` 按第一条 error 修 → `module:test`。
3. **核心铁律**（每条一句话 + 链到对应 recipe/concept；P1 若目标页尚未交付，先只链到 `docs/llm/index.md`，避免悬空链接误导模型）：
   - 壳由宿主出（→ `concepts/host-vs-module.md`、`recipes/white-label-page.md`）
   - 多租户用 scope（→ `concepts/scope-and-tenancy.md`、`recipes/multi-tenant-crud.md`）
   - 商业事实走宿主原语（→ `concepts/commercial-integrity.md`、`recipes/billing-charge.md`）
   - 外部服务契约优先（→ `concepts/service-contract-first.md`、`recipes/service-backed.md`）
   - 不伪造状态：缺能力就报告缺扩展点，不写死文案/mock。
4. **能力与契约索引指针**：查机器能力清单 → `capabilities.generated.md`；查用途映射 → `capability-usage.md`；module.ts 怎么填 → `contract.generated.md`。
5. **任务路由表**："我要做 X → 看 recipes/Y.md"。

约束：AGENTS.md 全部链出去，≤120 行，目标一屏读完。

### 第 1 层 · 能力事实 + 用途映射 + 契约速查

**为什么拆开**：`ctx.*` 散在 1000+ 行的 `context.ts`，`module.ts` 契约字段散在 SDK 类型里，大模型不会通读，手写清单必漂移；但"用途/反模式"是人工判断，不能伪装成全自动事实。因此分成机器事实页和手写用途页。

**现成抓手**：
- `scripts/generate-module-map.mjs` 已为每个模块产出 `capabilitySummary`（routes/dataModels/permissions/backgroundHandlers/commercialRequirements/presentationContributions）。
- `ModuleContext` 接口（`context.ts`）是结构化字段列表，每字段 = 一个 capability 大类。
- `src/module-sdk/permissions.ts` 是权限枚举权威源。
- `module.ts` 的形状由 `defineModule` 的类型（`src/module-sdk/define-module.ts` + `types.ts`）约束。

**`capabilities.generated.md` 内容**（机器生成，非 API dump，但只放可校验事实）：

| 能力 | `ctx.*` | 相关权限 | 来源 |
| --- | --- | --- | --- |
| Data v2 | `ctx.data` / `ctx.scope` | `Permission.DataTableRead` / `Permission.DataTableWrite` | `src/module-sdk/context.ts` + `permissions.ts` |
| 当前用户/登录态 | `ctx.user` / `ctx.auth` | — | `src/module-sdk/context.ts` |
| 扣费/计量 | `ctx.metering` / `ctx.credits` | `Permission.MeteringWrite` / `Permission.CreditsConsume` | `src/module-sdk/context.ts` + `permissions.ts` |
| 权益判断 | `ctx.entitlements` | `Permission.EntitlementsRead` | `src/module-sdk/context.ts` + `permissions.ts` |
| 文件上传 | `ctx.files` | `Permission.FilesWrite` | `src/module-sdk/context.ts` + `permissions.ts` |
| 通知 | `ctx.notifications` | `Permission.NotificationsSend` | `src/module-sdk/context.ts` + `permissions.ts` |
| 外部受控服务 | `ctx.services` | `Permission.ServicesInvoke` | `src/module-sdk/context.ts` + `permissions.ts` |
| 普通外部 HTTP | `ctx.http` | `Permission.ExternalHttp` | `src/module-sdk/context.ts` + `permissions.ts` |

文件头必须声明：本页由脚本生成，不手改；若内容不对，改 SDK 类型、权限枚举或生成脚本。

**`capability-usage.md` 内容**（手写用途/反模式，符号由 check 校验）——"我想做 → 用什么 → 要哪个权限 → 别做"：

| 我想做 | 用 | 权限 | 别做 |
| --- | --- | --- | --- |
| 多租户隔离数据 | Data v2 `scope:'workspace'` + `ctx.scope.workspaceId` | `Permission.DataTableRead` / `Permission.DataTableWrite` | 不自建 tenant 列 |
| 当前用户/登录态 | `ctx.user` / `ctx.auth` | — | 不自建 session |
| 扣费/计量 | `ctx.metering.charge` / `ctx.credits.reserve` | `Permission.MeteringWrite` / `Permission.CreditsConsume` | 不自建余额表 |
| 权益判断 | `ctx.entitlements.has` | `Permission.EntitlementsRead` | 不自建套餐表 |
| 文件上传 | `ctx.files.createUpload` | `Permission.FilesWrite` | 不直连 S3 |
| 通知 | `ctx.notifications.send` | `Permission.NotificationsSend` | — |
| 外部受控服务 | `ctx.services.invoke` | `Permission.ServicesInvoke` | 不自拼签名 |
| 普通外部 HTTP | `ctx.http.fetch` | `Permission.ExternalHttp` | 不用全局 fetch |

**`contract.generated.md` 内容**：`module.ts` 顶层字段（id/version/contractVersion/permissions/data/routes/actions/jobs/events/webhooks/navigation/surfaces/presentation/serviceRequirements/resourceBindings…）各自的形状、必填项、合法枚举值，从 SDK 类型生成。

**实施**：新增 `scripts/generate-llm-wiki.mjs`（或并入 module-map 生成链）。脚本从 `ModuleContext` 字段 + 权限枚举 + SDK 类型生成 `capabilities.generated.md` / `contract.generated.md`；同时校验 `capability-usage.md` 中引用的 `ctx.*`、`Permission.*`、recipe 路径是否存在。

**校验**：`capability-usage.md`、AGENTS.md、recipes 引用了不存在的 `ctx.*` 字段、已删的 `Permission.*` 或不存在的目标页 → CI 红，挂进 `modules:check`。

### 第 2 层 · recipes（半手写模板）

大模型读"带约束的可抄模板"命中率远高于读散文。每篇一个完整"意图→声明→代码→验证→红线"闭环。

**每篇固定结构**（≤200 行）：① 意图一句话 ② 用到的 `ctx.*` + 必须声明的 permissions ③ `module.ts` 该写什么（片段）④ 可直接抄改的最小代码 ⑤ 验证命令 ⑥ 本配方最易犯的越界/伪造。

**首批清单**（对齐失败全图的 C/D/E）：
- `multi-tenant-crud.md` — 多租户 Data v2 CRUD（阶段 B/C）
- `billing-charge.md` — 计量扣费 + reserve/commit（阶段 E）
- `service-backed.md` — 对接独立服务（阶段 D）
- `white-label-page.md` — 页面替换/白牌 + 宿主 shell（阶段 C：治自绘壳）
- `background-job.md` — jobs/artifacts/notifications
- `public-page.md` — 公开站点页 + presentation/SEO

内容全部从样例模块和 SDK 真实写法提炼，不复制老 docs。

### 第 3 层 · concepts 短文 + 错误码表

**concepts/**：少量纯手写短文，承载"判断与约定"这类生成不出来、又决定大模型会不会越界的东西。每篇只讲"边界在哪、为什么"，不重复 recipe 的步骤。四篇对齐四条铁律的"为什么"。

**`errors.generated.md`**：平台错误码表（`MODULE_SERVICE_*` 等），从 runtime 错误码常量生成，供大模型在页面里做错误分层映射时查。

### 黄金样例模块（对大模型胜过万字文档）

大模型写新模块第一反应是模仿仓库已有的。`hello` 太小教不会真实模式，`runlynk`（41 routes/48 actions）噪声淹没范式。

**方案**：选定/建立一个"标准参考模块"，覆盖最易写错的四件事——宿主 chrome、多租户 Data v2、一个 service-backed 调用、一个计费扣费。路线择一（实施定）：A 新建 `modules/_reference/`；B 补齐现有最规范 demo（候选 `capability-demo`）。

**守护**：样例必须过 `module:test` / `module:doctor`，保证它永远是"能跑的对的写法"，且被 recipes 直接引用为出处。

### 闭环增强 · 教学化 doctor（最强一环，拦阶段 F）

**为什么最强**：不依赖大模型事先读过任何 wiki——在犯错那一刻把指引送到眼前。

**现状抓手**：`module:doctor` 已是规则化诊断系统（`scripts/ploykit-module.mjs` 调 `module-doctor-contract-rules`/`-capability-rules`/`-dependency-rules`/`-map-rules`/`-source-boundary-rules`），diagnostic 已支持 `fix` 字段。

**规划**：把已有诊断的 message/fix 升级为"可执行 + 链到 recipe"的文案，例如：
- 用 `ctx.credits` 缺 `Permission.CreditsWrite` → "加上它"。
- service-backed client 直接 fetch 受控 origin → 指向 `recipes/service-backed.md`。
- 页面 `chrome:'none'` 又内含导航结构 → "导航由宿主 chrome 提供，移除自绘菜单，见 concepts/host-vs-module.md"。

不新增判定逻辑，只升级文案——形成 just-in-time wiki。

## 6. 失败模式 → 解法 覆盖映射（验收基准）

每一类失败都要有明确的拦截层，无空白：

| 阶段/失败 | 主要拦截 | 辅助 |
| --- | --- | --- |
| A 当成普通项目/越界改宿主 | AGENTS.md 架构与边界 | host-boundary-check、source-boundary doctor 规则 |
| A 不懂开发闭环 | AGENTS.md 闭环段 | — |
| B 不知能力/自建第二套 | capability-usage.md + capabilities.generated.md | concepts、教学化 doctor |
| B 忘声明 permission | contract.generated.md | capability doctor 规则（教学化） |
| B 缺能力却伪造 | AGENTS.md 不伪造铁律 | concepts |
| C 自绘壳 | concepts/host-vs-module + recipes/white-label-page | doctor chrome 规则 |
| C 越界引用/Data v2 误用 | contract.generated + recipes/multi-tenant-crud | source-boundary + contract doctor 规则 |
| C 声明实现错位 | contract.generated.md | map doctor 规则 |
| D 外部对接错 | recipes/service-backed + concepts/service-contract-first | errors.generated、service doctor 规则 |
| E 自建商业权威 | recipes/billing-charge + concepts/commercial-integrity | commercial doctor 规则 |
| F 不会验证/读不懂诊断 | AGENTS.md 闭环 + 教学化 doctor | recipes 各篇验证段 |
| 元 漂移/来源混淆 | 生成 + check 守护；`.generated.md` 与手写页分离 | — |

## 7. 防漂移机制

1. **生成 + 校验**：capabilities / contract / errors 全生成；`capability-usage.md` 手写但符号受校验。新增 check，若 AGENTS.md / usage / recipe 引用了不存在的 `ctx.*`、`Permission.*`、npm script、wiki 链接或样例文件路径 → CI 红，挂进 `modules:check`。
2. **doctor 即 just-in-time 文档**：见上节，最不依赖"事先读过"。
3. **样例模块即活文档**：recipes 的代码出处指向受 `module:test` 守护的样例，样例改坏 CI 就红。

## 8. 实施优先级与阶段

| 阶段 | 交付物 | 投入 | 风险 | 验证 |
| --- | --- | --- | --- | --- |
| P1 | `AGENTS.md` + `docs/llm/index.md` 骨架 + legacy docs policy | 半天 | 极低（纯文档） | 无悬空链接；大模型能复述铁律并被路由 |
| P1.5 | 四篇 concepts 短文 | 半天–1天 | 低（纯文档，但需写清边界） | 人工通读；每篇 ≤80 行；AGENTS/index 链接补齐 |
| P2 | 黄金样例模块（选定+补齐+标注） | 1–2天 | 低 | `module:doctor`/`module:test` 通过 |
| P3 | `capabilities.generated.md` / `contract.generated.md` / `errors.generated.md` + `capability-usage.md` + 生成脚本 + 漂移 check | 1–2天 | 中（碰生成链，只读 SDK 不改 runtime） | 生成产出；usage 符号校验；check 挂入 `modules:check` |
| P4 | recipes 首批 6 篇 + doctor 文案教学化升级 | 2–3天 | 中（碰 doctor 文案，不改判定逻辑） | recipe 命令可跑通；doctor 输出人审 |

**关键约束**：实施只新增 `docs/llm/*`、`AGENTS.md`、生成脚本、样例模块；P3/P4 触碰 `generate-module-map.mjs` 与 doctor 规则文件时，只新增生成产物、升级文案，不改判定/运行时逻辑。

## 9. 验收标准与效果验证

### 9.1 工程验收

- 大模型进项目即读到 AGENTS.md，能复述铁律。
- 第 6 节映射表每一行都有真实落地物，无空白。
- 问"多租户 CRUD / 计费 / 接外部服务 / 做页面"时，被路由到对应 recipe 并照抄出过 doctor 的代码。
- capabilities/contract/errors 与代码零漂移（check 守护）；capability-usage 的人工文案与可校验符号边界清晰。
- 黄金样例持续过 `module:test`/`module:doctor`。
- doctor 对常见越界给出可执行且链到 wiki 的提示。
- 整套 wiki 不外链老 docs，自成事实面。
- 所有入口页满足上下文预算：AGENTS ≤120 行，index ≤80 行，concept ≤80 行，recipe ≤200 行。

### 9.2 LLM 纠偏实验设计

目标不是证明"文档写完了"，而是证明大模型被纠正了。实施前后各跑一次同一组任务，记录差异：

| 任务 | 主要观察点 |
| --- | --- |
| 做一个多租户 CRUD 模块 | 是否使用 Data v2 scope；是否自建 tenant 列/session；是否声明 permission |
| 做一个计量扣费功能 | 是否走 `ctx.metering`/`ctx.credits`；是否自建余额/订单权威表 |
| 接一个外部受控服务 | 是否先声明 `serviceRequirements`；是否走 `ctx.services.invoke`；是否绕过契约直连 |
| 做一个白牌页面 | 是否依赖宿主 chrome/navigation/surfaces；是否自绘侧边栏/账号菜单 |
| 写完后自检修复 | 是否按 AGENTS 闭环跑 `modules:scan`、`module:doctor`、`module:test`，并按第一条错误修 |

实验方法：固定模型、固定初始仓库、固定 prompt；wiki 前在干净分支跑 baseline，wiki 后在同条件下重跑。每个任务按 0/1 记录：是否改宿主、是否伪造状态、是否使用正确宿主能力、是否声明契约/权限、是否通过 doctor/test、是否能解释自己选择的 recipe。通过标准：P4 完成后，同一任务集中常见越界显著下降，且失败时能被 doctor/wiki 指向正确修复路径。

## 10. 待定决策（实施前需拍板）

1. 黄金样例走路线 A（新建 `_reference`）还是 B（补齐 `capability-demo`）？
2. 生成脚本独立 `scripts/generate-llm-wiki.mjs` 还是并入 `generate-module-map.mjs`？
3. wiki 语言：中文 / 中英双语（影响维护成本）？
4. 是否同时放 `CLAUDE.md`（兼容不同工具加载约定，可与 AGENTS.md 互为软链或副本）？
5. 哪些旧文档需要加 legacy banner / 指向 `AGENTS.md` 与 `docs/llm/`，以及是否后续逐步废弃。
