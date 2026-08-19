# Recipe: White-Label Page

Intent: replace or contribute host-owned pages without drawing a second shell.

## Use

- Declare replacement intent with `presentation`.
- Add discoverability with `navigation` when the replacement changes public or admin entry points.
- Replace or contribute host-owned areas through `surfaces`.
- Permissions: `Permission.SurfaceOverride`, `Permission.SurfaceContribute`, `Permission.NavigationExtend`, and `Permission.ThemeWrite` as needed.

## Contract Shape

```ts
import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'brand-home',
  name: 'Brand Home',
  version: '0.1.0',
  permissions: [Permission.SurfaceOverride, Permission.NavigationExtend],
  presentation: {
    whiteLabel: true,
    replaces: ['host.page:site.home'],
    seoNamespaces: ['seo'],
    themeScope: 'site',
  },
  navigation: {
    location: 'site.header',
    fallbackLabel: 'Home',
    path: '/',
  },
  surfaces: {
    'host.page:site.home': {
      mode: 'replace',
      component: './surfaces/HomePage',
      loader: './loaders/home-meta',
      permissions: [Permission.SurfaceOverride],
      priority: 100,
    },
  },
});
```

## Component Rule

The component renders page content only. It should not render host sidebar, account menu, workspace switcher, or global navigation shell.

## Verify

Run:

```bash
npm run modules:scan
npm run module:doctor -- <id>
npm run presentation:check
npm run module:test -- <id> --summary
```

## Red Lines

- Do not change `apps/host-next/*` for a module page.
- Do not hide host structure and rebuild it locally.
- Do not add navigation markup inside the page when `navigation` or `surfaces` can express it.
