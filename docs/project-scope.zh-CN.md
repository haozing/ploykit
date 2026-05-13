# 项目范围与当前边界

PloyKit 已经可作为本地插件 SaaS 与公开工具站宿主使用，但它还不是完整 marketplace 产品。这个文档记录开源用户和部署方需要明确知道的产品边界。

## 当前边界

- 插件来源是本地 `plugins/`；还没有远程 marketplace、上传插件包安装或插件 license 分发流程。
- `plugin_installations` 当前按 plugin ID 全局安装。runs、files、artifacts、connectors 和 API keys 已支持 user/workspace-scoped 资源，但插件安装本身还不是租户授权模型。
- AI 是宿主能力接口。运行时会执行权限、metering 和 credits 边界，但生产模型 provider 需要部署方接入。
- 密码重置投递当前支持 `log` 或 `disabled`；生产邮件投递需要另行实现。
- 文件存储支持 local 与 S3/R2-compatible adapter。真实云 bucket 在对外宣称生产可用前应在目标环境验收。
- `package.json` 当前仍是 `"private": true`，仓库也还没有 `LICENSE` 文件。正式开源前需要选择 license 并更新 package metadata。

## 生产假设

- 服务流量进入前先运行数据库迁移。
- Better Auth 和插件密钥要使用部署方稳定持有的密钥。
- 种子 admin 凭据只能作为本地 fixture。
- 文件存储、Stripe webhook、captcha 和密码重置投递都要在目标环境验证。
- 打 tag 或公开部署前运行安全与运行时验证脚本。
