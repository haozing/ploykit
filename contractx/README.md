# contractx — 合同工具包（只做工具，不做流程）

定位：**框架卖工具不卖流程**。本包提供确定性哈希、manifest 生成与目录↔路由↔OpenAPI
比对器；**明确不进**：审批工作流、Phase0 编排、具名审批——组织纪律留各产品仓库。

与 `authorization/`（强授权档）的关系：**相互独立，互不 import**。contractx 只消费中性的
"条目集"（`Entry{ID, Attributes}`）抽象，不认识任何授权词汇；authorization/ 的操作目录
想要 manifest 或路由比对时，把自己投影成 `[]Entry` 或 `[]RouteSpec` 即可（方向是
authorization → contractx 的调用关系，但当前两包零编译依赖，各自可独立单测）。

## 包结构

| 文件 | 内容 |
|---|---|
| `hash.go` | `HashJSON`（encoding/json 规范化序列化 → SHA-256 → 小写 hex） |
| `manifest.go` | `Entry`/`ManifestInput`/`Manifest`、`BuildManifest`、`HashEntries`、`Render`/`ParseManifest`（严格解码，拒绝未知字段） |
| `routes.go` | `RouteSpec`/`Side`、`EntryRoutes`（条目 → 路由投影） |
| `compare.go` | `Compare(sides ...Side) (Report, error)` 与五种结构化 `Diff` |
| `openapi.go` | `ParseOpenAPIRoutes`（YAML/JSON 双格式 → `[]RouteSpec`） |

依赖：标准库 + `go.yaml.in/yaml/v3`（已列 go.mod 直接依赖）。

## 1. 确定性哈希与 manifest

输入：`[]Entry`（条目集）+ `ManifestInput`（策略版本、所需能力集，可选：绑定属性、
外部哈希、具名策略版本）。输出：`Manifest`，`Render()` 为字节稳定的两空格缩进 JSON。

**哈希算法**：

1. 规范化：条目按 ID 排序；每个属性值排序；属性键由 encoding/json 排序输出；
   空集与缺失等价（丢弃）；严格校验（空白/重复即报错）。
2. `entries_hash` = SHA-256(规范化条目数组的 JSON)
3. `entry_set_hash` = SHA-256(排序后 ID 数组的 JSON)
4. `attribute_binding_hashes[name]` = SHA-256(`[{id, values}]` 按 id 排序)
   （对外契约指纹的泛化形态）
5. `required_capabilities` 排序去重后入 manifest；外部哈希必须是 64 位小写 hex。

同输入必同哈希；条目顺序、属性值顺序、map 插入顺序均不影响结果（有测试钉死）。



**typed catalog 的哈希复现路径**：产品若保留强类型目录结构（如某产品的
`authorization.Catalog`），把**自己规范化后的结构体**交给 `contractx.HashJSON` 即可得到
与其现有 manifest 完全一致的哈希（相同 JSON 字节 → 相同摘要）。换言之：字段名不同则
哈希必然不同（这是内容寻址的本意）；要哈希相等就走 `HashJSON` 复用，要中立建模就走
`Entry`。两条路径的哈希一致性都可由同一摘要算法保证。

## 2. 三方比对器

```go
report, err := contractx.Compare(
    contractx.Side{Name: "catalog", Routes: catalogRoutes},   // EntryRoutes(entries) 产出
    contractx.Side{Name: "routes",  Routes: goRoutes},        // Go 路由表清单（输入形态自定）
    contractx.Side{Name: "openapi", Routes: openapiRoutes},   // ParseOpenAPIRoutes(doc) 产出
)
if !report.Empty() { /* report.Diffs / report.String() */ }
```

- 比对是 **N 方**的（≥2 即可，两方就是 check_api.py 的形态，三方是标准用法）。
- 路径**字面精确匹配**（含 `{param}` 名——参数命名漂移算漂移，与 check_api.py 同口径）；
  方法大小写不敏感（归一为大写）。
- 输出是**结构化差异清单**，不是布尔。五种 `DiffKind`：

| DiffKind | 含义 |
|---|---|
| `missing` | 某 `(method, path)` 在部分侧存在、部分侧缺失（`PresentIn`/`MissingIn` 列出两侧名单） |
| `duplicate` | 同一 `(method, path)` 在**同一侧**声明两次（如两个目录操作占同一路由） |
| `method-mismatch` | 同一路径各侧方法集不同（一 diff 汇总每侧方法集，如 catalog=DELETE,GET openapi=GET,POST） |
| `param-name-mismatch` | 方法与路径骨架一致但参数名拼写不同（`/t/{taskId}` vs `/t/{id}`，`Paths` 列各侧字面量） |
| `operation-id-mismatch` | 路由各方都有，但声明了 operationId 的侧之间 ID 不一致（无 ID 的侧忽略） |

- 差异按 (kind, path, method) 排序，同输入必同报告（测试钉死）。
- `Diff` 带 JSON tag，门禁工具可机器消费；`Report.String()` 给人读的一行一条。

## 3. 与 tools/check_api.py 的能力边界

**裁定（风险 F4）**：各管一段，不另起炉灶。check_api.py 是 ploykit/example 的
**"收集器 + 门禁"**（仓库特定：扫描路径硬编码为本仓目录布局）；contractx 是中性的
**"哈希 + 比对"引擎**（Go 库，跨仓复用）。两者当前职责不重叠，本包未改动
check_api.py，其现有用法与 CI 门禁完全不受影响。

| 能力 | tools/check_api.py | contractx |
|---|---|---|
| Go 路由收集（ServeMux 注册正则 + StripPrefix 子 mux 归一） | 有（本仓 example 专用，`SCAN_FILES` 硬编码） | **无**（输入 `[]RouteSpec`，收集留各仓——仓库布局是产品语义，不进框架） |
| OpenAPI 解析 | 仅 YAML（PyYAML，缺席退缩进正则） | YAML + JSON |
| 比对对象 | 两方（spec vs 代码） | N 方（典型三方：目录↔路由↔OpenAPI） |
| 比对粒度 | `(method, path)` 集合差 | method+path+operationId；方法漂移/参数名漂移/操作号漂移/重复注册各成一类 |
| 输出 | 文本 + exit code | 结构化 `[]Diff` + 人读 `String()`（exit 语义由调用方包装） |
| 目录哈希 / manifest / 策略版本 / 能力集绑定 | 无 | 有 |
| 形态 | Python 单仓脚本 | Go 库（零第三方新增依赖） |

check_api.py 已覆盖且 contractx **刻意不接管**的：本仓的路由收集与 CI 门禁编排。
check_api.py 未覆盖、contractx 补上的：目录/manifest 层、三方比对、结构化差异分类、
JSON OpenAPI、operationId 维度、作为库被产品仓复用。

**收口路径（推荐顺序）**：

1. **近期（现状）**：双轨并存——check_api.py 守 ploykit/example 的 spec↔路由零漂移门禁
   （零漂移不动）；接入产品直接用 contractx 库生成 manifest、跑三方比对。
2. **中期选项 A（推荐，当本仓想要三方能力时）**：给 contractx 加一个小 cmd
   （读 catalog/routes/openapi 三文件 → 输出 diff JSON + exit code）；check_api.py 薄化为
   "收集路由 → 写 routes 文件 → 调 contractx cmd"，其正则收集器语义原样保留。
3. **中期选项 B**：维持双轨不合并——门禁语义用脚本、库语义用 contractx，按需取用。

本包不做 Go 源码路由扫描的原因：check_api.py 的 `SCAN_FILES`（`*/adapters/http/*.go`、
example main.go、example task 域）正是"仓库布局烧进工具"的样例；把它搬进框架包会让
每个消费者都要改框架代码才能对齐自己的目录结构。收集是产品侧事实，比对才是框架能力。

## 4. 明确不进（护栏）

- 审批工作流、Phase0 编排、具名审批（RL §1.7：组织纪律留产品仓库）；
- Go 源码路由扫描（仓库特定收集，见上）；
- OpenAPI schema 深度校验（ErrorEnvelope/DTO 形状断言等产品专属门禁——语义留产品，
  产品可在 contractx 的 `[]RouteSpec`/`Diff` 之上自建）；
- 对 `authorization/` 的任何编译依赖。

## 测试

`go test ./contractx/... -count=1`：25 个用例全绿，覆盖

- 确定性：同输入两次构建字节一致；条目/属性值顺序无关；空集与缺失等价；
  `HashEntries` 与手写规范化 + `HashJSON` 的独立对账；golden 渲染钉死（`testdata/manifest_golden.json`）；
- 校验：16 个非法输入（空集/空白/重复 ID、属性、能力、坏外部哈希、零版本、幽灵绑定…）；
- 漂移检测：夹具驱动（`testdata/openapi*.yaml|json`）——三方一致→空差异；漂移夹具
  （方法漂移 + OpenAPI 多出路由）→恰好 2 条各自成类；另有缺项/多项/方法/参数名/
  operationId/重复注册的单项用例与 N 方校验用例；
- OpenAPI：YAML 与 JSON 解析等价、非方法键忽略、4 类解析错误。
