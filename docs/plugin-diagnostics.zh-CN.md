# 插件诊断参考

插件诊断是面向机器可读修复设计的。AI agent 应读取 `code`、`file`、`path`、`message` 和 `fix`，修复后重新运行 `npm run plugin:doctor -- plugins/<plugin-id>`。

## 修复循环

1. 先修第一个 `severity: "error"` 诊断。
2. 优先依据诊断里的 `path` 定位，不要大范围猜测。
3. 有 `fix` 时优先应用 `fix`。
4. 重新运行 `npm run plugin:doctor -- plugins/<plugin-id>`。
5. 重复直到 `success: true`。

## 常见诊断族

| 类型                 | 示例                                                                                                                                                   | 含义                                                      | 常见修复                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 身份                 | `PLUGIN_ID_INVALID`、`PLUGIN_ID_MISMATCH`、`PLUGIN_VERSION_INVALID`                                                                                    | 插件身份不符合合同规则或目录名。                          | 使用小写中划线 id，让 id 匹配目录名，并使用 semver。                                       |
| 合同形态             | `PLUGIN_NAME_REQUIRED`、`PLUGIN_KIND_INVALID`、`PLUGIN_TRUST_LEVEL_INVALID`                                                                            | `plugin.ts` 声明无效。                                    | 使用 `@ploykit/plugin-sdk` 支持的值。                                                      |
| 路径                 | `PLUGIN_MODULE_PATH_INVALID`、`PLUGIN_MODULE_PATH_ESCAPES_ROOT`、`PLUGIN_PATH_NOT_ABSOLUTE`、`PLUGIN_ROUTE_PATH_NOT_LOCAL`                             | route、handler、page、asset 或 module path 不合法。       | 模块路径使用插件本地 `./`，route path 使用 `/` 或 `/items` 这类本地路径。                  |
| 路由                 | `PLUGIN_ROUTE_DUPLICATE`、`PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT`、`PLUGIN_RUNTIME_API_ROUTE_CONFLICT`、`PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT`           | 路由重复或互相覆盖。                                      | 重命名路由，或让动态段更明确。                                                             |
| Public APIs          | `PLUGIN_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED`、`PLUGIN_ANONYMOUS_RATE_LIMIT_INVALID`、`PLUGIN_ANONYMOUS_CAPTCHA_INVALID`                               | public route 缺少匿名策略或策略字段无效。                 | 添加包含限流、captcha、上传和高成本动作设置的 `anonymousPolicy`。                          |
| SEO/tool routes      | `PLUGIN_TOOL_SEO_REQUIRED`、`PLUGIN_TOOL_SEO_TITLE_REQUIRED`、`PLUGIN_TOOL_SEO_DESCRIPTION_REQUIRED`、`PLUGIN_TOOL_SEO_CANONICAL_REQUIRED`             | 公开工具页 metadata 不完整。                              | 添加 title、description、canonical、robots、sitemap 和 cache metadata。                    |
| 权限                 | `PLUGIN_PERMISSION_UNKNOWN`、`PLUGIN_ROUTE_PERMISSION_UNDECLARED`、`PLUGIN_CAPABILITY_PERMISSION_MISSING`、`PLUGIN_PERMISSION_UNUSED`                  | 声明权限与 capability 使用不匹配。                        | 在 `plugin.ts` 添加或移除 `Permission.*`。                                                 |
| 导入                 | `PLUGIN_IMPORT_FORBIDDEN`、`PLUGIN_IMPORT_EXTERNAL_UNDECLARED`、`PLUGIN_NODE_IMPORT_FORBIDDEN`、`PLUGIN_IMPORT_NOT_FOUND`                              | 插件导入宿主内部、未声明外部包、Node builtin 或缺失文件。 | 使用 SDK、本地文件、React，或在 `plugin.dependencies.json` 声明允许外部依赖。              |
| 外部 npm 依赖        | `PLUGIN_DEPENDENCY_MANIFEST_INVALID`、`PLUGIN_DEPENDENCY_NOT_INSTALLED`、`PLUGIN_DEPENDENCY_NOT_DECLARED_BY_HOST`                                      | 插件依赖清单无效，或依赖没有作为宿主运行时依赖安装。      | 修复 `plugin.dependencies.json`；把依赖加入宿主根 `package.json` 的运行时依赖并安装。      |
| 环境与危险代码       | `PLUGIN_PROCESS_ENV_FORBIDDEN`、`PLUGIN_EVAL_FORBIDDEN`、`PLUGIN_FUNCTION_FORBIDDEN`                                                                   | 插件绕过宿主边界或执行动态代码。                          | 使用 `ctx.config`、`ctx.secrets` 和显式 handler。                                          |
| 外部 HTTP            | `PLUGIN_EXTERNAL_FETCH_FORBIDDEN`、`PLUGIN_EGRESS_REQUIRED_FOR_HTTP`、`PLUGIN_EGRESS_ORIGIN_MISSING`、`PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED`           | 插件没有通过宿主 egress 边界访问外网。                    | 使用 `ctx.http.fetch(...)`，添加 `Permission.ExternalHttp`，并声明窄范围 `egress` origin。 |
| 数据集合             | `PLUGIN_COLLECTION_NAME_INVALID`、`PLUGIN_COLLECTION_FIELDS_REQUIRED`、`PLUGIN_COLLECTION_FIELD_TYPE_INVALID`、`PLUGIN_COLLECTION_INDEX_FIELD_UNKNOWN` | 结构化 storage 声明无效。                                 | 使用小写 collection/field 名和支持的字段类型。                                             |
| 资产                 | `PLUGIN_ASSET_PATH_INVALID`、`PLUGIN_ASSET_FILE_NOT_FOUND`、`PLUGIN_ASSET_SIZE_EXCEEDED`、`PLUGIN_ASSET_WORKER_DECLARATION_REQUIRED`                   | 插件资产不在 `assets/`、缺失、过大或需要显式 kind。       | 把资产放到 `assets/`，worker/wasm 显式声明 kind。                                          |
| Jobs/events/webhooks | `PLUGIN_JOB_PERMISSION_MISSING`、`PLUGIN_EVENT_EMIT_PERMISSION_MISSING`、`PLUGIN_WEBHOOK_PERMISSION_MISSING`、`PLUGIN_*_HANDLER_NOT_FOUND`             | 运行时声明缺权限或 handler 文件。                         | 添加对应权限并创建声明的 handler 文件。                                                    |
| Menus/slots/theme    | `PLUGIN_MENU_ROUTE_UNKNOWN`、`PLUGIN_SLOT_NAME_INVALID`、`PLUGIN_THEME_TOKEN_UNKNOWN`                                                                  | UI 扩展声明指向未知 route、slot 或 theme token。          | 使用已声明 page route、合法 slot name 和支持的 theme token section。                       |
| 商业化/meters        | `PLUGIN_METER_NAMESPACE_INVALID`、`PLUGIN_METER_UNIT_INVALID`、`PLUGIN_ROUTE_LICENSE_INVALID`、`PLUGIN_ROUTE_PLAN_INVALID`                             | 计量或商业路由 metadata 无效。                            | meter 用 `<plugin-id>.` 命名空间，声明 unit，商业 metadata 保持非空。                      |

## Agent 注意事项

- 先修 error，再清 warning。
- `PLUGIN_PERMISSION_UNUSED` 通常可以移除权限，除非它是为动态路径保留。
- `PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED` 表示静态分析无法证明 URL，保持 `egress` 窄范围并增加运行时测试。
- `PLUGIN_IMPORT_EXTERNAL_UNDECLARED` 可以通过避免依赖或在 `plugin.dependencies.json` 声明解决；声明后仍要求宿主把包放在根 `package.json` 的 `dependencies` 或 `optionalDependencies` 中。
- `PLUGIN_DEPENDENCY_NOT_DECLARED_BY_HOST` 说明包可能只是 dev/transitive 依赖。插件运行时不能依赖这种偶然可解析状态。
- `PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED` 通常说明用了 `ctx[someKey]`。优先改成静态的 `ctx.storage`、`ctx.files` 等访问。
