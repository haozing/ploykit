# Browser And Screenshot Validation

## Route Enumeration

For a module, enumerate pages from:

- `routes.site`
- `routes.dashboard`
- `routes.admin`
- page `publicAliases`
- `navigation.path`
- declared surfaces on host pages
- config/admin pages when lifecycle, catalog, resources, or runtime store
  behavior changed

For host changes, include affected Web Shell routes such as site, auth,
dashboard, admin, public tool pages, module APIs exposed through UI, and any
surface target pages.

Do not add module-specific routes to the global host browser matrix or
accessibility smoke route arrays for module-only work. Use a module-local route
sweep or a manifest-derived list, and keep that evidence under the module or
test artifact directory.

When the Admin shell changes intentionally, include the admin visual passes:

```bash
npm run admin:ui-gate
npm run admin:mobile-handfeel -- --required
npm run admin:visual-baseline
```

## Browser Run

Use Playwright or the available in-app browser for repeatable evidence. For
Playwright:

- create a context with the app base URL
- sign in through the real UI or auth route when routes require auth
- run desktop and mobile viewports for user-facing pages
- use `waitUntil: 'domcontentloaded'` plus explicit waits for expected text,
  module markers, or capability results
- collect console errors, page errors, failed network responses, response
  statuses, and final URL
- save full-page screenshots with animations disabled

Suggested viewports:

```text
desktop: 1440x1100
mobile: 390x844
```

## What To Assert Before Screenshot

Use DOM assertions for objective signals:

- main region is visible
- expected route text appears
- expected `data-*` marker appears for capability demo or module surfaces
- SEO title, canonical, and robots are correct for public pages
- language-specific text is localized, not fallback keys
- module navigation/menu entry appears only where the runtime map says it
  should
- disabled or unavailable module pages do not render as enabled

DOM assertions do not replace visual inspection.

## Screenshot Inspection

Open or view every meaningful screenshot. Look for:

- blank, loading, or error pages
- hydration mismatch overlays, Next.js error overlays, stack traces
- broken images, missing icons, missing CSS, unstyled content
- untranslated i18n keys or mixed wrong-language text
- text overlap, clipped buttons, horizontal scroll, bad wrapping
- shell layout regressions when nav or aside panels are absent
- duplicate host chrome, missing header/footer/menu, or incorrect active state
- surface ordering or duplicate contribution problems
- dark/light theme contrast issues when supported
- mobile layout regressions

## Console And Network Failure Rules

Treat these as failures unless explicitly expected:

- uncaught console error or page error
- 5xx response
- failed owned resource
- 404 for a first-party asset such as favicon, CSS, JS, module resource, media,
  or API path
- public page SEO metadata contradicts visible content
- module content appears in the wrong product, workspace, or runtime context

## Artifact Location

Store final screenshots, console/network summaries, and route observations under
`test-results/<test-name>/`. If a test runner clears that directory, capture raw
browser artifacts under `.runtime/<test-name>/browser/` and copy the final files
after the runner exits.

For Admin work, keep the latest evidence pointer in `.runtime/admin-visual-baseline.json`.
