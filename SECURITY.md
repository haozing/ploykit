# Security Policy

## Supported Versions

Security fixes target the main branch until the project publishes a versioned support policy.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately by opening a GitHub security advisory for this repository. If advisories are unavailable, contact the maintainers before publishing details.

Include:

- affected commit or version
- reproduction steps
- impact and affected boundary
- any logs or screenshots with secrets redacted

## Security Boundary

PloyKit modules are trusted local source modules. Runtime guards enforce permissions at the `ctx.*` capability API boundary, but PloyKit is not a Node.js sandbox for untrusted third-party code.

Do not install or execute unknown modules without source review. A future third-party marketplace would require separate process isolation, package signing, network policy, resource limits, and revocation design.
