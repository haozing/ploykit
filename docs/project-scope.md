# Project Scope And Current Boundaries

PloyKit is useful as a local-plugin SaaS and public tool-site host, but it is not
yet a complete marketplace product. This page records the product boundaries
that are important for open-source users and deployers.

## Current Boundaries

- Plugin source is local code: the default `plugins/` directory plus optional
  external source directories configured with `PLOYKIT_PLUGIN_DIRS`. There is no
  remote marketplace, uploaded plugin package installation, or license
  distribution flow yet.
- Plugin source discovery is local and code-only: configured plugin roots with
  `plugin.ts` are scanned into generated module maps. The committed default map
  tracks `plugins/`; external product shells can prepare ignored runtime map
  artifacts under `.runtime/` or a `PLOYKIT_PLUGIN_MAP_FILE` path. Product,
  suite, and app bundle placement belongs to installation/catalog state, not
  plugin source discovery.
- Plugin installation records are scoped by product, optional suite or app
  bundle, and plugin for admin visibility and audit. Runtime-facing surfaces
  use installed/enabled plugin state in production; development can load local
  plugins directly when no database is configured.
- AI is a host capability interface. The runtime enforces permissions, metering,
  and credit hooks, but a production model provider must be wired by the
  deployer.
- Password reset delivery currently supports `log` or `disabled`. Production
  email delivery needs an implementation.
- File storage supports local and S3/R2-compatible adapters. Real cloud buckets
  should be validated in the target environment before being advertised as
  production-ready.
- The repository is released under the MIT License. `package.json` still has
  `"private": true` because PloyKit is currently distributed as an application
  repository, not as an npm package.

## Production Assumptions

- Run database migrations before serving traffic.
- Use stable, deployment-owned secrets for Better Auth and plugin secrets.
- Treat the seeded admin credentials as local fixtures only.
- Validate file storage, Stripe webhooks, captcha, and password reset delivery
  in the target environment.
- Run the security and runtime verification scripts before tagging or deploying
  a public release.
