# Routes And API Surface

The source of truth for application routes is always `src/app`. This document is
a human-readable overview of the main route families.

## Site And Auth

```text
/{lang}
/{lang}/about
/{lang}/contact
/{lang}/pricing
/{lang}/privacy
/{lang}/terms
/{lang}/success
/{lang}/login
/{lang}/register
/{lang}/forgot-password
/{lang}/reset-password
```

## User Dashboard

```text
/{lang}/profile
/{lang}/billing
/{lang}/billing/orders
/{lang}/billing/credit-history
/{lang}/notifications
/{lang}/settings/notifications
/{lang}/tasks
/{lang}/tasks/{id}
```

## Admin Console

```text
/{lang}/admin
/{lang}/admin/users
/{lang}/admin/rbac
/{lang}/admin/entitlements
/{lang}/admin/usage
/{lang}/admin/analytics
/{lang}/admin/revenue
/{lang}/admin/audit-logs
/{lang}/admin/files
/{lang}/admin/plugins
/{lang}/admin/plugins/dev
/{lang}/admin/plugin-operations
/{lang}/admin/operations
/{lang}/admin/search
/{lang}/admin/settings
```

## Plugin Pages

```text
/{lang}/tools/{...slug}
/{lang}/{...publicAlias}
/{lang}/plugins/{pluginId}/{...slug}
/{lang}/admin/plugins/{pluginId}/{...slug}
```

## Representative APIs

```text
/api/auth/[...all]
/api/user/profile
/api/user/subscription
/api/notifications/*
/api/files/*
/api/plugin-files/{id}/{operation}
/api/plugin-runs
/api/plugin-runs/{id}/cancel
/api/plugin-assets/{pluginId}/{...path}
/api/plans
/api/checkout/create
/api/webhooks/stripe
/api/plugins
/api/plugins/{pluginId}/{...slug}
/api/plugins/{pluginId}/webhooks/{...path}
/api/admin/*
```

## Notes

- Plugin public tool pages are declared in plugin contracts and mounted through
  generated runtime adapters.
- Public aliases should be treated as product URLs and reviewed for conflicts
  with first-party pages.
- Admin APIs should remain behind the existing auth, RBAC, CSRF, origin, and
  rate-limit middleware boundaries.
