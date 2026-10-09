---
name: Bug report
about: Something in the framework or the example app behaves incorrectly
labels: bug
---

**What happened?**

A clear and concise description of the incorrect behavior.

**Expected behavior**

What you expected to happen instead.

**Reproduction**

Minimal steps or a snippet that triggers the issue:

```go
// smallest code that reproduces it (or the exact request/steps)
```

**Environment**

- OS:
- Go version (`go version`):
- Node version (if frontend):
- ploykit commit / version:

**Evidence**

- Failing test output, or `internal/arch` / `tools/check_api.py` output if relevant.
- If this is a boundary violation you believe is a bug in the *rule itself*, link the ADR.

**Additional context**

Anything else that helps.
