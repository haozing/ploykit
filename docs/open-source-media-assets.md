# Open-Source Media Asset Plan

This plan defines the media assets PloyKit should ship or maintain for a public
open-source release. The goal is to make the project understandable in the first
minute without turning the repository into a marketing site.

## Current State

- `public/brand/` now contains the project logo, mark, favicon source,
  Apple touch icon, and default OG image.
- `public/media/` now contains README/docs screenshots, social previews, and a
  short plugin development demo.
- The app still has a generated `/opengraph-image` route. Use the committed
  `public/brand/og-default.png` as the stable release-sharing fallback.

## Principles

- Prefer real product screenshots over abstract illustrations.
- Show the plugin model, not only the dashboard chrome.
- Keep root README media light: one hero preview and a short gallery is enough.
- Put detailed media inventory and capture instructions in docs.
- Do not include sensitive local user data, real secrets, private URLs, Stripe
  customer data, or production logs.
- Keep binary assets intentionally small so clone size stays reasonable.

## Recommended Directory Layout

```text
public/
|-- brand/
|   |-- ploykit-logo.svg
|   |-- ploykit-mark.svg
|   |-- favicon.svg
|   |-- apple-touch-icon.png
|   `-- og-default.png
`-- media/
    |-- screenshots/
    |   |-- dashboard-admin.png
    |   |-- plugin-dev-console.png
    |   |-- plugin-management.png
    |   |-- public-json-tool.png
    |   |-- plugin-runtime-sample.png
    |   `-- ai-plugin-workflow.png
    |-- social/
    |   |-- github-preview.png
    |   `-- docs-preview.png
    `-- demo/
        |-- plugin-create-doctor-loop.gif
        `-- plugin-create-doctor-loop.mp4
```

Use `public/media/...` only for assets referenced by README/docs or public
pages. Use plugin-local `plugins/<plugin-id>/assets/` for assets that are loaded
through the plugin runtime.

## Launch Pack

These assets are enough for a strong open-source first release.

| Priority | Asset                            | Path                                                 | Format       | Purpose                                                                |
| -------- | -------------------------------- | ---------------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| P0       | Logo mark                        | `public/brand/ploykit-mark.svg`                      | SVG          | Small icon for README, docs, favicon source, and social templates.     |
| P0       | Horizontal logo                  | `public/brand/ploykit-logo.svg`                      | SVG          | Project identity in README and docs.                                   |
| P0       | Default OG image                 | `public/brand/og-default.png`                        | PNG 1200x630 | Stable social preview fallback and release sharing image.              |
| P0       | Admin dashboard screenshot       | `public/media/screenshots/dashboard-admin.png`       | PNG/WebP     | Shows operational host value: status, auth, runtime, plugins.          |
| P0       | Plugin dev console screenshot    | `public/media/screenshots/plugin-dev-console.png`    | PNG/WebP     | Shows diagnostics and agent-friendly plugin development.               |
| P0       | Public JSON tool screenshot      | `public/media/screenshots/public-json-tool.png`      | PNG/WebP     | Shows public tool-site route, SEO-facing plugin page, and alias model. |
| P0       | AI plugin workflow visual        | `public/media/screenshots/ai-plugin-workflow.png`    | PNG/WebP     | Shows `plugin.ts -> plugin:doctor -> tests -> plugins:scan` visually.  |
| P1       | Plugin management screenshot     | `public/media/screenshots/plugin-management.png`     | PNG/WebP     | Shows install/enable/disable lifecycle.                                |
| P1       | Sample plugin runtime screenshot | `public/media/screenshots/plugin-runtime-sample.png` | PNG/WebP     | Shows a dashboard plugin mounted by the runtime.                       |
| P1       | Short terminal demo              | `public/media/demo/plugin-create-doctor-loop.gif`    | GIF or MP4   | Shows plugin creation and doctor repair loop in under 30 seconds.      |
| P2       | GitHub social preview            | `public/media/social/github-preview.png`             | PNG 1280x640 | Repository social card.                                                |
| P2       | Docs preview                     | `public/media/social/docs-preview.png`               | PNG 1200x630 | Documentation index preview.                                           |

## Screenshot Capture Set

Use local fixture data only. The existing seed admin user is acceptable if the
README continues to label it as a local fixture.

| Screenshot                | Route                                 | State to show                                                     |
| ------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Admin dashboard           | `/en/admin`                           | System Status cards visible: Database, Runtime Reconcile, Auth.   |
| Plugin dev console        | `/en/admin/plugins/dev`               | Runtime Reconcile, diagnostics copy action, plugin summary cards. |
| Plugin management         | `/en/admin/plugins`                   | Sample Internal card with lifecycle actions.                      |
| Public JSON tool          | `/en/json` or `/en/tools/json-format` | JSON input, route contract panel, public plugin page chrome.      |
| Sample plugin runtime     | `/en/plugins/sample-internal`         | Notes region and plugin-mounted dashboard page.                   |
| AI plugin workflow visual | Static composed image                 | Contract, local files, doctor JSON, fake host tests.              |

Recommended viewport:

- Desktop README screenshots: `1440x960`
- Compact docs screenshots: `1280x720`
- Mobile sanity screenshots for docs only: `390x844`

## README Placement

Keep the root README concise:

1. Add one hero image after the opening description:
   `public/media/social/github-preview.png` or `public/brand/og-default.png`.
2. Add a four-image gallery after Highlights:
   dashboard, plugin dev console, public tool, AI workflow.
3. Keep detailed capture instructions in this document.

Avoid long animated GIFs in the root README. Link to the MP4/GIF from docs
instead.

## Brand Assets

The project needs a simple, inspectable vector identity:

- `ploykit-mark.svg`: compact square mark for favicon and social cards.
- `ploykit-logo.svg`: mark plus wordmark.
- `favicon.svg`: can reuse the mark.
- `apple-touch-icon.png`: raster export at 180x180.
- `og-default.png`: 1200x630, product name plus a simple UI preview motif.

Suggested visual direction:

- Work-focused SaaS/tooling aesthetic.
- High contrast, restrained color, not a one-hue purple/blue gradient.
- Motif: plugin nodes connected to a host shell, with a small `plugin.ts` or
  `ctx.*` signal.
- Avoid abstract blobs, stock photos, and decorative illustrations that do not
  reveal the product.

## Demo Video Or GIF

Only one short demo is needed for launch.

Scenario:

1. Run `npm run plugin:create -- invoice-helper --template tool`.
2. Open `plugins/invoice-helper/plugin.ts`.
3. Run `npm run plugin:doctor -- plugins/invoice-helper`.
4. Show JSON success or one diagnostic and repair.
5. Run `npm run plugins:scan`.

Keep it under 30 seconds. Prefer MP4 for docs and optionally provide a small GIF
fallback for GitHub.

## Automation Recommendation

Generate the launch assets with:

```bash
npm run media:generate
```

The script writes brand assets, social previews, the AI workflow image, a short
terminal demo, and product screenshots into `public/brand/` and `public/media/`.
It captures real product pages when the local app is reachable through
`NEXT_PUBLIC_APP_URL` or `PLOYKIT_MEDIA_BASE_URL`.

The capture flow:

- Start from a seeded local database.
- Log in with the local fixture admin.
- Capture the screenshot set into `public/media/screenshots/`.
- Fail if screenshots are blank or the expected heading is missing.

Set these optional overrides when needed:

```bash
PLOYKIT_MEDIA_BASE_URL=http://localhost:3000 npm run media:generate
PLOYKIT_MEDIA_ADMIN_EMAIL=admin@example.com PLOYKIT_MEDIA_ADMIN_PASSWORD=Admin@123456 npm run media:generate
```

## What Not To Add For Launch

- Large full-length product walkthrough videos.
- Stock hero images.
- Dark, blurred, or atmospheric product mockups.
- Screenshots with production data, emails other than fixtures, real Stripe
  identifiers, real webhook payloads, or private infrastructure URLs.
- Many near-duplicate admin pages. The media set should explain the product,
  not inventory every screen.

## Release Checklist Addition

Before public release:

- Keep the default Next.js assets out of `public/`.
- Regenerate and review the P0 launch pack.
- Verify every README/docs image link.
- Confirm social preview images render in GitHub and package pages.
- Check screenshot text in both English and Chinese docs if localized images are
  used.
