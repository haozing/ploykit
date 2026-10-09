# Contributing to ploykit

Thanks for your interest in contributing! This document gets you from clone to a merged PR.

## Development setup

Requirements: **Go 1.26+**, **Node 22+**, **Docker** (for the integration database), **Python 3** (stdlib only, for the API contract checker).

```bash
git clone https://github.com/haozing/ploykit.git
cd ploykit
npm install                # installs the npm workspaces (ui · client · runtime · example web)

make verify                # contract check + build + vet + unit tests (the fast gate)
make -C example db-up      # start PostgreSQL on :5437 (Docker)
make test-db               # full integration suite against that database
make verify-ui             # frontend component tests
```

The example app is the fastest way to feel the framework:

```bash
make -C example backend    # :8030 — runs migrations, wires every domain
make -C example frontend   # :5173 — vite dev server
```

Register with the dev verification code `000000`.

## The architecture contract

ploykit is a framework, so its most important feature is what it *forbids*.
These rules are enforced by `internal/arch` tests — the build fails if you cross them:

- Dependencies flow one way: **product → framework**. Never the reverse.
- Business domains never import each other. Cross-domain reactions go through
  `platform/events` (transactional events) or the explicit exemptions in
  `internal/arch/allowlist.txt` (each backed by an ADR).
- `platform/*` packages never import business domains.
- Framework migrations are numbered `001–999` and are framework-owned; product
  migrations start at `1001`.
- Every new framework capability must be wired into `example/` in the same
  change (page + API + DB + tests, at least three of the four).
- Tenant credentials are always sealed through `sealx`.

If your change intentionally crosses a boundary: update the relevant
[ADR](docs/adr/) **and** the allowlist in the same PR, and say so in the PR
description. Silent crossings are rejected.

## Extending a domain

Domains expose extension points (hooks) — the catalog with semantics lives in
[docs/api-index.md](docs/api-index.md). Before adding a new hook, check whether
an existing one covers your case; the API surface is deliberately small.

## Pull requests

1. Fork, create a branch from `master`.
2. Run the full gate before pushing:
   ```bash
   go test ./... && make -C example db-up && make test-db
   cd packages/ui && npx vitest run && npx tsc --noEmit
   python tools/check_api.py
   ```
3. Fill out the PR template. PRs that change the API contract must keep
   `python tools/check_api.py` green (update `docs/openapi.yaml` in the same PR).
4. Keep commits conventional (`feat:`, `fix:`, `docs:`, `chore:` …).

## Reporting bugs and proposing features

Use the issue templates. For security vulnerabilities, see
[SECURITY.md](SECURITY.md) — please do not open public issues.
