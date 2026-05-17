# 项目范围与当前边界

PloyKit 已经可作为本地插件 SaaS 与公开工具站宿主使用，但它还不是完整 marketplace 产品。这个文档记录开源用户和部署方需要明确知道的产品边界。

## 当前边界

- 插件来源是本地 `plugins/`；还没有远程 marketplace、上传插件包安装或插件 license 分发流程。
- 插件安装记录按产品、suite/app bundle 和 plugin 维度保存，用于管理面查看与审计；runtime-facing surfaces（导航、theme、hook、slot、host page override 等）会按当前产品运行时 map 过滤，避免跨产品残留污染当前构建与运行日志。
- AI 是宿主能力接口。运行时会执行权限、metering 和 credits 边界，但生产模型 provider 需要部署方接入。
- 密码重置投递当前支持 `log` 或 `disabled`；生产邮件投递需要另行实现。
- 文件存储支持 local 与 S3/R2-compatible adapter。真实云 bucket 在对外宣称生产可用前应在目标环境验收。
- 仓库基于 MIT License 发布。`package.json` 当前仍保留 `"private": true`，因为 PloyKit 目前作为应用仓库分发，而不是作为 npm package 发布。

## 生产假设

- 服务流量进入前先运行数据库迁移。
- Better Auth 和插件密钥要使用部署方稳定持有的密钥。
- 种子 admin 凭据只能作为本地 fixture。
- 文件存储、Stripe webhook、captcha 和密码重置投递都要在目标环境验证。
- 打 tag 或公开部署前运行安全与运行时验证脚本。
