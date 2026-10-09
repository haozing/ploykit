<!-- Title: conventional commit style, e.g. "feat(billing): manual subscription orders auto-upgrade" -->

## Summary

What does this PR change, and why?

## Boundary check (framework law)

- [ ] No domain imports another domain (or the crossing is listed in
      `internal/arch/allowlist.txt` **and** backed by an ADR updated in this PR)
- [ ] `platform/*` still imports zero business packages
- [ ] Product migrations start at `1001+` (framework owns `001–999`)
- [ ] New framework capability is wired into `example/` (page + API + DB + tests, ≥3 of 4)

## Verification

- [ ] `go build ./... && go vet ./... && go test ./...` green
- [ ] `make -C example db-up && make test-db` green (if storage/migrations touched)
- [ ] `python tools/check_api.py` green and `docs/openapi.yaml` updated (if API touched)
- [ ] `packages/*` vitest + `tsc --noEmit` green (if frontend touched)

## Notes

Anything reviewers should look at closely — design trade-offs, follow-up work,
the ADR this supersedes.
