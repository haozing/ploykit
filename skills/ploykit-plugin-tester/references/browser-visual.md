# Browser And Screenshot Validation

## Route Enumeration

For a plugin, enumerate pages from:

- `routes.pages`
- `routes.tools`
- menu path
- `publicAliases`
- `hostPages.slots[].page`
- `hostPages.overrides[].page`
- config pages or admin surfaces if the plugin declares config, services,
  resource bindings, lifecycle, or install/enable flows

Cover locales that the plugin declares in `resources.locales` and every locale
listed in host page override `i18n.requiredLocales`. For PloyKit defaults,
check at least `zh` and `en` when the route is public or host-owned.

## Browser Run

Use Playwright for repeatable screenshots, or the in-app browser when the user
explicitly asks to use it. For Playwright:

- create a context with the app base URL
- sign in through the UI or auth API when routes require auth
- run desktop and mobile viewports for user-facing pages
- use `waitUntil: 'domcontentloaded'` plus explicit waits for expected text or
  capability markers
- collect console errors, page errors, failed network responses, and final URL
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
- expected `data-*` marker appears for plugin capability labs
- SEO title/canonical/robots are correct for public pages and host page
  overrides
- language-specific text is actually localized, not fallback keys
- plugin navigation/menu entry appears only where the runtime map says it should
- disabled or uninstalled plugin pages do not render

DOM assertions do not replace visual inspection.

## Screenshot Inspection

Open or view every meaningful screenshot. Look for:

- blank, loading, or error pages
- hydration mismatch overlays, Next.js error overlays, stack traces
- broken images, missing icons, missing CSS, unstyled content
- untranslated i18n keys or mixed wrong-language text
- text overlap, clipped buttons, horizontal scroll, bad wrapping
- cards inside cards or unexpected host shell duplication
- host header/footer/menu missing when the plugin should reuse them
- host page slot ordering or duplicate content problems
- dark/light theme contrast issues when the target supports theme switching
- mobile layout regressions

If there are many screenshots, inspect them in batches but still account for
each one in the report. Do not say "screenshots look fine" unless they were
actually opened or visually observed.

## Visual Failure Rules

Treat these as failures unless explicitly expected:

- page screenshot is blank or mostly empty
- browser console has uncaught errors
- API/network response for page-owned data is 5xx
- public page SEO metadata contradicts visible page content
- host page override breaks i18n, SEO, header/footer, or active menu state
- plugin content appears in the wrong product/suite/runtime context
