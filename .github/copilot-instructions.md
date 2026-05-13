# Copilot Instructions For PloyKit

PloyKit is a plugin-first SaaS and public tool-site host. Most feature work
should be implemented as a local plugin rather than by changing host internals.

When generating plugin code:

- Update `plugins/<plugin-id>/plugin.ts` first.
- Use `definePlugin`, `defineApi`, `Permission`, and `z` from
  `@ploykit/plugin-sdk`.
- Use `ctx.storage`, `ctx.files`, `ctx.runs`, `ctx.connectors`, `ctx.ai`,
  `ctx.audit`, `ctx.usage`, `ctx.metering`, and other `ctx.*` capabilities.
- Do not import `src/lib/*`, read `process.env`, access the database directly,
  or call raw external `fetch()`.
- Use `ctx.http.fetch(...)` with `Permission.ExternalHttp` and explicit
  `egress` for external HTTP.
- Add `anonymousPolicy` for public APIs.
- Add tests with `@ploykit/plugin-sdk/testing`.
- Validate with `npm run plugin:doctor -- plugins/<plugin-id>`.

For host-level changes, follow existing patterns in `src/lib/plugin-runtime`,
`src/plugin-sdk`, and `scripts/ploykit-plugin.ts`, and keep edits narrowly
scoped.
