# Plugin Management Tests

This directory now covers the remaining plugin management surface after the
runtime-contract refactor.

## Current Coverage

- `plugin-query.server.test.ts`: installation query mapping and enabled-state reads.
- `constants.test.ts`: shared plugin constants.

## Runtime Installer Coverage

Install, enable, disable, and uninstall orchestration is tested in:

```txt
src/lib/plugin-runtime/installer/__tests__/plugin-runtime-installer.test.ts
```

The old legacy-entry installer/enabler/gateway tests were removed with the old
plugin management chain.
