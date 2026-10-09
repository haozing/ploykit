---
name: Feature request
about: Propose a new capability or change for the framework
labels: enhancement
---

**Problem first**

What are you trying to build, and what is missing or painful today? A concrete
use case beats a proposed API.

**Proposed solution**

What you think should happen. If it touches the framework's boundaries
(domain isolation, `platform/*` scope, the extension-point surface), say which
rule it interacts with — the rules live in [CONTRIBUTING.md](../../CONTRIBUTING.md)
and are enforced by `internal/arch` tests.

**Alternatives considered**

Other ways to solve the same problem, including "don't add it to the
framework — products can compose this themselves".

**Will this land in the example app?**

Framework capabilities must be wired into `example/` (page + API + DB + tests,
at least three of the four) in the same change — tell us how yours would be
demonstrated there.

**Additional context**

Links, prior art, screenshots.
