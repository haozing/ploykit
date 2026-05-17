# PloyKit 插件 Codex Skills

PloyKit 随仓库提供可选 Codex Skills，把插件开发、测试和诊断约定沉淀成可复用的 AI 工作流。AI agent 开始插件开发或测试前，建议先把仓库 `skills/` 目录安装到本机 Codex skills 目录。

## 仓库内 Skills

| Skill                                                                   | 用途                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`skills/ploykit-plugin-developer`](../skills/ploykit-plugin-developer) | 创建、修改、审查和调试 PloyKit 插件。                            |
| [`skills/ploykit-plugin-tester`](../skills/ploykit-plugin-tester)       | 按代码级、真实 API、真实页面截图三层验证插件和插件敏感宿主改动。 |

## 开发 Skill 覆盖内容

- 选择合适的插件模板。
- 先修改 `plugin.ts`，再实现页面、API、job、event、webhook。
- 默认只在 `plugins/<plugin-id>/` 内工作。
- 根据 `ctx.*` capability 使用补齐 `Permission.*` 声明。
- 需要 npm UI/运行时包时维护 `plugin.dependencies.json`，并要求宿主根 `package.json` 声明同名运行时依赖。
- 使用 `@ploykit/plugin-sdk/testing` 添加 fake-host 测试。
- 通过 `npm run plugin:doctor -- plugins/<plugin-id>` 诊断、修复、重跑。
- 复用面向 AI agent 的插件开发提示词结构。

## 测试 Skill 覆盖内容

- 先做代码级检查、插件合同检查和 fake-host 测试。
- 再对真实本地服务请求插件 API，覆盖 guest/auth/invalid/disabled 等路径。
- 最后用浏览器打开页面、截图并逐张观察，检查多语言、SEO、菜单、host page slot/override、console/network 错误和布局问题。
- 输出带命令、API、截图路径和 skipped 项的证据报告。

## 本地安装

把仓库 `skills/` 下的所有 skill 复制到 Codex skills 目录：

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

安装后开启新的 Codex 会话并显式调用：

```text
Use $ploykit-plugin-developer to build a PloyKit plugin named invoice-helper.
Use $ploykit-plugin-tester to fully validate plugins/invoice-helper.
```

## Skill 结构

```text
skills/ploykit-plugin-developer/
|-- SKILL.md
|-- agents/
|   `-- openai.yaml
`-- references/
    |-- workflow.md
    |-- plugin-contract.md
    |-- capabilities.md
    |-- diagnostics.md
    `-- prompt-template.md

skills/ploykit-plugin-tester/
|-- SKILL.md
|-- agents/
|   `-- openai.yaml
`-- references/
    |-- code-level.md
    |-- real-api.md
    |-- browser-visual.md
    `-- reporting.md
```

`SKILL.md` 只保留紧凑工作流。详细合同、能力、诊断和提示词模板放在 `references/` 中按需加载，避免一上来挤满上下文。
