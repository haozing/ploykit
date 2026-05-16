# 插件开发

插件位于 `plugins/<plugin-id>/`。合同文件是唯一必需入口，宿主会从合同推导运行时加载。

```text
plugins/<plugin-id>/
|-- plugin.ts
|-- pages/
|-- api/
|-- lifecycle/
|-- jobs/
|-- events/
|-- webhooks/
|-- assets/
`-- tests/
```

## 合同入口

`plugin.ts` 是插件合同。宿主通过 `scripts/generate-plugin-map.ts` 扫描插件合同，写入 `src/lib/plugin-map.ts`，再从生成 map 加载运行时页面、API、jobs、events、webhooks、生命周期 handlers、slots、menus、assets 和 capabilities。

如果插件需要扩展或覆盖宿主自带页面，例如首页、关于页或定价页，见 [宿主页面插槽与覆盖](host-page-overrides.zh-CN.md)。

最小插件：

```ts
import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'sample-tool',
  name: 'Sample Tool',
  version: '0.1.0',
  kind: 'tool',
  trustLevel: 'untrusted',
  permissions: [Permission.AuditWrite, Permission.UsageWrite, Permission.UiToast],
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/ToolPage',
        auth: 'auth',
        layout: 'dashboard',
      },
    ],
    apis: [
      {
        path: '/run',
        handler: './api/run',
        auth: 'auth',
        methods: ['POST'],
      },
    ],
  },
  menu: {
    location: 'dashboard.sidebar',
    label: 'Sample Tool',
    icon: 'WandSparkles',
    path: '/',
    group: 'Tools',
    weight: 50,
  },
});
```

## 公开工具页

公开工具页可以声明 SEO、sitemap、cache、alias、rate limit 和 anonymous policy 元数据：

```ts
export default definePlugin({
  id: 'json-tools',
  name: 'JSON Tools',
  version: '0.1.0',
  kind: 'tool',
  routes: {
    tools: [
      {
        path: '/json-format',
        component: './pages/JsonFormatTool',
        auth: 'public',
        seo: {
          title: 'JSON Formatter',
          description: 'Format JSON in your browser.',
          canonical: '/tools/json-format',
          robots: { index: true, follow: true },
        },
        sitemap: { include: true, changeFrequency: 'weekly', priority: 0.8 },
        cache: { strategy: 'public', maxAgeSeconds: 3600 },
        anonymousPolicy: {
          rateLimit: { bucket: ['ip', 'route'], limit: 60, window: '1m' },
          captcha: 'never',
          allowHighCostActions: false,
        },
      },
    ],
  },
});
```

## API Handler

插件 API handler 使用小写方法名：

```ts
import { defineApi, z } from '@ploykit/plugin-sdk';

const inputSchema = z.object({
  title: z.string().min(1),
});

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(inputSchema);
    await ctx.audit.record('sample-tool.run', input);
    await ctx.usage.increment('sample_tool.runs');
    return ctx.json({ ok: true });
  },
});
```

## 结构化存储

有结构化 storage 的插件在合同里声明 collections，并申请 storage 权限：

```ts
data: {
  collections: {
    sample_items: {
      fields: {
        title: { type: 'string', required: true, maxLength: 160 },
        status: { type: 'string', required: true, enum: ['draft', 'active'] },
        metadata: 'json?',
      },
      indexes: [{ fields: ['status'] }],
    },
  },
}
```

然后通过 `ctx` 访问：

```ts
const items = await ctx.storage.collection('sample_items').findMany({
  orderBy: { title: 'asc' },
  limit: 50,
});
```

超出插件私有记录的数据库形态工作，应由宿主实现 service/repository，插件通过 `ctx.services` 调用；普通插件不直接访问数据库。

## 宿主能力

插件应该把 `ctx` 当作宿主边界。插件不应该导入 `src/lib/*`、读取 `process.env`、直接访问数据库，或用原始 `fetch()` 调用外部服务。

| 能力                                     | 权限                                                     | 用途                                                      |
| ---------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `ctx.storage`                            | `StorageRead`, `StorageWrite`                            | 插件私有结构化集合                                        |
| `ctx.config`, `ctx.secrets`              | `Config*`, `Secrets*`                                    | 插件配置与加密 secrets                                    |
| `ctx.files`                              | `FilesRead`, `FilesWrite`                                | 签名上传/下载与文件元数据                                 |
| `ctx.runs`                               | `RunsRead`, `RunsWrite`                                  | 用户可见或内部长期任务                                    |
| `ctx.connectors`                         | `ConnectorsRead`, `ConnectorsInvoke`, `ConnectorsManage` | 外部服务 profile、credential、retry、redaction、call logs |
| `ctx.services`                           | `ServicesInvoke`                                         | 宿主绑定的内部 API，用于复杂领域或数据库工作              |
| `ctx.workspace`                          | `WorkspaceRead`, `WorkspaceWrite`                        | workspace 创建、成员、角色、邀请                          |
| `ctx.apiKeys`, `ctx.rateLimit`           | `ApiKeys*`, `RateLimitCheck`                             | 插件 API keys 与 scoped rate limits                       |
| `ctx.metering`, `ctx.usage`, `ctx.audit` | `MeteringWrite`, `UsageWrite`, `AuditWrite`              | 用量、action meters、审计轨迹                             |
| `ctx.artifacts`, `ctx.rag`               | `Artifacts*`, `Rag*`                                     | 文本资产、索引、context packs                             |
| `ctx.ai`                                 | `AiGenerate`, `AiEmbed`                                  | 宿主注入的模型网关                                        |
| `ctx.credits`, `ctx.billing`             | `Credits*`, `Billing*`                                   | 商业权益、积分、兑换                                      |
| `ctx.notifications`                      | `NotificationsSend`                                      | 站内通知                                                  |
| `ctx.http.fetch`                         | `ExternalHttp` plus `egress`                             | 经过 SSRF-aware guard 的外部 HTTP                         |

egress 声明示例：

```ts
export default definePlugin({
  id: 'seo-checker',
  name: 'SEO Checker',
  version: '0.1.0',
  permissions: [Permission.ExternalHttp],
  egress: ['https://example.com'],
});

const response = await ctx.http.fetch('https://example.com/', {
  method: 'GET',
});
```

宿主 egress guard 会拒绝 localhost、私有网络、link-local、metadata host、multicast 目标，以及 DNS 解析到这些范围的目标。

## Public API 策略

公开插件 API 必须声明 `anonymousPolicy`。匿名请求默认不能触发高成本工作，除非 route 明确 opt in。

高成本工作包括：

- AI 生成或 embedding
- connector 调用
- 文件上传
- run 创建

示例：

```ts
anonymousPolicy: {
  rateLimit: { bucket: ['ip', 'route'], limit: 10, window: '1m' },
  maxUploadBytes: 5 * 1024 * 1024,
  captcha: 'always',
  allowHighCostActions: true,
}
```

## 工具命令

```bash
npm run plugins:scan
npm run plugins:check
npm run plugins:templates
npm run plugin:create -- my-plugin --template crud
npm run plugin:check -- plugins/my-plugin
npm run plugin:test -- plugins/my-plugin
npm run plugin:build -- plugins/my-plugin
npm run plugin:inspect -- plugins/my-plugin
npm run plugin:dev -- plugins/my-plugin --watch
```
