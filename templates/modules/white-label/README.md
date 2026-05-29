# __MODULE_NAME__

White-label public page module generated from the PloyKit template.

This template demonstrates the clean presentation path:

- `presentation.replaces` declares the host page being replaced.
- `resources.locales` owns module copy.
- `loaders/home-meta.ts` returns page SEO, shell, cache, and i18n metadata.
- `theme.tokens` uses host-approved semantic tokens only.
- Navigation uses `labelKey`; `fallbackLabel` is only a contract fallback, not
  the normal rendering path.
