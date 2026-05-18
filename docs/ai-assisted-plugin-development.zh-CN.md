# AI 辅助插件开发

PloyKit 的插件模型天然适合 AI 大模型辅助开发。大模型可以只在一个插件目录里工作，修改少量命名清晰的文件，依赖强类型合同，并通过机器可读的检查结果持续收敛，而不需要先理解整个宿主应用。

这里说的不是 `ctx.ai`。`ctx.ai` 是插件在运行时调用宿主模型网关的能力；本文说的是让 AI 工具来编写、修改和维护 PloyKit 插件。

## 为什么适合大模型

代码里已经具备这些 AI 友好的基础：

| 特性            | 代码来源                                                                                | 对大模型的帮助                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 单合同入口      | `plugins/<plugin-id>/plugin.ts`、`src/plugin-sdk/define-plugin.ts`                      | 大模型只需要先改一个权威入口，就能声明路由、数据、权限、资源、job、event、webhook 和 egress。                           |
| 强类型声明      | `src/plugin-sdk/types.ts`、`src/plugin-sdk/context.ts`、`src/plugin-sdk/permissions.ts` | 大模型按显式类型补全结构，不需要靠猜测探索宿主内部实现。                                                                |
| 强诊断          | `src/plugin-sdk/validator.ts`、`src/plugin-sdk/diagnostics.ts`                          | 错误包含 code、path、message，很多还包含 fix，适合大模型循环修复。                                                      |
| 插件本地边界    | `src/lib/plugin-runtime/checks/plugin-check.ts`                                         | 检查会约束导入宿主内部、读取 `process.env`、原始外部 `fetch()`、未声明外部依赖和缺失权限等问题。                        |
| npm 依赖清单    | `plugins/<plugin-id>/plugin.dependencies.json`                                          | 插件需要宿主已安装的 UI/运行时 npm 包时，可以显式声明；诊断会拒绝缺失、dev-only 或传递依赖状态。                        |
| Capability 注入 | `ctx.storage`、`ctx.files`、`ctx.runs`、`ctx.connectors`、`ctx.ai` 等                   | 大模型通过稳定的 `ctx` 能力组合功能，不直接碰数据库、认证、计费、存储等宿主内部。                                       |
| 模板            | `templates/plugins/{tool,crud,dashboard,connector,service}`                             | 大模型可以从已知目录结构起步，只做局部修改。                                                                            |
| Fake host 测试  | `src/plugin-sdk/testing.ts`                                                             | 插件测试可以在不启动完整部署的情况下覆盖 API、storage、audit、usage、files、AI、RAG、runs、connectors、billing 等行为。 |
| JSON CLI 闭环   | `scripts/ploykit-plugin.ts`                                                             | `create`、`check`、`test`、`build`、`inspect`、`dev` 输出结构化结果，方便大模型解析和修复。                             |
| 生成运行时 map  | `scripts/generate-plugin-map.ts`                                                        | 插件合同改完后，宿主可以把声明重新对齐到运行时状态；产品壳可用 `--runtime-only` 只准备 active runtime artifact。        |

一句话描述：

```text
PloyKit 是一个适合大模型开发插件的宿主：产品意图先落成强类型插件合同，平台行为通过 ctx capability 访问，生成代码再通过本地模板和机器可读诊断持续修正。
```

## 推荐的大模型开发闭环

当 AI 编码助手开发插件时，推荐使用这个流程：

0. 先安装并启用仓库自带 skills。

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/* "${CODEX_HOME:-$HOME/.codex}/skills/"
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Get-ChildItem -Path "skills" -Directory | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination "$env:USERPROFILE\.codex\skills" -Recurse -Force
}
```

安装后开启新的 Codex 会话。开发插件时调用 `$ploykit-plugin-developer`；做真实 API、页面截图和多语言验收时调用 `$ploykit-plugin-tester`。

1. 选择最窄模板。

```bash
npm run plugin:create -- invoice-helper --template tool
```

2. 先修改 `plugins/invoice-helper/plugin.ts`。

声明：

- plugin id、name、version、kind、trustLevel
- routes 与 menu
- storage collections
- permissions
- public API 的 `anonymousPolicy`
- 外部 HTTP 的 `egress`
- jobs、events、webhooks、meters、resources、lifecycle 只在需要时声明

3. 在插件目录内实现 handler 和页面。

规则：

- 使用 `@ploykit/plugin-sdk` 和 `@ploykit/plugin-sdk/react`。
- 平台行为通过 `ctx.*` capability 完成。
- 模块路径保持插件本地，例如 `./api/run` 或 `./pages/ToolPage`。
- 不导入 `src/lib/*`。
- 不读取 `process.env`。
- 不用原始外部 `fetch()`。外部 HTTP 使用 `ctx.http.fetch(...)`，并声明 `Permission.ExternalHttp` 与 `egress`。
- 不直接访问数据库。
- 如果需要 npm UI/运行时包，写入 `plugin.dependencies.json`，并确认宿主根 `package.json` 也把它列为运行时依赖。
- 模型 provider、数据库驱动、密钥型外部服务和复杂领域能力优先通过宿主 `ctx.*` capability 暴露，不作为普通插件依赖引入。

4. 添加或更新插件测试。

使用 `@ploykit/plugin-sdk/testing` 的 `createPluginTestHost` 和 `testPlugin`。Fake host 会记录 capability 调用，因此可以在没有真实数据库、计费 provider、AI provider 或外部服务的情况下断言插件行为。

5. 跑紧凑插件闭环。

```bash
npm run plugin:doctor -- plugins/invoice-helper
npm run plugin:check -- plugins/invoice-helper
npm run plugin:test -- plugins/invoice-helper
npm run plugin:inspect -- plugins/invoice-helper
npm run plugin:build -- plugins/invoice-helper
```

6. 合同变化后重新生成宿主 map。

```bash
npm run plugins:scan
```

如果外部产品壳不应触碰宿主提交版 map，配置 `PLOYKIT_PLUGIN_DIRS` 后使用：

```bash
npm run plugins:scan:runtime
```

7. 跨运行时边界时再跑更大的门禁。

```bash
npm run plugins:check
npm run plugins:check:runtime
npm run test:real
npm run verify:runtime
```

## 给 AI Agent 的提示词结构

可以用下面这种提示词要求 AI 工具实现插件：

```text
你正在开发一个 PloyKit 插件。

目标：
- 实现 <功能描述>。

插件：
- id: <小写中划线 id>
- template: <tool|crud|dashboard|connector|service>
- directory: plugins/<id>

合同：
- pages:
- APIs:
- storage collections:
- required host capabilities:
- external origins:
- public/anonymous behavior:
- tests to add:

规则：
- 开始开发前，先安装仓库 skills 目录下的 Codex Skills；开发时使用 $ploykit-plugin-developer，测试验收时使用 $ploykit-plugin-tester。
- 除非明确要求改文档，否则只在 plugins/<id> 下工作。
- 先更新 plugin.ts。
- 使用 @ploykit/plugin-sdk 导出。
- 通过 ctx.* capability 使用宿主能力。
- 不导入 src/lib/*，不读取 process.env，不直接访问数据库，不使用原始外部 fetch()。
- 根据 ctx capability 使用补齐 permissions。
- public API 必须声明 anonymousPolicy。
- ctx.http.fetch 的外部 origin 必须声明 egress。
- 外部 npm 包必须写入 plugin.dependencies.json，并要求宿主 package.json runtime dependencies 同步声明。
- 使用 @ploykit/plugin-sdk/testing 添加插件测试。
- 修改后运行当前插件的 plugin:doctor。如果失败，修复第一个诊断后重跑。
```

## 已补充的 AI Agent 支持

仓库现在已经包含第一批面向 agent 的支持：

- `AGENTS.md`，作为仓库级编码 agent 规则。
- `.github/copilot-instructions.md`，作为 GitHub Copilot 指令。
- `templates/plugins/*` 下的模板级 `AI_TASK.md`。
- `skills/ploykit-plugin-developer`，作为可随开源仓库发布的插件开发 Codex Skill。
- `skills/ploykit-plugin-tester`，作为代码级、真实 API 和浏览器截图三层插件验证 Codex Skill。
- `npm run plugin:doctor -- plugins/<plugin-id>`，作为 check/test/inspect 聚合 JSON 闭环。
- [AI 插件开发 Quickstart](ai-plugin-quickstart.zh-CN.md)。
- [Codex Skill 安装说明](codex-skill.zh-CN.md)。
- [插件诊断参考](plugin-diagnostics.zh-CN.md)。
- [插件能力与权限参考](plugin-capabilities.zh-CN.md)。

## 相关文档

- [AI 插件开发 Quickstart](ai-plugin-quickstart.zh-CN.md)
- [Codex Skill 安装说明](codex-skill.zh-CN.md)
- [插件诊断参考](plugin-diagnostics.zh-CN.md)
- [插件能力与权限参考](plugin-capabilities.zh-CN.md)
