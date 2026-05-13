# AI Task Guide: Dashboard Plugin

Use this template for authenticated dashboard views with read-heavy summaries or
small operational actions.

## Agent Rules

- Keep edits inside this plugin directory.
- Update `plugin.ts` first.
- Use dashboard routes with `auth: 'auth'` unless the page is admin-only.
- Use `layout: 'dashboard-admin'` only with `auth: 'admin'`.
- Read platform data through declared `ctx.*` capabilities.
- Keep UI components local to `pages/**`.
- Add API handlers for mutations instead of placing server work in client UI.
- Add fake host tests for API behavior and page import smoke.

## Validate

```bash
npm run plugin:doctor -- plugins/__PLUGIN_ID__
```
