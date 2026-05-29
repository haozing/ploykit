# 部署说明

PloyKit 的部署还是本地优先、Docker 优先。真实数据库和浏览器证据
尽量在本地或 Docker 环境里跑完。

## 本地开发

```bash
npm run db:up
npm run runtime:stores:migrate
npm run runtime:stores:verify
npm run host:dev
```

## 生产式验证

```bash
npm run host:build
npm run host:start
```

## 数据库验证

```bash
npm run data:migrate -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
npm run data:verify-db -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
```

## 发布前门禁

这些门禁用于宿主 / 产品发布。模块本地开发不要为了单个模块把模块路由或模块专属 E2E 写进全局 RC、browser matrix 或 accessibility smoke；模块自有外部链路先记录在模块 README 中，说明前置条件、命令和证据路径。

```bash
npm run module:doctor -- <module-id>
npm run module:test -- <module-id>
npm run modules:scan
npm run modules:check
npm run host:boundary-check
npm run release:local-gate
npm run release:integration-gate
```

维护者正式发布前再运行：

```bash
npm run release:maintainer-gate
```

`modules:check` 和所有 release gate 脚本都会先跑 `host:boundary-check`。单独列出
这个命令，是为了在部署前快速定位宿主 / shared 代码是否 import 具体模块、硬编码
module id、`/dashboard/<id>`、模块专属 root script 或模块专属 host quality 路由。

## Admin 视觉验证

```bash
npm run admin:ui-gate
npm run host:browser-matrix -- --required
npm run host:accessibility-smoke -- --required
npm run admin:mobile-handfeel -- --required
npm run admin:visual-baseline
```
