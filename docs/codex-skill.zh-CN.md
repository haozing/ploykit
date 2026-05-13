# PloyKit 插件 Codex Skill

PloyKit 随仓库提供一个可选 Codex Skill：
[`skills/ploykit-plugin-developer`](../skills/ploykit-plugin-developer)。它把插件开发约定沉淀成可复用的 AI 工作流，可以随 Codex 一起安装使用。

## 覆盖内容

- 选择合适的插件模板。
- 先修改 `plugin.ts`，再实现页面、API、job、event、webhook。
- 默认只在 `plugins/<plugin-id>/` 内工作。
- 根据 `ctx.*` capability 使用补齐 `Permission.*` 声明。
- 使用 `@ploykit/plugin-sdk/testing` 添加 fake-host 测试。
- 通过 `npm run plugin:doctor -- plugins/<plugin-id>` 诊断、修复、重跑。
- 复用面向 AI agent 的插件开发提示词结构。

## 本地安装

把 skill 目录复制到 Codex skills 目录：

```bash
mkdir -p ~/.codex/skills
cp -R skills/ploykit-plugin-developer ~/.codex/skills/
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills"
Copy-Item -Recurse -Force "skills\ploykit-plugin-developer" "$env:USERPROFILE\.codex\skills\"
```

然后开启新的 Codex 会话并显式调用：

```text
Use $ploykit-plugin-developer to build a PloyKit plugin named invoice-helper.
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
```

`SKILL.md` 只保留紧凑工作流。详细合同、能力、诊断和提示词模板放在 `references/` 中按需加载，避免一上来挤满上下文。
