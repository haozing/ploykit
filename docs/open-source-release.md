# Open-Source Release Checklist

Use this checklist before publishing PloyKit as a public open-source repository
or tagging a public release.

## Repository Metadata

- Add a `LICENSE` file.
- Set `license`, `repository`, `bugs`, and `homepage` in `package.json`.
- Decide whether the app remains `"private": true` or whether a package
  publishing strategy is needed.
- Check that README links, docs links, and script references are valid.

## Environment And Fixtures

- Review `.env.example` and `.env.docker.example` so they contain only
  placeholders or local-only fixtures.
- Keep local test credentials clearly labeled as fixtures.
- Confirm that secrets, tokens, webhooks, and cloud storage values are not
  committed.
- Validate production password reset delivery if password reset is advertised as
  production-ready.

## Scripts And Docs

- Review `docs/` for internal-only reports, stale plans, or one-off acceptance
  artifacts.
- Review `scripts/` for local debugging scripts, one-off data mutation tools, or
  scripts that assume private infrastructure.
- Keep release-facing acceptance scripts documented in
  [../scripts/README.md](../scripts/README.md).
- Prepare the P0 media assets from
  [open-source-media-assets.md](open-source-media-assets.md), and replace the
  default Next.js assets in `public/`.

## Verification

Run at least:

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test:run
npm run plugins:check
npm run db:verify
npm run test:security-audit
```

For runtime-sensitive releases, also run:

```bash
npm run verify:runtime
npm run test:real
npm run test:human
```

## Release Notes

- Document any known product boundaries from
  [project-scope.md](project-scope.md).
- Mention required environment variables for auth, plugin secrets, database,
  storage, and billing.
- List any migration or seed commands that a self-hosted user must run.
