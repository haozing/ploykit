# Visitor Analytics: Boundary, and How to Integrate a Third Party

This document is the framework's answer to "should the framework count my
visitors?" — it declares the boundary (what the framework does, what it
deliberately does not), and it is the integration recipe for products that want
a real analytics dashboard. It was written from a visitor-statistics/traffic
walkthrough (2026-10-15) that surveyed how comparable projects split this work.

## What exists today

Three different questions, three different homes:

| Question | Capability | Where |
|---|---|---|
| "Did the crawler come, and what did it get?" | Anonymous traffic counts: `ploykit_traffic_requests{bot,tier,status}` | `platform/metrics` (`Mount.Traffic` + `ClassifyUA`), wired in `example/cmd/app/main.go` around the render handler |
| "Which layer answered this request?" | `X-Renderx-Tier` response header (embed / cache / render / stale / spa / asset / robots / sitemap / error) | `platform/renderx` (`HeaderTier`, `Tier*`) |
| "Are my pages telling engines what they need?" | sitemap.xml + robots.txt + IndexNow + build-time head audit (title fails the build; description/canonical warn) | `platform/renderx` (seo.go) + `example/cmd/render` |

What the traffic counters give you: Googlebot vs. bing vs. AI crawlers vs.
humans, cache-hit vs. on-the-spot render, 2xx/4xx/5xx — from `/metrics`, with
zero storage, zero cookies, zero PII. What they deliberately do NOT give you:
per-page detail, unique visitors, sessions, referrers, trends. Those are the
deferred item below.

The counting middleware is a UA heuristic. It observes; it does not protect.
Crawler classification for access control belongs to the product's edge.

**Counting boundary — what the counters cannot see**: they count requests that
reach this Go process. A CDN or reverse proxy in front caching the HTML
absorbs the repeat traffic before it arrives (the origin only sees cache
misses; a CDN replays the origin's `X-Renderx-Tier` header on its hits, so
tier totals stay coherent but volume is origin-side). Deployments behind a
front cache that need full traffic volume should read the edge's own metrics
alongside `ploykit_traffic_requests`.

## What the framework deliberately does not do

**No built-in visitor analytics product** (page views, UV, sessions,
referrers, dashboards). Surveyed comparables split three ways:

- **Products that embed analytics outsource the backend**: Ghost ships
  built-in member/visitor analytics "powered by Tinybird" — even the
  content product with the strongest motive does not maintain its own
  analytics pipeline. Self-hosted Ghost additionally requires the admin to
  bring a Tinybird account.
- **Platforms that ship analytics do it as a platform product**: Vercel Web
  Analytics is server-first (first page view counted at the edge, daily-rotating
  visitor hash, no cookies) and explicitly excludes bots by UA — it is a
  managed surface of a managed platform, not a framework core.
- **Frameworks leave it to the ecosystem**: Rails core has no analytics; the
  Ahoy gem ("first-party analytics", data in your own DB) is the community
  answer. The Go framework most similar to us (PocketBase) ships none.

Four reasons the same split is right for ploykit:

1. **Not every product needs it.** A pure back-office SaaS has no public
   visitors; only products with a public content surface (aiblog-like) need a
   dashboard at all. A framework core capability must serve all products —
   this one is conditional by nature.
2. **The measurement semantics are product policy.** What counts as a unique
   visitor (daily-salted hash? NAT collapse? logged-in exclusion?), how hard to
   filter bots, how long to retain — each is a product decision with a
   privacy/accuracy trade-off. Baking one answer into the framework means every
   product inherits the wrong ones.
3. **Privacy surface.** The moment the framework stores visitor records it
   owns a GDPR-shaped surface for every product. Anonymous counting (current
   state) is safe; visitor records are not.
4. **Storage and maintenance weight.** Dashboard + storage + aggregation +
   retention is a standing cost on every framework upgrade, the exact
   "unused shelfware" the ROADMAP's trigger discipline exists to avoid.

The architecture does make server-side counting unusually cheap for us (all
traffic flows through one Go process, renderx knows the serving layer) — that
argument justifies the traffic counters above; it does not justify the whole
product. If the trigger fires (see ROADMAP: first product requiring
server-side, third-party-rejecting visitor statistics), the pre-agreed approach
is: renderx-adjacent middleware + daily-salted visitor hash + pgpart daily
table + aggregation worker + a dashboard page, prototyped product-side first.

## Recipe: integrating a self-hosted analytics tool (Umami / Plausible)

For products that want the full dashboard now, the recommended path is an
external tool, cookie-free class (Umami — MIT, self-hostable; Plausible CE —
AGPL-3.0, self-hostable; both no cookies, no personal data, no consent banner
needed). Two integration routes:

**Route 1 — script injection (standard).** The product's frontend loads the
tool's tracker script, which posts to its collect endpoint (Umami: `/script.js`
→ `/api/send` in v2, `/api/collect` in v1; Plausible: `/js/script.js` →
`/api/event` — pin the endpoints against the version you deploy):

- Set the tool's own origin, or better: reverse-proxy a path on your own domain
  (dodges ad blockers and keeps the tracker first-party).
- Script injection goes into the React tree (dynamic `import()` in a client
  effect), NOT into renderx's head directives: `renderx`'s tag fence denies
  `script` in head entries by design (template.go denyTags). A dynamic import
  needs no framework change.
- CSP: a **same-origin reverse proxy needs no CSP change** (the path already
  falls under `default-src 'self'` / `connect-src 'self'` in
  `example/cmd/app/main.go` spaCsp). Only a **cross-origin** deployment needs
  `script-src` / `connect-src` extended with the tool's origin.
- Caveat: crawler traffic is invisible to a script beacon (crawlers don't run
  JS) — that is what the traffic counters above are for; use both.

**Route 1 is wired live in example (GA4, 2026-10-27)** — the reference for any
cross-origin tracker: a `ga4_measurement_id` product-registered settings key
(`settings.RegisterKeys`, non-sensitive so it rides the public `/config`),
a one-shot `bootGA4` DOM injection in `example/web/src/analytics.ts` fired by
a provider-level effect, CSP extended for `googletagmanager.com` /
`*.google-analytics.com` in `example/cmd/app/main.go` (spaCsp), and the four
formerly zero-JS marketing routes re-hydrated — a `hydrate: 'none'` page runs
no effects, so a beacon needs hydration. The measurement ID is
admin-configurable (admin console → System settings → the generic extension
card) with a live `GA4_MEASUREMENT_ID` env fallback.

**Route 2 — server-side event relay (no JS).** Renderx already sees every
request: a middleware (model it on `Mount.Traffic`) can POST an event to the
tool's collect API per request (`/api/send` for Umami v2, `/api/event` for
Plausible — verify against your version). This counts crawlers but needs a
decision on visitor identity (IP + UA forwarded; the tool does its own
hashing). Heavier coupling — take route 1 unless JS is impossible.

Both routes keep the tool's database separate from the product's; no
framework migration is involved.

## Products that outgrow the external tool

Nothing to do until the ROADMAP trigger fires. When it does, the shaped
approach (from the walkthrough) is recorded in docs/ROADMAP.md under
Observability; the prototype lives product-side first (one real product's
semantics), and only then does the framework decide whether to absorb it.
