# Contributing

Thanks for helping improve PloyKit.

PloyKit modules are trusted local source modules. They run in the host process and are reviewed as source code, not installed as untrusted third-party plugins.

## Local Checks

Run the contributor gate before opening a PR:

```bash
npm install
npm run release:local-gate
```

For module-only changes, also run:

```bash
npm run module:doctor -- modules/<module-id>
npm run module:test -- modules/<module-id>
```

Data v2 modules should also run data generation, types, and verification.

## Boundaries

- Keep module-owned code inside `modules/<module-id>/`.
- Do not add module-specific root package scripts.
- Do not hard-code concrete module ids in host/runtime code.
- Use `module:evidence` for module-owned E2E evidence scripts.
- Use `ctx.*` capabilities and declare matching permissions in `module.ts`.

Maintainer release checks may require Docker, browser automation, provider credentials, or commercial test accounts. Those are not required for ordinary contribution setup.
