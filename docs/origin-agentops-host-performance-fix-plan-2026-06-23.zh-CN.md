# Origin AgentOps 卡顿问题中的宿主整改方案

分析日期：2026-06-23
关联主报告：`docs/origin-agentops-frontend-performance-analysis-2026-06-23.zh-CN.md`
目标：把主报告中“需要宿主框架改”的部分单独提炼出来，形成宿主侧可执行整改清单。
范围：`apps/host-next/*`、`src/lib/module-runtime/*`、`src/module-sdk/*`、`scripts/*`。

## 1. 结论

这次卡顿不能简单归因为“PloyKit host/module 架构整体设计错了”。线上证据显示，宿主的 dashboard client transition 大体已经生效：可见侧栏入口多数是 `?_rsc=` 请求，而不是完整 document navigation。

但这次问题也暴露了宿主框架的几个架构缺口：

1. 宿主能测到 dashboard 路由总耗时和部分内部 span，但没有把这些指标稳定暴露给浏览器审计、CI 门禁和模块质量报告。
2. 宿主现有 transition smoke 默认只覆盖通用 dashboard 路由，没有强制覆盖模块声明的高频路由，也没有默认启用 RSC payload budget。
3. `ModulePageRoute` 当前只有单个 `loader?: string`，宿主没有给“同一个 dashboard 产品下多个 section 使用不同轻量 loader”提供一等契约；模块可以手写多个静态 route 绕开，但框架没有约束和引导。
4. 模块 API 入口除了宿主 proxy 粒度的 `Server-Timing` 外，没有统一的 route match、handler、payload size 等细粒度 timing，导致 `/api/modules/origin-agentops/audit`、`traces` 这类重接口只能从客户端瀑布猜测。
5. release gate 已经检查 document navigation、hydration、transition P95，但没有把模块级 route、RSC 体积、loaderData 体积、API 体积纳入必过口径。

因此，这份文档只保留宿主侧整改：可观测、可预算、可声明、可门禁。目标是让这类切页卡顿以后能被宿主框架主动发现和拦截。

## 2. 现有宿主代码事实

### 2.1 Dashboard route 已有基础 timing

`apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx`：

- line 627-642：测量 `auth`、`module-host`、`session`、`module-session`。
- line 644-663：测量 `navigation`。
- line 667-686：测量 `route-resolve`，并接收 module runtime 的 timing span。
- line 697-703：并发解析 `shell-data` 和 `modulePageResult`。
- line 722-731：调用 `maybeLogDashboardTiming(...)` 输出 dashboard timing。

`src/lib/module-runtime/adapters/page-route.ts`：

- line 367-369：测量组件加载。
- line 381-385：测量 route loader。
- line 397-401：测量 metadata loader。

这说明宿主已经能拿到“模块 loader 到底花了多久”的一部分数据。缺口是这些数据只进日志，没有形成浏览器可读、CI 可读、可聚合的性能证据。

### 2.2 Server-Timing helper 存在但未接入 dashboard 响应

`apps/host-next/lib/dashboard-timing.ts`：

- line 47-58：已有 `createDashboardServerTimingHeader(...)`。
- 当前 `rg` 结果显示，这个函数没有被 dashboard route 使用。

`apps/host-next/proxy.ts`：

- line 23-25：当前响应已经带有 `x-request-id`、`x-correlation-id` 和 `server-timing: proxy;dur=...`。
- 这只能说明 proxy 层耗时，不包含 dashboard route、module loader、metadata loader 或 module API handler 的细粒度耗时。

注意：Next App Router 的 RSC page 不能像普通 Route Handler 一样随手设置当前响应头。宿主不应简单在 page 里“调用一下 header helper”。干净做法是二选一：

1. 对 module API route 追加真实的业务 `Server-Timing` 响应头，例如 route match、handler load、handler execute、serialize，而不是只保留 proxy 粒度。
2. 对 dashboard RSC page 建立 request-id + timing side channel，让 Playwright smoke 和线上观测能按 request id 读取 dashboard timing。

### 2.3 Client transition 拦截已存在

`apps/host-next/components/layout/AppFrame.tsx`：

- line 47-48：dashboard/admin shell 上挂了 `data-host-app-frame` 和 `ClientTransitionLinks`。

`apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx`：

- line 601-613：`HostClientTransitionFrame` 也会给 unframed module page 包一层 transition frame。
- line 737-739：无宿主 chrome 的模块页仍会被 `HostClientTransitionFrame` 包住。

`apps/host-next/components/layout/ClientTransitionLinks.tsx`：

- line 18-27：监听 `a[href]` 点击，并确认它在当前 `data-host-app-frame` 内。
- line 45-46：阻止默认跳转，用 `router.push(...)` 进行 client transition。

`apps/host-next/lib/client-transition-links.ts`：

- line 71-83：只允许同源且属于当前 dashboard/admin area 的链接。
- line 77-80：裸 `/dashboard/...` 会补当前语言前缀。

所以宿主不是没有 client transition，而是需要把“所有模块内关键链接都不退化成 document navigation”变成强制门禁。

### 2.4 Transition smoke 有能力，但默认覆盖不足

`scripts/host-dashboard-transition-smoke.mjs`：

- line 12-25：已支持 `--max-document-navigations`、`--max-p95-ms`、`--max-rsc-transfer-bytes`。
- line 39：默认路由是 `/zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files`，不覆盖 Origin AgentOps。
- line 509-549：已输出 document navigation、hydration、RSC transfer、transition P95 检查。
- line 603-656：报告里已有 RSC 数量、RSC P95、RSC transfer P95、Server-Timing header 数量。

`src/lib/module-runtime/release/rc-gate.ts`：

- line 430-454：release gate 要求 document navigation 为 0、hydration error 为 0、transition P95 通过。
- 已改为强制要求 `transition:rsc-transfer`，并要求模块级 concrete route 列表进入 smoke。

## 3. 宿主 P0：把 dashboard/module 性能变成可观测证据

### 3.1 复用现有 request id

宿主已有统一链路标识：`apps/host-next/proxy.ts` 会写入 `x-request-id` 和 `x-correlation-id`，module context 与 service context 也已经读取 `x-request-id`。整改时应复用这条链路，不再引入第二套主 id。

- 请求头已有 `x-request-id` 时复用。
- 没有时沿用 proxy 生成逻辑。
- 响应、side channel、timing report、API report、transition smoke report 都包含 `x-request-id`。
- 如果为了诊断兼容需要 `x-ploykit-request-id`，只能作为 `x-request-id` 的别名输出，不能生成不同值。

建议改动位置：

- `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx`
- `apps/host-next/app/api/modules/[...path]/route.ts`
- `src/lib/module-runtime/adapters/api-dispatcher.ts`

### 3.2 Dashboard RSC 使用 timing side channel

由于 dashboard page 不能可靠设置 RSC 响应头，建议新增宿主内部 timing sink：

- 在 `DashboardPage` 读取 `x-request-id`，缺失时才生成兜底 id。
- `maybeLogDashboardTiming` 除了 `console.info`，同时写入一个短 TTL runtime buffer。
- 新增只在本地、测试或管理员可用的读取接口，例如 `/api/host/diagnostics/dashboard-timing?requestId=...`。
- transition smoke 在捕获 RSC 请求后，按 request id 拉取 timing，合并进 `.runtime/dashboard-transition-smoke/latest.json`。

需要记录的字段：

| 字段 | 说明 |
| --- | --- |
| `pathname` | 当前 dashboard path。 |
| `moduleId` | 命中的模块。 |
| `routePath` | contract route path，例如 `/origin-agentops/[section]`。 |
| `matchedPath` | 实际 manifest match。 |
| `totalMs` | dashboard route 总耗时。 |
| `spans[]` | `auth`、`navigation`、`shell-data`、`route-resolve`、`module-loader` 等。 |
| `loaderDataBytes` | 仅在 diagnostics/smoke 模式或显式环境开关下采集；使用有上限的安全估算，失败时记录 `null`、`sizeUnavailableReason`，不能在生产热路径无条件 `JSON.stringify`。 |
| `metadataBytes` | 与 `loaderDataBytes` 使用相同采样开关；普通请求记录 disabled，不做热路径序列化。 |
| `cachePolicy` | module page route cache 策略。 |
| `cacheHit` | `cachedDashboardModulePageRoute` 的真实命中状态，而不是固定占位。 |

### 3.3 Module API 使用真实业务 `Server-Timing`

模块 API 是 Route Handler，可以直接设置响应头。当前 proxy 已经给响应写入 `server-timing: proxy;dur=...`，但这个值无法解释模块 API 自身慢在哪里。宿主应在 `apps/host-next/app/api/modules/[...path]/route.ts` 或 `src/lib/module-runtime/adapters/api-dispatcher.ts` 做统一包装：

- 记录 route match、auth/access、handler load、handler execute、response serialize。
- 记录 response body bytes 时优先使用 `content-length`；宿主自己创建 JSON response 的路径可在创建点记录 body size；未知 body 或 streaming body 记录 `unknown`。只有在 smoke/采样模式且小于上限时，才允许 clone response 估算体积。
- 追加或合并 `Server-Timing`，例如 `module-api-match;dur=...`, `module-api-handler;dur=...`, `module-api-serialize;dur=...`, `module-api-total;dur=...`；如果已有 `proxy;dur=...`，不要覆盖掉 proxy span。
- 增加 `x-ploykit-module-id`、`x-ploykit-route-path`、`x-request-id` 这类低风险诊断 header；`x-ploykit-request-id` 如需保留，只能镜像 `x-request-id`。

这会直接提升对 `/api/modules/origin-agentops/audit`、`traces`、`agents` 等接口的定位能力。

## 4. 宿主 P0：把 transition smoke 扩展到模块路由

当前 smoke 默认只测通用 dashboard 页面，无法覆盖 Origin AgentOps 这种模块产品。宿主需要让模块 route 成为 transition smoke 的一等输入。

### 4.1 支持模块路由输入，但不盲目展开动态路由

`scripts/host-dashboard-transition-smoke.mjs` 支持显式 `--routes` 和模块级 `--module-id`。模块级运行会从 `quality.performance.dashboardTransitions.routes`、dashboard navigation 和 product pages 收集 concrete route。

```bash
npm run host:dashboard-transition-smoke -- --required --repeat 3 --inject-anchor --module-id origin-agentops
```

落地行为：

- 显式 `--routes` 仍可用于精确指定审计路径。
- 支持从模块 `navigation` 贡献中读取 concrete dashboard href，作为 `--module-id` 的默认 route 来源。
- 支持模块 `quality.performance.dashboardTransitions.routes` 覆盖默认列表。
- 自动补语言前缀，例如 `/zh/dashboard/origin-agentops/agents`。
- 如果 manifest 里只有 `/origin-agentops/[section]` 这类动态 route，不能自动猜测 `section`；必须要求模块通过 `quality.performance.dashboardTransitions.routes`、`navigation` 或命令行 `--routes` 提供 concrete URL。
- 至少选 3 个高频 concrete route；如果可用 route 不足，smoke 应失败并提示缺少明确路由来源。

Origin AgentOps 推荐覆盖：

- `/zh/dashboard/origin-agentops/agents`
- `/zh/dashboard/origin-agentops/skills`
- `/zh/dashboard/origin-agentops/tools`
- `/zh/dashboard/origin-agentops/runtime`
- `/zh/dashboard/origin-agentops/traces`
- `/zh/dashboard/origin-agentops/admin`
- `/zh/dashboard/origin-agentops/api-keys`

### 4.2 默认启用 RSC transfer budget

`HOST_DASHBOARD_TRANSITION_MAX_RSC_TRANSFER_BYTES` 在普通本地 smoke 中仍可为 `0`，但 required/module 模式会启用默认预算，并且模块声明的预算会覆盖平台默认值：

- 普通本地 smoke 可继续允许 `0`，避免开发期误伤。
- `--required` 或 `--module-id` 时默认启用 RSC transfer 预算。
- required/module 模式的平台默认值：`80KB` 到 `120KB`。
- 模块可在 `quality.performance.dashboardTransitions` 中声明 `maxDocumentNavigations`、`maxHydrationErrors`、`maxP95Ms`、`maxRscTransferBytes`。
- 命令行显式预算优先；未显式传参时使用模块声明预算；再缺省时使用平台默认值。
- 超预算时 smoke 或 release gate 失败，报告中明确列出 route 级 P95 ms、RSC P95 bytes 和对应预算。

对 Origin AgentOps 的短期目标：

| 项 | 当前观测 | 短期目标 | 长期目标 |
| --- | ---: | ---: | ---: |
| 高频切页 RSC | `161KB` 到 `163KB` | `< 100KB` | `< 60KB` |
| 高频切页 P95 | `2.6s` 到 `3.7s` | `< 1.5s` | `< 800ms` |
| document navigation | 可见入口为 0，深入口待测 | 0 | 0 |
| hydration error | direct goto admin 有 1 个 `#418` | 0 | 0 |

### 4.3 Release gate 必须读取模块 transition 证据

改 `src/lib/module-runtime/release/rc-gate.ts`：

- 如果模块声明了 dashboard transition quality，则 release gate 必须找到对应 evidence。
- 必须校验 `transition:rsc-transfer`，不能只校验 P95。
- 必须按 route 校验模块声明的 transition P95、RSC transfer、document navigation 和 hydration 预算；不能用全局 summary 的最小预算一刀切。
- evidence 文案应包含模块 id、route、document navigation 数、hydration error 数、RSC P95 bytes、transition P95 ms。

## 5. 宿主 P1：扩展 module quality 性能预算

当前 `src/module-sdk/types.ts` 的 `ModuleQualityDefinition` 只有：

- `routes.browser`
- `routes.accessibility`
- `evidence`

已增加性能预算契约：

```ts
quality: {
  performance: {
    dashboardTransitions: {
      routes: [
        '/origin-agentops/agents',
        '/origin-agentops/skills',
        '/origin-agentops/traces'
      ],
      maxDocumentNavigations: 0,
      maxHydrationErrors: 0,
      maxP95Ms: 1500,
      maxRscTransferBytes: 100_000
    },
    pageRoutes: [
      {
        shell: 'dashboard',
        path: '/origin-agentops/[section]',
        params: { section: 'traces' },
        samplePath: '/origin-agentops/traces',
        maxLoaderMs: 500,
        maxLoaderDataBytes: 20_000
      }
    ],
    apiRoutes: [
      {
        path: '/origin-agentops/audit',
        method: 'GET',
        auth: 'admin',
        maxP95Ms: 800,
        maxResponseBytes: 150_000
      }
    ]
  }
}
```

需要同步修改：

- `src/module-sdk/types.ts`
- `src/module-sdk/validator.ts` 或独立 validator
- `scripts/generate-module-map.mjs`
- `scripts/module-quality-manifest.mjs`
- `scripts/module-quality.mjs`
- `src/lib/module-runtime/release/rc-gate.ts`
- `docs/llm/contract.generated.md`

这个改动的价值是：模块作者在 `module.ts` 中声明自己的性能承诺和 concrete 采样路径，宿主负责收集和验收，而不是每个模块单独写一套 Playwright 脚本。`dashboardTransitions` 接入 dashboard transition smoke 和 release gate；`pageRoutes` 接入 `module-page-performance` evidence；`apiRoutes` 接入 `module-api-performance` evidence。

## 6. 宿主 P1：把 section loader 做成正式契约

当前 `ModulePageRoute` 只有 `loader?: string`。模块可以通过声明多个静态 route 来绑定不同 loader，因为 `src/lib/module-runtime/routes/route-manifest.ts` 已按路径长度和静态段优先级排序。但这个做法不够直观，也缺少 doctor 引导。

既然这次不以兼容旧形态为目标，宿主应直接把参数分发做成一等契约，而不是把它留给模块作者拆静态 route 或靠 doctor warning 兜底。

### 6.1 route loader 选择契约直接落地

在 `ModulePageRoute` 上新增 `loaderByParam`、`metadataByParam`、`cacheByParam`：

```ts
{
  path: '/origin-agentops/[section]',
  component: './components/AgentOpsApp',
  loaderByParam: {
    section: {
      agents: './loaders/agents',
      skills: './loaders/skills',
      traces: './loaders/traces',
      runtime: './loaders/runtime',
      admin: './loaders/admin'
    }
  },
  metadataByParam: {
    section: {
      agents: './loaders/agents-metadata',
      skills: './loaders/skills-metadata',
      traces: './loaders/traces-metadata',
      runtime: './loaders/runtime-metadata',
      admin: './loaders/admin-metadata'
    }
  },
  cacheByParam: {
    section: {
      agents: { strategy: 'private', revalidateSeconds: 10 },
      skills: { strategy: 'private', revalidateSeconds: 10 },
      traces: { strategy: 'private', revalidateSeconds: 5 }
    }
  }
}
```

落地语义：

1. runtime 根据本次 route params 选择 effective loader、metadata 和 cache；只要声明了对应 `*ByParam`，本次参数值必须命中分支，未命中直接返回 `MODULE_PAGE_PARAM_BRANCH_NOT_FOUND`，不再回退到顶层 `loader`、`metadata`、`cache`。
2. resolved page 同时保留原始 `route` 和本次 `effectiveRoute`，避免契约和执行态混在一起。
3. `resolvePageRouteMetadata` 也使用 `metadataByParam`，不得为了 metadata-only 路径执行 page loader。
4. dashboard RSC 缓存策略读取 `effectiveRoute.cache`；现有 cache key 已包含 pathname，不同 section 不共享缓存槽。
5. `module:doctor` 只把未声明 `loaderByParam` 的动态 dashboard broad loader 作为迁移提醒；它不再是主修复路径。

### 6.2 validator 和验收

需要修改：

- `src/module-sdk/types.ts`
- `src/module-sdk/validator-routes.ts`
- `scripts/generate-module-map.mjs`
- `src/lib/module-runtime/adapters/page-route.ts`
- `docs/llm/contract.generated.md`

`src/lib/module-runtime/packaging/module-bundle.ts` 当前按 module map entry 统计 `loaders/`，而 module map 已扫描 loader 目录全部文件，因此不需要为 `loaderByParam` 额外收集 entry。

验收标准：

- `loaderByParam`、`metadataByParam`、`cacheByParam` 的参数名必须存在于 route path。
- 每个分发表只能选择一个 route 参数，避免多维分发导致 cache 和 evidence 难以解释。
- loader/metadata 分支必须是模块内路径。
- cache 分支复用 route cache 校验。
- public site route 可以用 `metadataByParam` / `cacheByParam` 满足 SEO 和 cache 声明，但任何 public 分支都不能使用 private cache。
- host runtime 测试必须证明未声明的 section 不会静默回退到 broad loader。
- host runtime 测试必须证明同一动态 route 下不同 section 会命中不同 loader、metadata 和 cache。

## 7. 宿主 P1：给模块导航提供强约束

现有宿主 click interception 能处理很多普通 `<a>`，但它更像兜底机制。宿主应该让模块作者更明确地使用 host navigation。

建议：

1. 在 module SDK 暴露 `HostLink` 或 `useHostNavigate` 的约定，至少在 dashboard module page props 里提供稳定导航函数。
2. 在 dev 模式下，如果 dashboard app frame 内发生同 area document navigation，输出可定位 warning。
3. transition smoke 的 `--inject-anchor` 继续保留，确保普通 anchor 也被宿主兜底拦截。
4. 对模块声明的 `navigation` item 和 `quality.performance.dashboardTransitions.routes` 做一致性检查：高频 route 没有导航入口时给 warning。

涉及文件：

- `apps/host-next/components/layout/ClientTransitionLinks.tsx`
- `apps/host-next/lib/client-transition-links.ts`
- `src/lib/module-runtime/ui/page-renderer.ts`
- `src/module-sdk/types.ts`
- `scripts/host-dashboard-transition-smoke.mjs`

## 8. 宿主 P2：module page/API 性能门禁

Origin AgentOps 的 `traces/audit` 慢接口说明，仅测页面 transition 不够。宿主还需要模块 API 预算。

已新增 `scripts/module-page-performance-smoke.mjs`：

- 从 `quality.performance.pageRoutes` 读取 dashboard 目标页面。
- 通过 concrete `samplePath` 或 `params` 打开 dashboard 页面。
- 从 dashboard timing side channel 读取 `module-loader`、`loaderDataBytes`。
- 输出 `.runtime/module-page-performance/latest.json`。
- 接入 `npm run module:quality` 和 release gate。

已新增 `scripts/module-api-performance-smoke.mjs`：

- 从 `quality.performance.apiRoutes` 读取 safe GET/HEAD 目标 API。
- 通过 `auth: 'admin' | 'anonymous'` 显式选择采样身份。
- 记录 status、duration、response bytes、`Server-Timing`。
- 输出 `.runtime/module-api-performance/latest.json`。
- 接入 `npm run module:quality` 和 release gate。

验收指标建议：

| API 类型 | 默认预算 |
| --- | ---: |
| dashboard 列表 API | P95 `< 800ms`，响应 `< 150KB` |
| dashboard 详情 API | P95 `< 1200ms`，响应 `< 250KB` |
| action 后 revalidate API | P95 `< 500ms`，响应 `< 50KB` |

模块可以声明例外，但例外必须有到期时间或 issue 链接，避免永久放宽。

## 9. 推荐实施顺序

### 第 1 天到第 2 天：观测闭环

1. dashboard page 和 module API 复用现有 `x-request-id`。
2. module API 输出 `Server-Timing`、module id、route path、response bytes。
3. dashboard timing 写入短 TTL side channel。
4. transition smoke 读取并保存 dashboard timing。

产出：能回答“这次 RSC 3 秒里，宿主 shell 用了多少，模块 loader 用了多少，loaderData 有多大”。

### 第 3 天到第 4 天：门禁闭环

1. `host-dashboard-transition-smoke` 支持显式 `--routes`、模块 navigation concrete href 和模块声明 routes。
2. 默认启用 RSC transfer budget。
3. release gate 校验 `transition:rsc-transfer`。
4. 对 Origin AgentOps 跑一份独立 evidence。

产出：以后模块切页退化成 document navigation、hydration error、RSC 过大都会在 CI 暴露。

### 第 5 天到第 7 天：契约和 doctor

1. 扩展 `quality.performance`。
2. 在 `ModulePageRoute` 落地 `loaderByParam`、`metadataByParam`、`cacheByParam`。
3. runtime resolver、metadata-only resolver 和 dashboard cache 使用 effective route。
4. `module:doctor` 仅保留未迁移动态 route + 全量 loader 的迁移提醒。
5. `module:quality` 接入 dashboard transition、page performance 和 API performance evidence。
6. 文档生成同步更新。

产出：模块作者能在 `module.ts` 里看到并声明性能边界；复杂 dashboard 产品可以使用“轻 shell + section data”模型，不再靠拆静态 route 或全量 loader 兜底。

## 10. 宿主验收标准

| 验收项 | 目标 |
| --- | ---: |
| dashboard timing evidence | 每次 required smoke 都包含 route-resolve、module-loader、shell-data、loaderDataBytes |
| module API `Server-Timing` | 覆盖 `/api/modules/*` |
| module transition routes | 可从显式 `--routes`、模块 navigation concrete href 或 `module.ts quality.performance` 获取 |
| document navigation | dashboard transition 中为 0 |
| hydration error | dashboard transition 中为 0 |
| RSC transfer budget | required smoke 默认启用，超预算失败 |
| release gate | 校验 transition P95、RSC transfer、document navigation、hydration |
| module page budget | 能对声明的页面验 loader duration 和 loaderData bytes |
| module API budget | 能对声明的 API 验 duration 和 bytes |
| doctor warning | 动态 dashboard route 共用疑似全量 loader 时提示 |

## 11. 对 Origin AgentOps 的宿主侧命令建议

优先使用模块级 smoke，让脚本读取 `quality.performance.dashboardTransitions`、navigation 和 product pages：

```bash
npm run host:dashboard-transition-smoke -- --required --repeat 3 --inject-anchor --module-id origin-agentops
```

需要精确复现某组路由时，也可以显式传入 concrete routes：

```bash
npm run host:dashboard-transition-smoke -- --required --repeat 3 --inject-anchor --max-document-navigations 0 --max-p95-ms 1500 --max-rsc-transfer-bytes 100000 --routes /zh/dashboard/origin-agentops/agents,/zh/dashboard/origin-agentops/skills,/zh/dashboard/origin-agentops/tools,/zh/dashboard/origin-agentops/runtime,/zh/dashboard/origin-agentops/traces
```

这些命令用于把 document navigation、hydration、transition P95、RSC 体积和 dashboard timing 变成可复现证据。

## 12. 宿主整改口径

对团队沟通时建议这样拆：

- PloyKit 宿主当前要补的架构能力：性能预算和观测能力、section loader 契约、模块真实路由 transition smoke、module API 性能门禁。
- 宿主整改目标：让 dashboard RSC、module loader、loaderData、module API payload 都有可采集指标和必过预算。
- 验收口径：document navigation、hydration error、RSC transfer、transition P95、loaderData bytes、API bytes 任一超标都能在宿主 evidence 或 release gate 中暴露。

这样改完后，宿主会成为性能边界的守门人：任何模块只要把过重数据塞进切页路径，都会被 timing、payload budget 和 release gate 及时拦下来。
