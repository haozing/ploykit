# 开源多媒体资源设计

这份计划定义 PloyKit 公开开源发布时应该提供和维护的多媒体资源。目标是在用户第一次打开仓库的一分钟内讲清楚项目，而不是把仓库首页做成营销站。

## 当前状态

- `public/brand/` 已经包含项目 logo、mark、favicon 来源、Apple touch icon 和默认 OG 图。
- `public/media/` 已经包含 README/docs 截图、社交预览图和短插件开发演示。
- 应用仍然保留动态 `/opengraph-image` 路由。公开 release 分享时，可以把已提交的
  `public/brand/og-default.png` 作为稳定兜底图。

## 原则

- 优先使用真实产品截图，而不是抽象插画。
- 展示插件模型，不只展示后台外壳。
- 根 README 保持克制：一个主预览图加一个短图库就够。
- 详细资源清单和截图流程放在 docs。
- 不包含敏感本地用户数据、真实密钥、私有 URL、Stripe 客户数据或生产日志。
- 控制二进制资源大小，避免明显增加 clone 体积。

## 推荐目录结构

```text
public/
|-- brand/
|   |-- ploykit-logo.svg
|   |-- ploykit-mark.svg
|   |-- favicon.svg
|   |-- apple-touch-icon.png
|   `-- og-default.png
`-- media/
    |-- screenshots/
    |   |-- dashboard-admin.png
    |   |-- plugin-dev-console.png
    |   |-- plugin-management.png
    |   |-- public-json-tool.png
    |   |-- plugin-runtime-sample.png
    |   `-- ai-plugin-workflow.png
    |-- social/
    |   |-- github-preview.png
    |   `-- docs-preview.png
    `-- demo/
        |-- plugin-create-doctor-loop.gif
        `-- plugin-create-doctor-loop.mp4
```

`public/media/...` 只放 README、docs 或公开页面会引用的资产。通过插件运行时加载的资源，放在插件自己的 `plugins/<plugin-id>/assets/` 下。

## 首发资源包

这些资源足够支撑一次清晰的开源首发。

| 优先级 | 资源                 | 路径                                                 | 格式         | 用途                                                       |
| ------ | -------------------- | ---------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| P0     | Logo mark            | `public/brand/ploykit-mark.svg`                      | SVG          | README、docs、favicon 来源和社交模板的小图标。             |
| P0     | 横向 logo            | `public/brand/ploykit-logo.svg`                      | SVG          | README 和 docs 的项目识别。                                |
| P0     | 默认 OG 图           | `public/brand/og-default.png`                        | PNG 1200x630 | 稳定社交预览图和 release 分享图。                          |
| P0     | 管理后台截图         | `public/media/screenshots/dashboard-admin.png`       | PNG/WebP     | 展示宿主运维价值：状态、认证、运行时和插件。               |
| P0     | 插件开发控制台截图   | `public/media/screenshots/plugin-dev-console.png`    | PNG/WebP     | 展示诊断能力和面向 agent 的插件开发体验。                  |
| P0     | 公开 JSON 工具页截图 | `public/media/screenshots/public-json-tool.png`      | PNG/WebP     | 展示公开工具路由、SEO 插件页和 alias 模型。                |
| P0     | AI 插件工作流图      | `public/media/screenshots/ai-plugin-workflow.png`    | PNG/WebP     | 视觉化展示 `plugin.ts -> plugin:doctor -> tests -> scan`。 |
| P1     | 插件管理截图         | `public/media/screenshots/plugin-management.png`     | PNG/WebP     | 展示安装、启用、禁用生命周期。                             |
| P1     | 示例插件运行时截图   | `public/media/screenshots/plugin-runtime-sample.png` | PNG/WebP     | 展示由运行时挂载出来的 dashboard 插件页面。                |
| P1     | 短终端演示           | `public/media/demo/plugin-create-doctor-loop.gif`    | GIF 或 MP4   | 30 秒内展示创建插件和 doctor 修复闭环。                    |
| P2     | GitHub 社交预览      | `public/media/social/github-preview.png`             | PNG 1280x640 | 仓库 social card。                                         |
| P2     | 文档预览图           | `public/media/social/docs-preview.png`               | PNG 1200x630 | 文档索引预览。                                             |

## 截图场景

只使用本地 fixture 数据。现有 seed admin 用户可以出现在截图中，但 README 继续明确它只是本地 fixture。

| 截图                | 路由                                  | 展示状态                                                    |
| ------------------- | ------------------------------------- | ----------------------------------------------------------- |
| 管理后台            | `/en/admin`                           | System Status 卡片可见：Database、Runtime Reconcile、Auth。 |
| 插件开发控制台      | `/en/admin/plugins/dev`               | Runtime Reconcile、复制诊断按钮、插件摘要卡片。             |
| 插件管理            | `/en/admin/plugins`                   | Sample Internal 卡片和生命周期操作。                        |
| 公开 JSON 工具      | `/en/json` 或 `/en/tools/json-format` | JSON 输入、route contract 面板和公开插件页外壳。            |
| 示例插件运行时      | `/en/plugins/sample-internal`         | Notes 区域和插件挂载的 dashboard 页面。                     |
| AI 插件工作流视觉图 | 静态合成图                            | 合同、本地文件、doctor JSON、fake host tests。              |

推荐视口：

- README 桌面截图：`1440x960`
- docs 紧凑截图：`1280x720`
- docs 移动端校验截图：`390x844`

## README 放置方式

根 README 保持简洁：

1. 开头描述后放一张主图：`public/media/social/github-preview.png` 或
   `public/brand/og-default.png`。
2. Highlights 后放四图图库：管理后台、插件开发控制台、公开工具页、AI 工作流。
3. 详细截图流程留在本文档。

不要在根 README 放很长的动图。可以从 docs 链接到 MP4/GIF。

## 品牌资源

项目需要一套简单、可检查的矢量识别：

- `ploykit-mark.svg`：紧凑方形标记，用于 favicon 和社交图。
- `ploykit-logo.svg`：标记加字标。
- `favicon.svg`：可以复用 mark。
- `apple-touch-icon.png`：180x180 栅格导出。
- `og-default.png`：1200x630，项目名加一个简洁 UI 预览动机。

建议视觉方向：

- 工作型 SaaS/工具平台气质。
- 高对比、克制配色，不做单一紫蓝渐变。
- 动机可以是插件节点连接到宿主外壳，并带一点 `plugin.ts` 或 `ctx.*` 信号。
- 避免抽象光斑、库存图片和不能说明产品的装饰插画。

## 演示视频或 GIF

首发只需要一个短演示。

场景：

1. 运行 `npm run plugin:create -- invoice-helper --template tool`。
2. 打开 `plugins/invoice-helper/plugin.ts`。
3. 运行 `npm run plugin:doctor -- plugins/invoice-helper`。
4. 展示 JSON success，或展示一个诊断并修复。
5. 运行 `npm run plugins:scan`。

控制在 30 秒以内。docs 优先使用 MP4，GitHub 可补一个小体积 GIF。

## 自动化建议

生成首发资源：

```bash
npm run media:generate
```

脚本会把品牌资源、社交预览、AI 工作流图、短终端演示和产品截图写入
`public/brand/` 与 `public/media/`。当本地应用可以通过 `NEXT_PUBLIC_APP_URL`
或 `PLOYKIT_MEDIA_BASE_URL` 访问时，它会抓取真实产品页面。

截图流程：

- 使用本地 seed 数据库。
- 用本地 fixture admin 登录。
- 把截图写入 `public/media/screenshots/`。
- 如果截图空白或缺少预期 heading，则失败。

需要时可设置这些覆盖项：

```bash
PLOYKIT_MEDIA_BASE_URL=http://localhost:3000 npm run media:generate
PLOYKIT_MEDIA_ADMIN_EMAIL=admin@example.com PLOYKIT_MEDIA_ADMIN_PASSWORD=Admin@123456 npm run media:generate
```

## 首发不建议添加

- 很长的完整产品 walkthrough 视频。
- 库存 hero 图。
- 深色、模糊、氛围化的产品 mockup。
- 带生产数据、非 fixture 邮箱、真实 Stripe 标识、真实 webhook payload 或私有基础设施 URL 的截图。
- 大量相似后台页面截图。资源集要解释产品，而不是盘点每个页面。

## 发布清单补充

公开发布前：

- 保持 `public/` 中不再出现 Next.js 默认资产。
- 重新生成并检查 P0 首发资源包。
- 验证 README/docs 中每个图片链接。
- 确认社交预览图在 GitHub 和包页面能正常渲染。
- 如果使用本地化截图，检查中英文文档中的截图文字。
