# ploykit example 产品

基于 ploykit 框架的示例产品：Go 后端 + React SSR 前端，单二进制交付。它演示框架全部业务域
（identity / workspace / billing / quota / admin / notify / audit / analytics / webhooks /
schedule / settings）、横切层（authz）与平台件的端到端接线，既是新产品的起点模板，也是框架
回归测试的载体。

前置条件：Go、Node.js（前端构建）、Docker（Postgres 16）。

## 开发模式（前端热更新）

```bash
# 终端 1：启动数据库（首次需要）
make db-up

# 终端 2：启动 Go 后端（:8080）
make backend

# 终端 3：启动前端热更新（:5173，代理 API 到 :8080）
make frontend
```

打开 http://localhost:5173 开发。改前端代码即时生效（热更新），改后端代码重启终端 2。

## 生产模式（单二进制）

```bash
make build    # vite build → prerender → embed → go build → app.exe
./app.exe     # 打开 http://localhost:8080
```

## 测试

```bash
# 仓库根目录（框架 + example 全量验证；DB 集成测试在未配置数据库时自动 Skip）
make verify

# 带 Postgres 的全量测试
make -C example db-up
make test-db

# 前端组件测试
make verify-ui

# API 契约检查（docs/openapi.yaml ↔ 路由注册）
python tools/check_api.py
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| DATABASE_URL | postgres://pk:pk@localhost:5432/pk | PostgreSQL |
| AUTH_SECRET | dev-pepper | 验证码 HMAC |
| DEV_CODE | 000000 | 开发万能码（生产留空） |
| WEBHOOK_ALLOW_PRIVATE_TARGET | 关 | 仅 dev：放行私网/环回 webhook 目标（本地接收端 E2E 需要；生产务必保持关闭，防 SSRF） |
| DEV_DEBUG_POOL | 关 | 仅 dev：/debug/pool 免认证（默认须平台管理员；生产勿开） |
| AUDIT_RETENTION_MONTHS | 12 | audit_event 分区保留月数（ADR 0009：合规惯例下限 12；有更长留存义务的行业向上调，勿向下） |
| ANALYTICS_RETENTION_MONTHS | 12 | analytics_event 分区保留月数（埋点无留存义务，可下调至 6 甚至更短） |
