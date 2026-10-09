# ploykit example 产品

基于 ploykit 的产品模板：Go 后端 + React SSR 前端，单二进制交付。框架侧规则见 ploykit 仓库 AGENTS.md。

## 工作区

- `web/src/`：前端——SSR 双入口 `entry-client.tsx` / `entry-server.tsx`，路由 `routes.tsx`，页面 `pages/`
- `internal/`：产品业务逻辑（范本：`internal/task/`）
- `cmd/app/main.go`：组合根，**加新域/改装配先读它**；`cmd/render/`：SSR 构建器

## 禁区

- 框架迁移内嵌于 ploykit（`migrations.FS`）改不了；产品迁移在 `cmd/app/migrations/`，从 **1001** 起编号（现有 1001–1007，以目录最大号为准）
- `web/dist/`、`cmd/app/frontend/`（构建产物）、`renderx-cache/`、`node_modules/` 勿手改
- 缺框架能力 → 去 ploykit 仓库改框架，勿在产品里绕过

## 命令

- `make db-up`（Postgres）/ `make db-down`
- `make backend`（Go :8080）；`make frontend`（Vite :5173 热更新）
- `make build`：三步链 vite build → `cmd/render` prerender → go:embed → go build（docs/rendering.md §4.5）

## 参考

`cmd/app/main.go` 是全部域组装方式的唯一完整范例；页面接入以 `web/src/routes.tsx` 为现状事实（overrides 槽位机制未落地，勿引用）。
