# Security Policy

## Supported versions

The `master` branch is the only supported line. Security fixes land on master
and are distributed as new commits/releases — there are no backport branches.

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Use GitHub's private vulnerability reporting: open the repository's
**Security → Advisories → Report a vulnerability** flow. This keeps the report
private between you and the maintainers.

Include what you can of the following:

- The affected component (`platform/<pkg>`, a business domain, the example app)
- A minimal reproduction (payload, request, or test)
- Impact assessment

You will get an acknowledgement, and we will work with you on a fix and a
coordinated disclosure timeline before any public announcement.

## What counts as a security issue here

This framework ships security-relevant machinery — tenant isolation
(`platform/pg`), SSRF-safe egress (`platform/egressx`), secret sealing
(`platform/sealx`), session and impersonation handling (`platform/webx`,
`identity`), WebSocket room authorization (`platform/wsx`) — so boundary
violations in those packages are security issues even when they "only" break
an invariant. The architecture tests in `internal/arch` encode the intended
boundaries.
