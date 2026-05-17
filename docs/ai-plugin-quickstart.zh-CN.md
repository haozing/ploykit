# AI 插件开发 Quickstart

这个 quickstart 给 AI 编码代理一份完整的 PloyKit 插件任务形态。

## 任务提示词

```text
你正在开发一个 PloyKit 插件。

目标：
- 构建一个私有 dashboard 工具 Invoice Helper。
- 它接收 invoice 文本，提取 vendor、invoice number、date、subtotal、tax
  和 total，保存每次提取，并返回规范化 JSON。

插件：
- id: invoice-helper
- template: tool
- directory: plugins/invoice-helper

合同：
- page: /，dashboard layout，需要登录
- API: POST /run，需要登录
- storage collection: invoice_extractions
- capabilities: storage read/write、audit write、usage write
- 不需要外部 HTTP
- tests: contract、API extraction、storage write、audit、usage、page import smoke

规则：
- 只在 plugins/invoice-helper 内工作。
- 先更新 plugin.ts。
- 使用 @ploykit/plugin-sdk 导出。
- 通过 ctx.* capability 使用宿主能力。
- 不导入 src/lib/*，不读取 process.env，不直接访问数据库，不使用原始外部 fetch()。
- 需要 npm UI/运行时包时，声明 plugin.dependencies.json，并确认宿主 package.json 运行时依赖同步声明。
- 根据 ctx capability 使用补齐 permissions。
- 使用 @ploykit/plugin-sdk/testing 添加插件测试。
- 修改后运行 npm run plugin:doctor -- plugins/invoice-helper。
```

## 预期命令

```bash
npm run plugin:create -- invoice-helper --template tool
npm run plugin:doctor -- plugins/invoice-helper
npm run plugins:scan
```

## 预期文件

```text
plugins/invoice-helper/
|-- plugin.ts
|-- pages/
|   `-- ToolPage.tsx
|-- api/
|   `-- run.ts
|-- tests/
|   `-- plugin.test.ts
|-- README.md
`-- AI_TASK.md
```

如果这个插件需要额外 npm UI/运行时包，再添加 `plugin.dependencies.json`。

## 验收标准

- `plugin.ts` 声明 storage collection、page、API、menu 和 permissions。
- API 用 `z` 校验请求输入。
- API 用 `ctx.storage` 保存规范化提取结果。
- API 记录 audit 和 usage。
- 测试使用 fake host，并检查 storage、audit、usage 和响应结构。
- `npm run plugin:doctor -- plugins/invoice-helper` 返回 `success: true`。

## 修复提示词

如果 `plugin:doctor` 失败，把 JSON 反馈给 agent：

```text
plugin doctor 命令失败。

使用第一个 severity 为 "error" 的诊断。
除非修复必须同步更新合同，否则只修改诊断指定的 file/path。
然后重新运行 npm run plugin:doctor -- plugins/invoice-helper。

Diagnostic JSON:
<把 JSON 粘贴到这里>
```
