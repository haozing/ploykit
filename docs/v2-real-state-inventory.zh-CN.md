# PloyKit 真实状态盘点

> 自动生成文档。该盘点使用静态启发式扫描页面、API、模块、provider 和测试证据，用来发现风险和执行优先级；它不能替代人工代码审查或真实浏览器/Provider required matrix。

- 生成时间：2026-06-17T01:13:09.903Z
- 生成命令：`npm run host:inventory`
- JSON 证据：`.runtime/product-inventory/2026-06-17T01-13-09-903Z/inventory.json`

## 总览

| 项目 | 数量/状态 |
| --- | --- |
| 页面 | 52 个，状态：data-backed-candidate=51<br>static-or-ui=1 |
| API route | 60 个文件，79 个 method，状态：guarded-data-backed=44<br>guarded=15<br>thin=1 |
| 模块 | 8 个，状态：product-demo-candidate=7<br>mvp=1 |
| Provider | 5 个，blocked/local/static：5 |
| 测试文件 | host tests 35 个，module tests 14 个 |
| 证据脚本 | 89 个 |

## R0 风险结论

1. 页面风险：0 个页面需要人工确认，主要是薄 wrapper 或占位文本风险。
2. API 风险：0 个 API route 需要人工确认，主要是 mutation route 的安全保护或 no-op 风险。
3. Provider 风险：5 个 provider 仍有外部生产 profile 或持久化 provider 证据缺口；Postgres、S3、Stripe、Email、AI/RAG 已具备本地 profile。
4. 模块风险：0 个模块缺少 module-local test。
5. 后续阶段每完成一批能力，都应该复跑本命令并提交最新 inventory，避免再次靠感觉判断完成度。

## 页面清单

| Route | Area | Status | Signals | Risk | File |
| --- | --- | --- | --- | --- | --- |
| / | site | data-backed-candidate | host-lib |  | `apps/host-next/app/page.tsx` |
| /:slug* | module-public | data-backed-candidate | host-lib |  | `apps/host-next/app/(site)/[...slug]/page.tsx` |
| /{lang} | site | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/page.tsx` |
| /{lang}/about | site | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/about/page.tsx` |
| /{lang}/admin | admin | data-backed-candidate | host-lib<br>component-wrapper<br>thin-wrapper<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/page.tsx` |
| /{lang}/admin/:modulePath* | admin | data-backed-candidate | host-lib<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/[...modulePath]/page.tsx` |
| /{lang}/admin/analytics | admin | data-backed-candidate | host-lib<br>component-wrapper<br>thin-wrapper |  | `apps/host-next/app/[lang]/admin/analytics/page.tsx` |
| /{lang}/admin/audit | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/audit/page.tsx` |
| /{lang}/admin/billing | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/billing/page.tsx` |
| /{lang}/admin/entitlements | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/entitlements/page.tsx` |
| /{lang}/admin/files | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/files/page.tsx` |
| /{lang}/admin/files/:fileId | admin | data-backed-candidate | host-lib<br>component-wrapper<br>thin-wrapper<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/files/[fileId]/page.tsx` |
| /{lang}/admin/module-dev-console | admin | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/admin/module-dev-console/page.tsx` |
| /{lang}/admin/modules | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/modules/page.tsx` |
| /{lang}/admin/modules/:moduleId | admin | data-backed-candidate | host-lib<br>component-wrapper<br>thin-wrapper |  | `apps/host-next/app/[lang]/admin/modules/[moduleId]/page.tsx` |
| /{lang}/admin/rbac | admin | data-backed-candidate | host-lib<br>component-wrapper<br>thin-wrapper |  | `apps/host-next/app/[lang]/admin/rbac/page.tsx` |
| /{lang}/admin/revenue | admin | data-backed-candidate | host-lib<br>component-wrapper<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/revenue/page.tsx` |
| /{lang}/admin/runs | admin | data-backed-candidate | host-lib<br>component-wrapper<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/runs/page.tsx` |
| /{lang}/admin/runs/:runId | admin | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/admin/runs/[runId]/page.tsx` |
| /{lang}/admin/search | admin | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/admin/search/page.tsx` |
| /{lang}/admin/service-connections | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form |  | `apps/host-next/app/[lang]/admin/service-connections/page.tsx` |
| /{lang}/admin/settings | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/settings/page.tsx` |
| /{lang}/admin/usage | admin | data-backed-candidate | host-lib<br>component-wrapper<br>thin-wrapper |  | `apps/host-next/app/[lang]/admin/usage/page.tsx` |
| /{lang}/admin/users | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/users/page.tsx` |
| /{lang}/admin/users/:userId | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/users/[userId]/page.tsx` |
| /{lang}/admin/webhooks | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/admin/webhooks/page.tsx` |
| /{lang}/admin/webhooks/:outboxId | admin | data-backed-candidate | host-lib<br>component-wrapper<br>form |  | `apps/host-next/app/[lang]/admin/webhooks/[outboxId]/page.tsx` |
| /{lang}/contact | site | data-backed-candidate | host-lib<br>component-wrapper<br>form |  | `apps/host-next/app/[lang]/contact/page.tsx` |
| /{lang}/dashboard | dashboard | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/dashboard/page.tsx` |
| /{lang}/dashboard/:modulePath* | dashboard | static-or-ui | - |  | `apps/host-next/app/[lang]/dashboard/[...modulePath]/page.tsx` |
| /{lang}/dashboard/billing | dashboard | data-backed-candidate | host-lib<br>runtime-signal |  | `apps/host-next/app/[lang]/dashboard/billing/page.tsx` |
| /{lang}/dashboard/credit-history | dashboard | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/dashboard/credit-history/page.tsx` |
| /{lang}/dashboard/files | dashboard | data-backed-candidate | host-lib<br>runtime-signal |  | `apps/host-next/app/[lang]/dashboard/files/page.tsx` |
| /{lang}/dashboard/notifications | dashboard | data-backed-candidate | host-lib<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/dashboard/notifications/page.tsx` |
| /{lang}/dashboard/orders | dashboard | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/dashboard/orders/page.tsx` |
| /{lang}/dashboard/profile | dashboard | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/dashboard/profile/page.tsx` |
| /{lang}/dashboard/settings/notifications | dashboard | data-backed-candidate | host-lib<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/dashboard/settings/notifications/page.tsx` |
| /{lang}/dashboard/tasks | dashboard | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/dashboard/tasks/page.tsx` |
| /{lang}/dashboard/tasks/:id | dashboard | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/dashboard/tasks/[id]/page.tsx` |
| /{lang}/dashboard/workspaces | dashboard | data-backed-candidate | host-lib<br>component-wrapper<br>form<br>runtime-signal |  | `apps/host-next/app/[lang]/dashboard/workspaces/page.tsx` |
| /{lang}/docs | site | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/docs/page.tsx` |
| /{lang}/forgot-password | auth | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/forgot-password/page.tsx` |
| /{lang}/login | auth | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/login/page.tsx` |
| /{lang}/pricing | site | data-backed-candidate | host-lib<br>component-wrapper<br>runtime-signal |  | `apps/host-next/app/[lang]/pricing/page.tsx` |
| /{lang}/privacy | site | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/privacy/page.tsx` |
| /{lang}/register | auth | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/register/page.tsx` |
| /{lang}/reset-password | auth | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/reset-password/page.tsx` |
| /{lang}/success | site | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/success/page.tsx` |
| /{lang}/terms | site | data-backed-candidate | host-lib<br>component-wrapper |  | `apps/host-next/app/[lang]/terms/page.tsx` |
| /admin | admin | data-backed-candidate | host-lib |  | `apps/host-next/app/admin/page.tsx` |
| /admin/:modulePath* | admin | data-backed-candidate | host-lib |  | `apps/host-next/app/admin/[...modulePath]/page.tsx` |
| /dashboard/:modulePath* | dashboard | data-backed-candidate | host-lib<br>runtime-signal |  | `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx` |

## API 清单

| Route | Methods | Status | Signals | Risk | File |
| --- | --- | --- | --- | --- | --- |
| /api/admin/analytics | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/analytics/route.ts` |
| /api/admin/audit | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/audit/route.ts` |
| /api/admin/entitlements | GET<br>POST<br>PATCH | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/entitlements/route.ts` |
| /api/admin/files | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/files/route.ts` |
| /api/admin/outbox/dead-letters | GET<br>POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/outbox/dead-letters/route.ts` |
| /api/admin/permissions | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/permissions/route.ts` |
| /api/admin/providers | GET<br>POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/providers/route.ts` |
| /api/admin/revenue | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/revenue/route.ts` |
| /api/admin/revenue/reconcile | POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/revenue/reconcile/route.ts` |
| /api/admin/roles | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/roles/route.ts` |
| /api/admin/search | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/search/route.ts` |
| /api/admin/security/catalog | GET | guarded-data-backed | route-security<br>session<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/security/catalog/route.ts` |
| /api/admin/service-connections | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/service-connections/route.ts` |
| /api/admin/usage | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/usage/route.ts` |
| /api/admin/users | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/users/route.ts` |
| /api/admin/workers | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/admin/workers/route.ts` |
| /api/auth/email/verify | GET<br>POST | guarded | route-security<br>signature/webhook<br>rate-limit |  | `apps/host-next/app/api/auth/email/verify/route.ts` |
| /api/auth/login | POST | guarded | route-security<br>rate-limit |  | `apps/host-next/app/api/auth/login/route.ts` |
| /api/auth/logout | POST<br>GET | guarded | route-security<br>rate-limit |  | `apps/host-next/app/api/auth/logout/route.ts` |
| /api/auth/password-reset/confirm | POST | guarded | route-security<br>rate-limit |  | `apps/host-next/app/api/auth/password-reset/confirm/route.ts` |
| /api/auth/password-reset/request | POST | guarded | route-security<br>rate-limit |  | `apps/host-next/app/api/auth/password-reset/request/route.ts` |
| /api/auth/register | POST | guarded | route-security<br>signature/webhook<br>rate-limit |  | `apps/host-next/app/api/auth/register/route.ts` |
| /api/auth/session | GET | guarded | route-security<br>session<br>rate-limit |  | `apps/host-next/app/api/auth/session/route.ts` |
| /api/auth/sessions | GET<br>DELETE | guarded | route-security<br>session<br>origin/csrf<br>rate-limit |  | `apps/host-next/app/api/auth/sessions/route.ts` |
| /api/billing/checkout | POST | guarded-data-backed | route-security<br>session<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/checkout/route.ts` |
| /api/billing/invoices | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/invoices/route.ts` |
| /api/billing/orders | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/orders/route.ts` |
| /api/billing/payment-methods | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/payment-methods/route.ts` |
| /api/billing/portal | POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/portal/route.ts` |
| /api/billing/stripe/webhook | POST | guarded-data-backed | route-security<br>signature/webhook<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/stripe/webhook/route.ts` |
| /api/billing/subscriptions | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/subscriptions/route.ts` |
| /api/billing/tax-profile | GET<br>PATCH<br>POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/billing/tax-profile/route.ts` |
| /api/contact | POST | guarded-data-backed | route-security<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/contact/route.ts` |
| /api/files | GET<br>POST | guarded-data-backed | route-security<br>session<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/files/route.ts` |
| /api/files/:fileId | GET<br>PATCH<br>DELETE<br>POST | guarded | route-security<br>session<br>rate-limit |  | `apps/host-next/app/api/files/[fileId]/route.ts` |
| /api/media/:fileId | GET | guarded-data-backed | route-security<br>session<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/media/[fileId]/route.ts` |
| /api/module-actions/:moduleId/:name | POST | guarded | route-security<br>rate-limit |  | `apps/host-next/app/api/module-actions/[moduleId]/[name]/route.ts` |
| /api/module-webhooks/:path* | POST | guarded-data-backed | route-security<br>signature/webhook<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/module-webhooks/[...path]/route.ts` |
| /api/modules/:path* | - | guarded | route-security<br>rate-limit |  | `apps/host-next/app/api/modules/[...path]/route.ts` |
| /api/notifications/:notificationId/read | POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/notifications/[notificationId]/read/route.ts` |
| /api/notifications/history | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/notifications/history/route.ts` |
| /api/notifications/preferences | GET<br>PATCH | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/notifications/preferences/route.ts` |
| /api/notifications/read-all | POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/notifications/read-all/route.ts` |
| /api/notifications/unread | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/notifications/unread/route.ts` |
| /api/product-scope/:workspaceId/invitations | GET<br>POST<br>PATCH | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/product-scope/[workspaceId]/invitations/route.ts` |
| /api/product-scope/:workspaceId/members | GET<br>POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/product-scope/[workspaceId]/members/route.ts` |
| /api/product-scope/current | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/product-scope/current/route.ts` |
| /api/product-scope/domain-aliases | GET<br>POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/product-scope/domain-aliases/route.ts` |
| /api/product-scope/products | GET | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/product-scope/products/route.ts` |
| /api/product-scope/switch | POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/product-scope/switch/route.ts` |
| /api/product-scope/workspaces | GET<br>POST | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/product-scope/workspaces/route.ts` |
| /api/user/profile | GET<br>PATCH | guarded | route-security<br>session<br>origin/csrf<br>rate-limit |  | `apps/host-next/app/api/user/profile/route.ts` |
| /api/user/profile/avatar | POST | guarded | route-security<br>session<br>origin/csrf<br>rate-limit |  | `apps/host-next/app/api/user/profile/avatar/route.ts` |
| /api/user/profile/password | POST | guarded | route-security<br>session<br>origin/csrf<br>rate-limit |  | `apps/host-next/app/api/user/profile/password/route.ts` |
| /api/user/profile/preferences | GET<br>PATCH | guarded-data-backed | route-security<br>session<br>origin/csrf<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/user/profile/preferences/route.ts` |
| /api/user/role | GET | guarded | route-security<br>session<br>origin/csrf<br>rate-limit |  | `apps/host-next/app/api/user/role/route.ts` |
| /api/worker/drain | POST | guarded-data-backed | route-security<br>session<br>signature/webhook<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/worker/drain/route.ts` |
| /api/worker/enqueue | POST | guarded-data-backed | route-security<br>session<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/worker/enqueue/route.ts` |
| /api/worker/status | GET | guarded-data-backed | route-security<br>session<br>rate-limit<br>store/provider |  | `apps/host-next/app/api/worker/status/route.ts` |
| /favicon.ico | - | thin | - |  | `apps/host-next/app/favicon.ico/route.ts` |

## Provider 清单

| Provider | Status | Missing Env | Evidence Files | Required Command |
| --- | --- | --- | --- | --- |
| Runtime Store / Postgres | local-postgres-default | DATABASE_URL | src/lib/module-runtime/stores/postgres-runtime-store.ts<br>scripts/runtime-stores.mjs<br>scripts/host-postgres-local-smoke.mjs<br>docker-compose.yml | `npm run host:postgres-local-smoke (local Docker Postgres) or npm run runtime:stores:verify (external)` |
| Files / S3-compatible | local-minio-default | S3_BUCKET<br>S3_ENDPOINT<br>S3_ACCESS_KEY_ID<br>S3_SECRET_ACCESS_KEY | scripts/host-s3-smoke.ts<br>scripts/host-s3-local-smoke.mjs<br>docker-compose.yml<br>src/lib/module-capabilities/files/storage-file-runtime.ts | `npm run host:s3-local-smoke (local MinIO) or npm run host:s3-smoke -- --required --check-signed-url (external)` |
| Billing / Stripe test mode | local-mock-default | STRIPE_SECRET_KEY<br>STRIPE_WEBHOOK_SECRET | scripts/host-stripe-smoke.ts<br>apps/host-next/lib/commercial-provider.ts | `npm run host:stripe-local-smoke (local mock) or npm run host:stripe-smoke -- --required --apply-ledger (external Stripe)` |
| Email provider | local-webhook-default | PLOYKIT_EMAIL_PROVIDER | apps/host-next/lib/email-provider.ts<br>scripts/host-email-smoke.ts<br>scripts/host-email-local-webhook-smoke.ts | `npm run host:email-local-webhook-smoke (local webhook) or npm run host:email-smoke -- --required (external)` |
| AI/RAG provider | local-ai-rag-default | PLOYKIT_AI_PROVIDER | src/lib/module-capabilities/rag/rag-runtime.ts<br>scripts/host-ai-rag-local-smoke.mjs | `npm run host:ai-rag-local-smoke (local provider) or npm run test:ai-provider && npm run test:rag-files` |

## 模块清单

| Module | Status | Routes | Actions | Jobs | Events | Webhooks | Data | Tests | File |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| ai-rag-demo | product-demo-candidate | 2 | 1 | 0 | 0 | 0 | no | 1 | `modules/ai-rag-demo/module.ts` |
| capability-demo | product-demo-candidate | 7 | 2 | 2 | 0 | 2 | yes | 1 | `modules/capability-demo/module.ts` |
| cms-demo | product-demo-candidate | 3 | 2 | 0 | 0 | 0 | yes | 1 | `modules/cms-demo/module.ts` |
| hello | product-demo-candidate | 2 | 1 | 1 | 0 | 1 | yes | 1 | `modules/hello/module.ts` |
| public-tools-demo | product-demo-candidate | 5 | 1 | 0 | 0 | 0 | yes | 1 | `modules/public-tools-demo/module.ts` |
| runlynk | product-demo-candidate | 41 | 48 | 0 | 0 | 0 | yes | 7 | `modules/runlynk/module.ts` |
| shop-demo | product-demo-candidate | 5 | 2 | 0 | 0 | 0 | yes | 1 | `modules/shop-demo/module.ts` |
| white-label-site-demo | mvp | 2 | 0 | 0 | 0 | 0 | no | 1 | `modules/white-label-site-demo/module.ts` |

## 测试与证据脚本

| Script | Command |
| --- | --- |
| `admin:ui-gate` | `node scripts/admin-ui-gate.mjs` |
| `catalog:doctor` | `node scripts/module-catalog.mjs doctor` |
| `data:verify` | `node scripts/module-data.mjs verify` |
| `data:verify-db` | `node scripts/module-data.mjs verify-db` |
| `docs:encoding-check` | `node scripts/docs-encoding-check.mjs` |
| `drift:check` | `node scripts/drift-check.mjs` |
| `format:check` | `npx prettier package.json tsconfig.json .prettierrc.json .github/workflows/ci.yml --check` |
| `host:accessibility-smoke` | `node scripts/host-accessibility-smoke.mjs` |
| `host:ai-rag-local-smoke` | `node scripts/host-ai-rag-local-smoke.mjs` |
| `host:ai-webhook-local-smoke` | `tsx scripts/host-ai-webhook-local-smoke.ts` |
| `host:backup-restore-smoke` | `tsx scripts/host-backup-restore-smoke.ts` |
| `host:billing-reconcile-smoke` | `tsx scripts/host-billing-reconcile-smoke.ts` |
| `host:boundary-check` | `node scripts/host-boundary-check.mjs` |
| `host:browser-matrix` | `node scripts/host-browser-matrix.mjs` |
| `host:chaos-smoke` | `tsx scripts/host-chaos-smoke.ts` |
| `host:config-doctor` | `tsx scripts/host-config-doctor.ts` |
| `host:email-local-webhook-smoke` | `tsx scripts/host-email-local-webhook-smoke.ts` |
| `host:email-smoke` | `tsx scripts/host-email-smoke.ts` |
| `host:files-cleanup-smoke` | `tsx scripts/host-files-cleanup-smoke.ts` |
| `host:files-reconcile-smoke` | `tsx scripts/host-files-reconcile-smoke.ts` |
| `host:local-provider-smoke` | `tsx scripts/host-local-provider-smoke.ts` |
| `host:postgres-local-smoke` | `node scripts/host-postgres-local-smoke.mjs` |
| `host:provider-matrix` | `node scripts/host-provider-matrix.mjs` |
| `host:rag-provider-smoke` | `tsx scripts/host-rag-provider-smoke.ts` |
| `host:s3-local-smoke` | `node scripts/host-s3-local-smoke.mjs` |
| `host:s3-smoke` | `tsx scripts/host-s3-smoke.ts` |
| `host:smoke` | `node scripts/host-smoke.mjs` |
| `host:stripe-local-smoke` | `tsx scripts/host-stripe-smoke.ts --mock-stripe --required --apply-ledger` |
| `host:stripe-smoke` | `tsx scripts/host-stripe-smoke.ts` |
| `host:theme-matrix` | `node scripts/host-theme-matrix.mjs` |
| `host:upgrade-migration-smoke` | `tsx scripts/host-upgrade-migration-smoke.ts` |
| `host:web-shell-evidence` | `node scripts/host-web-shell-evidence.mjs` |
| `host:worker-soak` | `tsx scripts/host-worker-soak.ts` |
| `i18n:check` | `tsx scripts/i18n-check.ts --required` |
| `module:doctor` | `node scripts/ploykit-module.mjs doctor` |
| `module:evidence` | `node scripts/module-evidence.mjs` |
| `module:test` | `node scripts/module-test.mjs` |
| `modules:check` | `node scripts/generate-module-map.mjs --check && node scripts/host-boundary-check.mjs && node scripts/ploykit-module.mjs check` |
| `presentation:check` | `tsx scripts/presentation-check.ts --required` |
| `pretypecheck` | `npm run modules:scan` |
| `release:evidence` | `node scripts/host-rc-evidence.mjs` |
| `release:integration-gate` | `node scripts/host-boundary-check.mjs && tsx scripts/release-candidate-gate.ts --profile integration` |
| `release:local-gate` | `node scripts/host-boundary-check.mjs && tsx scripts/release-candidate-gate.ts --profile local` |
| `release:maintainer-gate` | `node scripts/host-boundary-check.mjs && tsx scripts/release-candidate-gate.ts --profile maintainer` |
| `release:rc-gate` | `npm run release:maintainer-gate` |
| `runtime:boundary-check` | `node scripts/runtime-boundary-check.mjs` |
| `runtime:check` | `tsx scripts/check-runtime.ts` |
| `runtime:stores:verify` | `node scripts/runtime-stores.mjs verify` |
| `seo:check` | `tsx scripts/seo-check.ts --required` |
| `test:accessibility` | `node scripts/host-accessibility-smoke.mjs --required` |
| `test:admin-operations` | `tsx --test tests/admin-operations.test.ts` |
| `test:advanced-runtime` | `tsx --test tests/advanced-runtime.test.ts` |
| `test:ai-provider` | `tsx --test tests/ai-provider-runtime.test.ts` |
| `test:ai-provider-runtime` | `tsx --test tests/ai-provider-runtime.test.ts` |
| `test:api-key-store` | `tsx --test tests/api-key-store.test.ts` |
| `test:background-reliability` | `tsx --test tests/background-reliability.test.ts` |
| `test:background-runtime` | `tsx --test tests/background-runtime.test.ts` |
| `test:catalog-runtime` | `tsx --test tests/catalog-runtime.test.ts` |
| `test:commercial-ledger` | `tsx --test tests/commercial-ledger.test.ts` |
| `test:commercial-postgres` | `tsx --test tests/commercial-postgres.test.ts` |
| `test:data-runtime` | `tsx --test tests/data-runtime.test.ts` |
| `test:developer-experience` | `tsx --test tests/developer-experience.test.ts` |
| `test:developer-platform` | `tsx --test tests/developer-platform.test.ts` |
| `test:files-runtime` | `tsx --test tests/files-runtime.test.ts` |
| `test:files-storage` | `tsx --test tests/files-storage-driver.test.ts` |
| `test:host-page-runtime` | `tsx --test tests/host-page-runtime.test.ts` |
| `test:host-runtime` | `tsx --test tests/host-runtime.test.ts` |
| `test:human` | `node scripts/host-browser-matrix.mjs --required` |
| `test:module-action-route` | `tsx --test tests/module-action-route.test.ts` |
| `test:module-contract` | `tsx --test tests/module-contract.test.ts` |
| `test:module-doctor` | `tsx --test tests/module-doctor-cli.test.ts` |
| `test:module-evidence` | `tsx --test tests/module-evidence-cli.test.ts` |
| `test:module-map` | `tsx --test tests/module-map-cli.test.ts` |
| `test:module-service-contract` | `tsx --test tests/module-service-contract-cli.test.ts` |
| `test:product-scope` | `tsx --test tests/product-scope-runtime.test.ts` |
| `test:production-runtime` | `tsx --test tests/production-runtime.test.ts` |
| `test:rag-files` | `tsx --test tests/rag-files-artifacts.test.ts` |
| `test:release-candidate` | `tsx --test tests/release-candidate.test.ts` |
| `test:runtime-checks` | `tsx --test tests/runtime-checks.test.ts` |
| `test:runtime-stores` | `tsx --test tests/runtime-stores.test.ts` |
| `test:security-hardening` | `tsx --test tests/security-hardening.test.ts` |
| `test:security-runtime` | `tsx --test tests/security-runtime.test.ts` |
| `test:seo-presentation` | `tsx --test tests/seo-presentation.test.ts` |
| `test:theme` | `node scripts/host-theme-matrix.mjs --required` |
| `test:ui-runtime` | `tsx --test tests/ui-runtime.test.ts` |
| `test:web-shell` | `tsx --test tests/web-shell.test.ts` |
| `theme:check` | `tsx scripts/theme-check.ts --required` |
| `typecheck` | `tsc --noEmit` |
| `white-label:smoke` | `tsx scripts/white-label-smoke.ts --required` |

## 下一步建议

- 为 Postgres/S3/Stripe/Email/AI provider 建外部或持久化 required 证据；当前本地 profile 已覆盖主路径，仍需外部 provider 固定证据和生产运维闭环。
- 把本 inventory 作为 R0 基线，R1/R2/R3 每轮提交前复跑一次。
