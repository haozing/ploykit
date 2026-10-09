# ploykit Open-Source Component Selection List

> Principles: **if the standard library can do it, don't add third-party; every dependency must have an irreplaceable rationale.**

---

## 1. Backend (Go)

### 1.1 Decided and unchanged

| Category | Choice | Rationale | Alternatives and why rejected |
|---|---|---|---|
| Routing | **stdlib net/http** (Go 1.22+ ServeMux) | method routing + path parameters are built in; more mature in Go 1.26. Community consensus: default to stdlib for new projects ([discussion on whether chi is still necessary](https://www.reddit.com/r/golang/comments/1v35ugb/is_chi_still_relevant_after_the_improvements_of)) | chi (good middleware, but routing is no longer necessary); gin/echo (batteries-included, violates the minimal-dependency principle) |
| Database driver | **pgx v5** | the de facto Go + PostgreSQL standard; first-class connection pooling, transactions, and type support | database/sql (an abstraction layer that loses pgx's advanced features) |
| Passwords | **argon2id** (golang.org/x/crypto) | OWASP recommended; one parameter set unified across the whole framework | bcrypt (acceptable, but argon2 is more modern) |
| Logging | **slog** (stdlib, Go 1.21+) | structured, zero-dependency, the official standard | zap/zerolog (better performance but an extra dependency; slog suffices) |
| Redis | **redis/go-redis v9** (platform/redisx, with redis_rate) | GCRA rate limiting (implements webx.Limiter) + relayx cross-instance relay + StringCache; silently degrades when env is missing | — |
| UUID | **DB gen_random_uuid() + client-side google/uuid v7 dual track** (platform/ids wraps NewV7/NewV4) | DB-side primary key generation carried over; v7 is time-ordered, already used for client-side cases such as RequestID/event IDs | — |

### 1.2 Adopted (in go.mod, with explicit rationale)

| Category | Choice | Rationale | Where wired |
|---|---|---|---|
| Payments (international) | **[stripe-go](https://github.com/stripe/stripe-go)** (official Stripe SDK) | maintained by Stripe, webhook signature verification built in | `billing/adapters/stripe` (webhook signature parsed in `ParseWebhook`) |
| Payments (planned) | **[gopay](https://github.com/go-pay/gopay)** (Alipay + WeChat aggregation) | the de facto SDK for Chinese payment rails, Apache-2.0. **Planned, not yet added** — unimplemented channels stay out of the repo, no placeholder stubs (the Lago/Kill Bill/Medusa convention) | when a China-market payment initiative starts |
| Email | **[go-mail](https://github.com/wneessen/go-mail)** (SMTP) | a modern, actively maintained mail library, Gomail's successor ([community recommendation](https://github.com/wneessen/go-mail)) | `notify/adapters/email/smtp`, behind the `notify/app.EmailSender` port |
| Test assertions | **[testify](https://github.com/stretchr/testify)** | the de facto Go testing standard, assert/require/suite; saves hand-written if != nil checks | used across framework and product test suites |

### 1.3 Evaluated and not added (rationale on record)

| Category | Not added | Rationale |
|---|---|---|
| Query generation | sqlc | good type safety, but it adds a build step (SQL → codegen); with the framework's query count under control, hand-written SQL + compile-time constant checks suffice. **Re-evaluate if queries ever exceed ~100** |
| ORM | GORM / ent | violates the hand-written SQL principle; neither framework nor products use an ORM, keeping the ecosystem consistent |
| Migrations | golang-migrate / goose | the in-house pgm (~60 lines) already satisfies "embed + auto-run at startup + single sequence"; goose is more mature but is an extra dependency. **Switch to goose if down migrations or version rollback are needed** |
| Config | viper / envconfig | the product's main.go reads from os.Getenv and passes values into constructors; the framework does not care where config comes from |
| Validation | go-playground/validator | domain rules are pure functions (the domain/rules.go pattern); reflection-based validation is unnecessary |
| JWT | golang-jwt | DB sessions consensus (revocable); no JWT |
| DI containers | wire / fx / dig | explicit constructor injection is the most idiomatic Go DI; runtime containers are an anti-pattern |
| Rate limiting | tollbooth / rate | already self-built webx.RateLimit + redisx.GCRA (three settings keys: rate_limit_per_user_per_min / rate_limit_per_ip_per_min / rate_limit_allowlist) |

### 1.4 Dependency budget

**Principle: grow on demand; every dependency must have an irreplaceable rationale; currently 29 direct dependencies — go.mod is authoritative.**

```
Initial five: pgx v5 (database) / x-crypto (argon2) / stripe-go (payments, international) /
              go-mail (SMTP) / testify (testing)
Landed with platform capabilities: river (transactional events/scheduled delivery, ADR 0003) / wazero +
              quickjs fork (renderx sandbox) / esbuild (SSR bundle) / otel +
              prometheus (metrics) / aws-sdk-go-v2(S3) (storagex) / robfig/cron
              (cronx) / go-redis + redis_rate (redisx rate limiting/relay) / google/uuid v7
              (platform/ids) / gorilla websocket+csrf (wsx/CSRF) / go.yaml.in/yaml
              (contractx) / golang.org/x/sync (singleflight)
(gopay is a planned item for China-market payments, not yet added)
```

---

## 2. Frontend (React)

### 2.1 Decided (user-specified)

| Category | Choice |
|---|---|
| UI framework | React 19 |
| Build | Vite |
| CSS | Tailwind v4 (CSS-first config) |
| Component base | Base UI (@base-ui/react) |

### 2.2 Adopted (with rationale)

| Category | Choice | Rationale | Notes |
|---|---|---|---|
| Routing | **react-router v7** | de facto standard; file-convention routing is a thin layer on top of it | |
| Data fetching | **TanStack Query v5** | caching/retry/optimistic updates/invalidation management; replaces hand-written useEffect+fetch | used inside framework hooks; product code uses it too |
| Forms | **react-hook-form** | best performance (uncontrolled), largest ecosystem | used for login/registration forms |
| Validation | **zod** | TypeScript-first schemas; integrates with react-hook-form (@hookform/resolvers) | also usable for API response validation |
| Icons | **lucide-react** | lightweight, tree-shakeable, a Tailwind-ecosystem staple | |

### 2.3 Not added (rationale on record)

| Category | Not added | Rationale |
|---|---|---|
| HTTP client | axios | native fetch + cookie authentication suffices; wrapped by the useApi hook |
| Global state | zustand / jotai / redux | framework state uses React Context (auth/workspace/billing); product state is the product's choice, the framework does not prescribe |
| UI component libraries | shadcn/ui / Ant Design / MUI | Base UI is the headless base; styled components are built by @ploykit/ui itself (Tailwind + Base UI); no full component library is introduced |
| Tables | TanStack Table | Admin tables are hand-written for now; products choose their own when they need heavy tables |
| Charts | recharts | the Admin finance panel has no charts for now; pick one when needed |
| CSS-in-JS | styled-components / emotion | no second styling system is needed beyond Tailwind |
| i18n | i18next | bilingual (zh/en) uses lightweight dictionaries + a parity test; adopt heavier i18n when that need appears |

### 2.4 Dependency budget

**@ploykit/ui dependencies (verified from packages/ui/package.json, 11 packages):**

```
peer: react / react-dom / react-router / @tanstack/react-query / tailwindcss (configured on the product side)
1. @ploykit/client                 ← API+WS client
2. @ploykit/runtime                ← isomorphic contract of the render directive channel
3. @base-ui/react                  ← component base
4. react-hook-form                 ← forms
5. @hookform/resolvers             ← zod ↔ react-hook-form binding
6. zod                             ← validation
7. lucide-react                    ← icons
8. sonner                          ← toasts (Base UI has no official toast component)
9. class-variance-authority + clsx + tailwind-merge ← the cva-variant + cn class-merge trio
```

---

## 3. Build vs. Adopt: Decision Criteria

| Question | Build | Adopt open source |
|---|---|---|
| Does it involve business semantics? (login, quota, audit) | ✅ | |
| Is it a pure technical utility? (payment protocols, email protocols) | | ✅ |
| Does it need to stay consistent across products? | ✅ | |
| Does the community maintain it better than we would? | | ✅ |
| Is the replacement cost low? | ✅ (interface isolation) | ✅ (adapter pattern) |

**Wrapper rule when adopting open-source components**: all external dependencies must sit behind interface isolation (e.g. the `EmailSender` interface wrapping go-mail — SMTP/Resend/SES stay swappable, so products are not locked in); product code never imports third-party packages directly — when the framework upgrades or swaps a library, only the adapter changes.

---

## 4. Supplementary Selection Guidance

### 4.1 Feasibility of adding libraries later

| Component | Can it be added later? | Path | Constraints |
|---|---|---|---|
| **shadcn/ui** | ✅ zero friction | the CLI copies source into the product project; zero conflict with the framework (same base: Base UI + Tailwind) | product pages and framework pages sharing Tailwind tokens is enough to keep visuals consistent |
| **TanStack Table** | ✅ zero friction | `npm install`; a product-level choice; headless, tied to no UI library | the framework's built-in Admin tables stay simple and hand-written; not introduced |
| **golang-jwt (adding API tokens)** | ✅ easy | implement the `PATLookup` interface, product-side code, no framework change | none |
| **golang-jwt (replacing DB sessions)** | ⚠️ feasible, at a cost | implement the `SessionStore` interface | loses instant revocation and the session list — the core reason DB sessions were chosen in the first place; worth switching only for pure-API, no-browser scenarios |

### 4.2 Hand-written SQL vs sqlc: decision basis (revised)

Fact: the two approaches each have their fit — large projects with fixed query shapes commonly use sqlc; small/mid-size projects are more direct hand-writing SQL. This is scenario matching, not right versus wrong.

**Three reasons the framework hand-writes:**
1. **A high share of dynamic queries**: multi-tenant filters (`workspace_id = $1 AND ($2 IS NULL OR status = $2)`), dynamic ordering, and combined pagination are everywhere in the framework — sqlc handles these either through a variant matrix or by falling back to string concatenation, both more convoluted
2. **Zero toolchain for consumers**: a product running `go get ploykit` needs no sqlc install and no codegen run; framework query changes ship directly with a release
3. **Moderate query count** (about 50-100): sqlc's type-safety payoff becomes significant at 200+ fixed-shape queries; at moderate scale it does not cover the tooling cost

**Product side not prescribed**: products with > 200 fixed-shape queries should use sqlc; the framework does not block that.

| Query profile | Recommendation |
|---|---|
| < 100 queries, varied shapes (many filter/sort combinations) | hand-written |
| > 200 queries, fixed shapes (by-ID lookups / fixed lists) | sqlc |
| unsure | hand-write first; migrate to sqlc when it hurts (migration cost is manageable: file-by-file replacement) |
