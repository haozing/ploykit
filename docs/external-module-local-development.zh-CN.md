# 外部模块本地开发

PloyKit 支持从仓库外加载可信本地模块，但外部模块路径属于开发者本机环境，不应提交到通用宿主配置。

## 推荐流程

1. 保持 `ploykit.config.json` 只包含宿主仓库内的默认模块源。
2. 在本地创建被 `.gitignore` 忽略的配置文件，例如 `ploykit.local.config.json`。
3. 通过 `PLOYKIT_CONFIG=ploykit.local.config.json` 运行扫描、检查和开发服务器。

示例：

```json
{
  "moduleSources": [
    {
      "id": "workspace",
      "path": "modules"
    },
    {
      "id": "external-dev",
      "path": "../your-module-repo/modules/your-module"
    }
  ],
  "trustedModuleRoots": [".", "../your-module-repo"]
}
```

PowerShell 示例：

```powershell
$env:PLOYKIT_CONFIG = "ploykit.local.config.json"
npm run modules:scan
npm run modules:check
npm run host:dev
```

## 提交前清理

提交宿主代码前，应切回默认配置重新生成 module map：

```powershell
Remove-Item Env:PLOYKIT_CONFIG -ErrorAction SilentlyContinue
npm run modules:scan
npm run host:boundary-check
```

宿主提交中不应出现具体外部模块路径，例如 `../some-product/modules/<id>`、`/dashboard/<id>`、`module:<id>` 或具体模块 ID 的专属脚本。需要宿主配合时，先补通用 registry、manifest、catalog 或 contribution seam，再由模块声明贡献。
