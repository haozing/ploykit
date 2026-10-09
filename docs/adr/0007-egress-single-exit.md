# ADR 0007 · Single egress exit: the egressx controlled client is the sole channel for framework outbound traffic

Status: implemented (2026-10-07 decision, in force)

## Background

Once every piece of framework and product outbound HTTP (webhook delivery, federated OIDC discovery/token/userinfo, OAuth adapters, SEO push, ...) assembles its own `http.Client`, SSRF protection degrades to "each call site's own discipline" — one missed site breaks one whole front. Industry forensic evidence:

- **Gitea CVE-2026-22874 (CVSS 9.6)**: a centralized egress module with an incomplete blocklist was pierced ("9 ranges are not enough" — this framework's deny-range list must keep expanding and cover variant decodings);
- **Ghost CVE-2025-9862**: the root cause was a bare fetch **outside** the hardened client — the equivalent lesson being that "centralized protection + scattered exits" equals no centralized protection (see the anti-corruption clauses below);
- The Go ecosystem has no de-facto standard library (safeurl ships no default list and has a small community), which grounds the in-house `platform/egressx`.

A later platform-piece audit found three breaches: the github/googleoidc adapters built their own clients with no injection seam, renderx IndexNow used a timeout-less `http.DefaultClient`, and this ADR document itself was missing (all three are now closed; see "Consequences").

## Decision

**The egressx controlled client is the sole channel for framework outbound traffic**. Any framework/product code initiating outbound HTTP constructs its client through `egressx.NewHTTPClient` by default (or receives an instance built by that constructor through an injection seam fed by the composition root), acquiring two layers of protection:

1. Inside the Transport, `Guard.ValidateURL` pre-checks before RoundTrip (scheme allowlist + private/reserved range verdicts; the list aligns with the full arkadiyt/ssrf_filter set + NAT64 decoding);
2. `net.Dialer.Control` re-verifies the actual IP after DNS resolution and before the TCP handshake (the TOCTOU layer against DNS rebinding); redirects are re-checked hop by hop through the same Transport.

DNS failures uniformly **fail closed** (matching the posture of mainstream implementations such as ssrf_filter/GitLab/Svix).

## Exception list (explicit injection seams, each booked individually)

"Sole channel" does not forbid customization; it means **customization must be explicit**. Every injection seam is an exception seam, and in all cases the injector bears the responsibility of stating the outbound protection:

| Injection seam | Semantics |
|---|---|
| `webhooks.WebhookService.WithHTTPClient` | Delivery client replacement; `GuardOf` extracts the same-source pre-check surface |
| `oidcfed.Resolver.WithHTTPClient` / `Provider.hc` | Federated discovery/token/userinfo outbound |
| `github.Provider.WithHTTPClient` / `googleoidc.Provider.WithHTTPClient` | The two OAuth adapters (endpoints locked to vendor domains, SSRF surface ≈ 0; timeout/proxy/rebinding policies unified through the composition root) |
| `renderx.IndexNowDeps.Client` | IndexNow push; the default is a plain package-level client with a 30s timeout, not egressx-backed (the endpoint is ops-configurable and may point into an internal network, hence the default is not strict egress); the egressx posture arrives only via injection |

When a plain `http.Client` is injected, protection responsibility falls to the injector. Local-development private-network escape hatch: the `WEBHOOK_ALLOW_PRIVATE_TARGET` / `FED_ALLOW_PRIVATE_IDP` switches map onto `egressx.PrivateAllowCIDRs()` (mirror-exported from the same source as the built-in deny ranges — a single source of truth).

## Anti-corruption clauses

1. **Business code must not build its own `http.Client` for outbound requests** — the equivalent of Ghost CVE-2025-9862's bare fetch. Outbound needs of new platform pieces/new domains: wire into egressx, or open an explicit injection seam and add it to the table above; the lint tool for banning bare clients is deferred to later work.
2. Evolution of the egressx built-in deny ranges happens only here: range expansion plus embedded variant decodings (mapped/compatible/translated/NAT64) are uniformly collected at the `checkIP` verdict entry; the allow ranges are exported from `PrivateAllowCIDRs()`, and **consumers must not keep a second hand-made copy** (three copies once existed inside the framework; they have been converged).
3. `AllowCIDRs` taking precedence over the built-in deny ranges is escape-hatch semantics, not a routine configuration surface: a wildcard range like `0.0.0.0/0` amounts to tearing the protection down (a known foot-gun, knowingly registered).
4. Platform pieces (`platform/*`) importing egressx is legal (same layer, no business dependencies); business domains importing egressx is legal (the one-way product → framework dependency).

## Consequences

- Positive: outbound protection has a single point of reference and a single source of truth for verdicts; timeout, proxy, and rebinding protection policies for adapters/platform pieces are all assembled uniformly through the composition root; all three discovered breaches are closed.
- Negative: the lint tool (banning bare clients) has not landed yet, so anti-corruption clause 1 leans on review for now; IndexNow is not strict egress by default (the self-hosted internal indexer scenario), so its protection posture depends on product injection.
- Revisit point: when adding a new outbound scenario, check it against the exception list; if a fifth kind of injection seam appears (a new outbound shape), extend this ADR's exception table in the same batch.
