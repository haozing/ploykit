# API 使用约定与陷阱（产品对接必读）

> 面向 API 消费方（脚本/集成/前端）的成文约定，来自真实产品接入实录（risk-engine-server W1–W8、aiblog）中被绊过的地方。框架内部机制见 docs/architecture.md 与 docs/platform-api-index.md。

## CSRF 生命周期（最容易踩的坑）

CSRF 令牌**与会话绑定，会话建立时轮换**：

```
GET  /config                     → csrf_token = T0（匿名令牌）
POST /auth/send-code    (T0)     → 200
POST /auth/verify-code  (T0)     → 200 —— 会话在此建立，csrf_token 轮换为 T1
POST /api/anything      (T0)     → 403 E_FORBIDDEN "CSRF token missing or invalid"
POST /api/anything      (T1)     → 200
```

**会话建立的响应（verify-code / login / register）之后，必须重新 `GET /config` 取新令牌**，旧令牌随之作废。这个设计的目的是防固定 token（合理），但表象是"登录成功但所有写操作 403"——极易误判为权限或中间件顺序问题，排查前先想起这一条。

- 令牌经 `X-CSRF-Token` 请求头携带；`/config` 每次返回当前有效令牌（掩码后下发）。
- **PAT（Bearer）请求天然豁免 CSRF**——服务器间集成用 PAT 时无需任何 CSRF 处理。
- 产品暴露**服务器间 API**（无浏览器会话、自带鉴权如 X-API-Key）时，应在 CSRF 中间件配置前缀豁免：

```go
csrfMW := webx.CSRFConditional(&webx.CSRFConfig{
    Key: ..., TrustedOrigins: ...,
    ExemptPrefixes: []string{"/open/"}, // 服务器间 API（自带鉴权，无会话）
}, authCfg.Secure)
```

## 注册的两条路径（分工）

| 路径 | 流程 | 适用 |
|---|---|---|
| **验证码即登录**（quickstart 用的这条） | `POST /auth/send-code` → `POST /auth/verify-code`（email+code）——验证即建号（不存在则创建）即建会话 | 面向人的默认注册/登录流，无密码体系 |
| **邮箱密码注册** | `POST /auth/register`（email+password+display_name，**不收 code 字段**，带了会 E_BAD_JSON）→ 登录走密码 | 需要密码体系的产品 |

对接方常见误解：给 register 带 code 字段。openapi.yaml 是字段合同的第一真源。

## 错误响应的语义

```json
{ "error": "E_VALIDATION", "message": "邮箱格式非法" }
```

- `error` 字段承载**业务码**（`E_*` 枚举，完整清单见 openapi.yaml 的 ErrorBody schema），不是错误信息本身；
- `message` 是人类可读描述；
- HTTP status 与业务码的映射是稳定的（400=E_VALIDATION/E_BAD_JSON、401=E_UNAUTHENTICATED、403=E_FORBIDDEN、404、409=E_CONFLICT、429=E_RATE_LIMITED）——**不要把 `error` 字段当 message 读，也不要用 HTTP status 细分业务语义**。

> 命名注记：Go 侧字段名是 `Code`、JSON 名是 `error`——历史遗留。0.x 保持不变（改名破坏所有现存消费方），语义以上述为准。

## 路由风格约定（Go stdlib ServeMux 的坑）

框架全部动作端点用**斜杠风格**：`POST /{id}/accept`、`POST /{id}/transfer-ownership`。产品侧请保持一致，因为直觉的冒号写法在 Go 1.22+ ServeMux 下**启动即 panic**：

```go
// ❌ panic: parsing "POST /admin/v1/fields/{id}:disable": at offset 22:
//         bad wildcard segment (must end with '}')
mux.HandleFunc("POST /admin/v1/fields/{id}:disable", h)

// ✅ 框架约定
mux.HandleFunc("POST /admin/v1/fields/{id}/disable", h)
```

另一个同族坑：**根兜底必须写裸 `/`**，写 `GET /` 会与已注册模式冲突 panic。
