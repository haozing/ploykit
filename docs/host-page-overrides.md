# Host Page Slots And Overrides

Plugins can extend selected host-owned pages without taking over routing or
duplicating the host shell. Use this when a plugin needs to add content to pages
such as `/`, `/pricing`, or `/about`, or when a trusted plugin must replace the
main content of a host page.

## Choose The Right Surface

| Need                                                   | Contract              | Permission                    |
| ------------------------------------------------------ | --------------------- | ----------------------------- |
| Add content before or after a host page region         | `hostPages.slots`     | `Permission.HostPageExtend`   |
| Replace the main content of a host page                | `hostPages.overrides` | `Permission.HostPageOverride` |
| Reuse host header, footer, language switcher, and menu | override `shell`      | covered by the override       |

Do not use `publicAliases` to claim host routes such as `/`, `/about`, or
`/pricing`. Public aliases are for plugin-owned pages.

## Slot Example

```ts
import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'marketing-banner',
  name: 'Marketing Banner',
  version: '0.1.0',
  trustLevel: 'trusted',
  permissions: [Permission.HostPageExtend],
  resources: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
  },
  hostPages: {
    slots: [
      {
        page: '/',
        position: 'hero.before',
        component: './slots/HomeBanner',
      },
      {
        page: '/pricing',
        position: 'main.after',
        component: './components/PricingNote',
      },
    ],
  },
});
```

`component` must be a plugin-local module path. Put page-level replacements in
`./pages/`, reusable UI in `./components/`, and simple slot-only modules in
`./slots/`; `plugin:doctor` checks that declared modules exist.

Slot components receive `PluginRuntimeSlotProps` from the host, including
`pluginId`, `page`, `position`, `i18n`, and `assets`:

```tsx
import { createPluginTranslator, type PluginRuntimeSlotProps } from '@ploykit/plugin-sdk';

export default function HomeBanner(props: PluginRuntimeSlotProps) {
  const t = createPluginTranslator(props.i18n);

  return <section>{t('home.banner')}</section>;
}
```

## Override Example

Overrides are stronger than slots. They replace the host page main content and
must declare SEO and required locales.

```ts
export default definePlugin({
  id: 'about-replacement',
  name: 'About Replacement',
  version: '0.1.0',
  trustLevel: 'trusted',
  permissions: [Permission.HostPageOverride],
  resources: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
  },
  hostPages: {
    overrides: [
      {
        page: '/about',
        mode: 'main.replace',
        component: './pages/AboutOverride',
        shell: {
          layout: 'site',
          header: 'host',
          footer: 'host',
          container: 'fixed',
          activeMenuPath: '/about',
        },
        seo: {
          titleKey: 'hostPages.about.seo.title',
          descriptionKey: 'hostPages.about.seo.description',
          canonical: '/about',
          robots: { index: true, follow: true },
          sitemap: { include: true, changeFrequency: 'weekly', priority: 0.6 },
        },
        i18n: {
          requiredLocales: ['en', 'zh'],
        },
      },
    ],
  },
});
```

Override page components receive the normal `PluginRuntimePageProps`, including
`pluginId`, `localPath`, `requestPath`, `params`, `query`, `i18n`, `assets`, and
route metadata.

## Rules

- Use host page slots for additive content.
- Use host page overrides only for trusted plugins that intentionally replace a
  host page body.
- Reuse the host header and footer by default.
- Keep visible UI localized for every locale listed in `requiredLocales`.
- Keep SEO metadata aligned with the replacement content.
- Read i18n and assets through `PluginRuntimeSlotProps` or
  `PluginRuntimePageProps`; do not assume the host passes a bare `locale` prop.
- Run `npm run plugin:doctor -- plugins/<plugin-id>` after changing the
  contract.
