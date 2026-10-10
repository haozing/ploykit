# ploykit Page Implementation Design (App Pages Blueprint)

> Scope ruling: **international school only**; **no compatibility or legacy-data concerns** (endpoints can be shaped directly, migrations get no backfills);
> frontend **maximizes use of official Base UI components and recommended usage**; backend **follows Go standard library conventions**.
> Related docs: `docs/architecture.md` (backend structure), `docs/component-selection.md`, `docs/adr/0001`.

---

## 1. Scope Rulings and Current Status

### 1.1 Explicit Non-goals

| Item | Ruling | Rationale |
|---|---|---|
| Full domestic admin-school feature set (five-tier data permissions, tenant plans, menu management, code generation, form builders) | Not doing | ploykit's permission model is the international school: org-role + permission points (authz); the two semantics cannot coexist |
| SSO/SAML configuration pages, SCIM, org domain claiming | Read-only overview built (admin SSOPage + GET /api/admin/sso); create/update/delete expansion parked (trigger conditions in docs/ROADMAP.md) | WorkOS/Clerk's Admin Portal is a standalone product-grade effort |
| 2FA/TOTP | Deferred (see the §6.3 shape reservation) | Requires the full enrollment/challenge/recovery-code chain; identity's `auth_challenge` needs an extra kind; the payoff does not rank above this round of pages |
| SMTP management page | Not doing | Email config comes from environment variables (12-factor); credentials never touch the database; `notify/adapters/email/smtp` already suffices |
| Organization ownership transfer flow | Implemented (transfer-ownership with dual entry points: member self-service + admin; BeforeOwnerChange(Val)/OnOwnerTransfer(Obs) hooks) | Complements last-owner protection (transfer is an active ownership change; protection is a passive backstop) |
| Database-stored i18n | Not doing | Keep the existing convention of "copy as props + products opt into i18next" |

### 1.2 Current Status

- **The backend API surface covers the page data needs**: identity (auth/sessions/PAT/OAuth GitHub+Google full set),
  workspace (members/invitations/share links/delete & update), billing (plans/checkout/orders), notify (inbox), quota
  (usage), webhooks (CRUD + deliveries), audit (filtered queries + CSV export), admin (operations endpoints + platform-level audit export)
  are all mounted and guarded by authz (evidence: `audit/adapters/http/routes.go`;
  `identity/adapters/http/routes.go:44-45` for the OAuth start/callback pair; `/config` returns `oauth_providers`
  via `platform/webx/config.go`, wired in `example/cmd/app/main.go`).
- **Backend gaps are zero**: single-session revocation (`DELETE /auth/sessions/{id}`),
  account deletion (`DELETE /auth/me`), and notification preference storage (`notification_preference` table + two endpoints)
  exist (migrations 018/019); impersonation exists (`POST /api/admin/users/{id}/impersonate`, migration 034).
- **Frontend pages are at full complement**: in `packages/ui/src/pages/`, auth (register/forgot password/reset/verify email/invite accept, 5 pages),
  account (profile/security/PAT/notification preferences, 4 pages), workspace (general/members/audit/usage/billing/success redirect/scheduling/webhooks, 8 pages),
  admin (11 pages, see the §2.1 placement note) are all in place; example routes are wired (/account/*, /settings/workspace/*,
  /admin, including /settings/workspace/schedules); the source of truth is `example/web/src/routes.tsx`.
- **No known rough edges**: `queryKeys.notifications` is a tuple, `LoginPage` success navigation is an `onSuccess` prop, the full admin suite
  runs on react-query inside the ui package, and `WorkspaceSwitcher` runs on Base UI Menu.

---

## 2. Information Architecture and Routing

Four shells (AuthShell / AppShell / SettingsShell in `packages/ui/src/layouts/`, AdminShell in `pages/admin/`).
All routes are SPA routes declared product-side via the `routeTable` helper from `@ploykit/runtime` (react-router v7 underneath):

```
AuthShell (centered card, no navigation)
├── /login                LoginPage        (code / password dual Tab + social button slots)
├── /register             RegisterPage
├── /forgot-password      ForgotPasswordPage
├── /reset-password       ResetPasswordPage
├── /verify-email         VerifyEmailPage
└── /invitations          InviteAcceptPage (my invitations list with accept/decline)

AppShell (the sidebar app shell)
├── /app                  Dashboard (product page; OnboardingChecklist is available as a ui component to embed)
├── /account/...          account settings group (SettingsShell layout, see below)
├── /settings/...         workspace settings group (SettingsShell layout, see below)
└── /admin                AdminShell + admin pages (platform console, is_platform_admin only)

Standalone return page
└── /billing/success      BillingSuccessPage (BILLING_SUCCESS_URL points here)
```

`SettingsShell` is a layout component in `packages/ui`: it renders secondary navigation inside the `AppShell` content area
(an "account" group: profile/security/notifications/PAT at `/account/*`; a "workspace" group:
general/members/audit/usage/billing/webhooks/schedules at `/settings/workspace/*`).
The nav-item array is prop-driven, so products can add or remove entries. **URL is the navigation** (route splitting, not Tabs state);
Base UI Tabs is only for small in-page switches (login method, members/invitations tabs).

### 2.1 Menu IA (role-driven)

Current IA rules:

1. Main navigation and settings share one sidebar shell; in settings mode the sidebar content switches to
   a back entry ("back to product") plus grouped nav lists.
2. Account settings are global scope at `/account/*` (independent of the workspace switcher); workspace settings are
   tenant scope at `/settings/workspace/*` — two settings roots.
3. The platform admin console is physically isolated at `/admin` with its own layout (AdminShell), never inside
   product or settings navigation; its entry renders only for `is_platform_admin`.
4. Per-item gating is hidden-first: `SettingsNavItem.perm` maps to the authz role tiers and is judged from
   `PKWorkspace.role`; ploykit simplifies to "hidden" only (the disabled scenario is covered by backend 403 copy).
5. Menu visibility is UX only — every endpoint re-verifies server-side (authz.Require).

**Menu tree** (as wired in `example/web/src/routes.tsx`):

```
AppShell main sidebar (product area)
├── Overview /app
├── Product feature pages… (example: realtime)
└── [bottom] Workspace switcher · User menu (with the "account settings" entry)

Settings mode (sidebar content switches under /account/* and /settings/*)
├── Workspace group (header shows the current workspace = the switcher)
│   ├── General  /settings/workspace/general   visible to all; delete is owner-only
│   ├── Members  /settings/workspace/members   visible to all; invite/role/remove → admin+
│   ├── Usage    /settings/workspace/usage     all members
│   ├── Billing  /settings/workspace/billing   readable by all; checkout/cancel → admin+ (billing:manage)
│   ├── Webhooks /settings/workspace/webhooks  viewing for all; manage → admin+ (webhooks:manage)
│   ├── Schedules /settings/workspace/schedules visible to all; manage → admin+
│   └── Audit    /settings/workspace/audit     admin+/owner (built-in member lacks audit:read) → hidden from member
├── Account group (global, unaffected by the switcher)
│   ├── Profile             /account/profile
│   ├── Security            /account/security
│   ├── Access tokens       /account/tokens
│   └── Notification prefs  /account/notifications
└── Platform admin group (is_platform_admin only)
    └── Admin console → /admin (separate surface)

Admin console /admin (standalone layout, not inside the AppShell product shell)
└── Overview · Users · User detail · Workspaces · Workspace detail · Orders ·
    Webhook deliveries · Audit · SSO · System settings
```

> Placement note: all admin console pages (shell + overview/users/user detail/workspaces/workspace detail/orders/
> webhook deliveries/audit/SSO/system settings, 11 pages) and the site-config consumption surface
> (useSiteConfig + SiteBannerLayer + the RegisterPage invitation-mode hint) live in `@ploykit/ui`
> (pages/admin + hooks + components); the product side only mounts them in routes.tsx
> and passes brand copy. Framework-domain pages belong to the ui package (same convention as SchedulesPage).

**Role × settings-item matrix** (consistent with authz's built-in three-tier explicit sets: owner⊇admin⊃member; the frontend `perm`
field is judged from `PKWorkspace.role`, while server-side authz.Require already enforces per endpoint — visibility is UX, not security):

| Settings item | member | admin | owner | Backing permission point |
|---|---|---|---|---|
| General | read | rename | rename + delete | workspace:update / workspace:delete |
| Members | read-only list | invite/remove/change role | same as admin | members:read/write/invite/remove |
| Usage | visible | visible | visible | usage:read |
| Billing | read-only | checkout/cancel | same as admin | billing:read / billing:manage |
| Webhooks | read-only subscriptions | manage | manage | webhooks:read / webhooks:manage |
| Audit | **hidden** | visible | visible | audit:read |
| Four account pages | visible | visible | visible | user-global, no workspace role (RequireHuman) |
| Admin console | hidden | hidden | hidden | is_platform_admin only (independent of workspace roles) |

**Current wiring**: `/auth/me` and `PKUser` expose `is_platform_admin` (entry visibility); `SettingsNavItem` carries an optional
`perm?: 'owner'|'admin'` (default: visible to all) and `SettingsShell` filters by `useWorkspace().current?.role` via `roleSatisfies`;
the account group lives at `/account/*` with no legacy-route redirects (zero-compatibility ruling); the settings sidebar gains a
back-to-product entry; the main sidebar carries product pages only; `/admin` renders behind `RequirePlatformAdmin` in its own layout.

---

## 3. Page Inventory Master Table

Legend: `=existing` reuses a ready-made endpoint.

| # | Page | Route | Data source | Key Base UI parts |
|---|---|---|---|---|
| 1 | Register page | /register | `POST /auth/register` | Field, Input, Button |
| 2 | Login page | /login | `=existing` (incl. OAuth start/callback and /config `oauth_providers`) | Tabs, Field, Button |
| 3 | Profile | /account/profile | `PATCH /auth/me`, `POST /auth/send-verification`, `DELETE /auth/me` `=existing` | Field, Badge, AlertDialog |
| 4 | Account security | /account/security | `POST /auth/change-password`, `GET/DELETE /auth/sessions`, `DELETE /auth/sessions/{id}` `=existing` | Field, DataTable, AlertDialog, Badge |
| 5 | PAT management | /account/tokens | `GET/POST /api/tokens`, `DELETE /api/tokens/{id}` `=existing` | DataTable, Dialog, SecretModal |
| 6 | Member management | /settings/workspace/members | `/api/workspaces/{id}/members|invitations|share-links` full set `=existing` | Tabs, DataTable, Select, Menu, Dialog, Avatar |
| 7 | Workspace general | /settings/workspace/general | `PATCH/DELETE /api/workspaces/{id}`, `POST .../leave` `=existing` | Field, AlertDialog, ImpactConfirmation |
| 8 | Invite accept | /invitations | `GET /api/invitations/mine`, `POST /api/invitations/{id}/accept|decline` `=existing` | DataTable, Button |
| 9 | Onboarding checklist | embeddable card (products choose where) | infers steps from existing state (pure frontend) | Card (in-house), Progress |
| 10 | Workspace audit | /settings/workspace/audit | `GET /api/audit`, `GET /api/audit/export.csv` `=existing` | DataTable, Input, Badge |
| 11 | Usage | /settings/workspace/usage | `GET /api/usage` `=existing` | Progress, Badge |
| 12 | Billing | /settings/workspace/billing | `GET /api/billing/{plans,subscription}`, `POST /api/billing/checkout`, `POST /api/billing/orders/{id}/cancel` `=existing` | DataTable, Switch, Badge |
| 13 | Payment return | /billing/success | polls `GET /api/billing/subscription` | Skeleton, toast |
| 14 | Notification preferences | /account/notifications | `GET /api/notification-types` (catalog), `GET/PUT /api/notification-preferences` `=existing` | Switch, DataTable |
| 15 | Webhooks | /settings/workspace/webhooks | webhooks full set `=existing` | Switch, DataTable, SecretModal |
| 16 | Operations console | /admin | `/api/admin/*` `=existing` (incl. impersonate) | DataTable+pagination, Select, AlertDialog |
| 17 | Scheduling management | /settings/workspace/schedules | `/api/schedules` CRUD + preview `=existing` (schedule domain, migration 037) | Switch, DataTable, Dialog |

The inbox (NotificationBell) already exists and gets no standalone page; "recent notifications" reuses the same query as an optional tab on the notification preferences page.
For per-page **content-area structure and reference-file mapping**, see §4.5.

---

## 4. Frontend Design

### 4.1 Package Structure and Naming Conventions (packages/ui)

```
packages/ui/src/
├── components/
│   ├── ui/                  # Base UI wrapper layer — always lowercase filenames (shadcn convention);
│   │                        # Button.tsx / Badge.tsx / Input.tsx are legacy capitalized holdovers
│   │   ├── button/badge/input/dialog/sheet/tooltip/separator/skeleton/sidebar
│   │   ├── breadcrumb/card/empty/label
│   │   ├── field.tsx        # adapted from the official bases/base/ui/field.tsx (styled-div system)
│   │   ├── tabs / switch / select / checkbox / menu / alert-dialog / avatar / progress / popover
│   ├── (business components, PascalCase) UserMenu / OnboardingChecklist / DataTable / ConfirmDialog /
│   │                        SecretModal (+ ImpactConfirmation) / NotificationBell / ImpersonationBanner /
│   │                        SiteBanner + SiteBannerLayer / SettingsCard / CronInput / FormField /
│   │                        Page (PageHeader/PageLoading/PageEmpty/PageError) / toast
├── pages/
│   ├── LoginPage.tsx / LandingPage.tsx    # pages/ root
│   ├── auth/                # RegisterPage / ForgotPasswordPage / ResetPasswordPage /
│   │                        # VerifyEmailPage / InviteAcceptPage
│   ├── account/             # ProfileSettingsPage / SecuritySettingsPage / TokensPage /
│   │                        # NotificationPreferencesPage (account group root /account/*)
│   ├── workspace/           # MembersPage / WorkspaceGeneralPage / WorkspaceAuditPage /
│   │                        # UsagePage / BillingPage / BillingSuccessPage / WebhooksPage /
│   │                        # SchedulesPage
│   ├── admin/               # AdminShell + shared.ts + overview/users/user detail/workspaces/
│   │                        # workspace detail/orders/webhook deliveries/audit/SSO/system settings
│   │                        # (shell + 10 pages)
│   └── billing/             # empty placeholder directory (the billing page lives in pages/workspace/)
├── layouts/                 # AppShell.tsx / AuthShell.tsx / SettingsShell.tsx
├── hooks/ provider/ lib/    # data hooks, PloykitProvider (queryKeys), ws-query-bridge, utils
├── realtime.ts              # default /ws URL builder for WsClient
└── index.ts                 # the single public exit; barrel export
```

Rules:
1. **`components/ui/` does exactly two things**: apply design tokens to Base UI parts (Tailwind utility classes + `data-slot`) and add cva variants. It never changes official DOM structure or default behavior — a11y, keyboard, and focus management are all trusted to Base UI.
2. **File naming**: Base UI wrappers = lowercase; in-house business components/pages = PascalCase. (`Button.tsx`/`Badge.tsx`/`Input.tsx` predate the convention and keep their names; products import from the barrel, so this is invisible.)
3. Page components follow the existing "re-skin" model: all copy is prop-driven (with zh-CN defaults) so products can copy whole files and adapt them; logic always settles into hooks, and pages only do layout and wiring.

### 4.2 Base UI Usage Rules (official recommended approach)

```tsx
// Wrapper pattern (consistent with the existing dialog.tsx/tooltip.tsx):
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

const Tabs = TabsPrimitive.Root;                       // pass-through
const TabsList = ({ className, ...props }) => (
  <TabsPrimitive.List data-slot="tabs-list" className={cn('...', className)} {...props} />
);
```

- **Import by module path**: `@base-ui/react/menu`, `@base-ui/react/select`, ... consistent with existing code (package name `@base-ui/react` ^1.8.0 — note, not `@base-ui-components/react`).
- **Polymorphism/custom elements** use the official `useRender` + `render` prop (sidebar.tsx demonstrates it); no third-party polymorphic libraries.
- **Forms**: the Field system follows the official `bases/base/ui/field.tsx` — a **styled-div system**
  (FieldSet/FieldGroup/Field/FieldLabel/FieldTitle/FieldDescription/FieldSeparator, paired with Label),
  not the Root/Control components of `@base-ui/react/field` (the login-02 block's FieldSeparator does come from that);
  control and validation remain with react-hook-form + zod (`useZodForm`). `FormField` keeps its props API
  and is internally implemented on that Field system.
- **Overlay-type parts** (Menu/Select/Popover/AlertDialog) always use Portal + the official Positioner/Popup; no in-house positioning.
- **Toast stays on sonner** (Base UI has no official toast part); **DataTable is in-house** (Base UI has no table) — pagination only, no table-library swap.
- Every wrapper ships with a vitest smoke test (render + trigger one primary interaction), in the same style as the existing `form.test.tsx`.

### 4.3 Data Layer Conventions

**Full queryKeys table** (maintained centrally in `PloykitProvider.tsx`):

```ts
export const queryKeys = {
  auth: ['auth'] as const,
  me: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  tokens: ['auth', 'tokens'] as const,
  workspace: ['workspace'] as const,
  workspaceList: ['workspace', 'list'] as const,
  members: (wsId: string) => ['workspace', wsId, 'members'] as const,
  invitations: (wsId: string) => ['workspace', wsId, 'invitations'] as const,
  shareLinks: (wsId: string) => ['workspace', wsId, 'share-links'] as const,
  myInvitations: ['workspace', 'my-invitations'] as const,
  audit: (wsId: string, q: object) => ['audit', wsId, q] as const,
  usage: (wsId: string) => ['usage', wsId] as const,
  billing: ['billing'] as const,
  billingSubscription: (wsId: string) => ['billing', 'subscription', wsId] as const,
  billingPlans: ['billing', 'plans'] as const,
  notifications: ['notifications'] as const,          // tuple: usable as an invalidation prefix
  notificationPrefs: ['notifications', 'preferences'] as const,
  webhooks: (wsId: string) => ['webhooks', wsId] as const,
  admin: ['admin'] as const,
};
```

**WS invalidation bridge** (`bridgeWsToQuery` in `lib/ws-query-bridge.ts`, exported from the barrel): the product owns a
`WsClient` and registers `WsInvalidationRule`s (frame-type `match` + `invalidate` query-key prefixes); a matching frame
invalidates the registered keys, and a reconnect (after the first open) invalidates all of them. The example registers its
product rule in `RealtimePage` (`task.created` → `['tasks']`, `['usage']`).

The server does not yet emit notification/member/usage/webhook frames, so the frontend registers no rules for them
(graceful degradation: NotificationBell polls at 60s; pages expose manual refresh). When the server starts broadcasting a
frame, register a rule for it, e.g.:

| Future WS frame | Invalidation prefix |
|---|---|
| `notification.created` | `['notifications']` |
| `member.changed` | `['workspace', wsId, 'members']` |
| `usage.updated` | `['usage', wsId]` |
| `webhook.delivery.updated` | `['webhooks', wsId]` |

**One zod schema per page**: all write-operation forms use `useZodForm`, with schemas aligned to the backend `webx.DecodeJSON`
DisallowUnknownFields semantics (declare only the fields the page actually submits).

### 4.4 Common UX Conventions (all reuse existing parts)

- Loading = `PageLoading`/Skeleton; error = `PageError` (with retry); empty = `PageEmpty`.
- Destructive actions = `useConfirm` (internally on AlertDialog); actions needing a consequences list = `ImpactConfirmation`.
- One-time secret display = `SecretModal` (PAT plaintext, share links, webhook secrets).
- Success feedback = `toast.success`, at most one per screen.
- 401 is judged uniformly by `PloykitProvider`'s `GET /auth/me`; pages carry no second round of auth logic. 403 shows
  copy matching the `E_FORBIDDEN` semantics (insufficient permission); 404 (the anti-enumeration 404 for workspaces renders "does not exist" the same way).

---

### 4.5 Per-Page Layout References (content-area structure, drawing on mature implementations)

Reference repos (all public open-source repositories):

| Reference repo | Role | Key paths |
|---|---|---|
| **`ui`** (the official shadcn-ui/ui repo) | **Primary blueprint: the official Base UI-powered shadcn source, the single source for controls**. `registry/bases/` hosts three variants side by side — `base`/`aria`/`radix`; **consume only `base/`; the `radix/` directory is off-limits** | `apps/v4/registry/bases/base/ui/` (**60 components** of source: field/select/switch/tabs/dropdown-menu/alert-dialog/avatar/progress/pagination/table/card/empty/spinner…) + `bases/base/blocks/` (**31 full-page blocks**: login-01..05, signup-01..05, sidebar-01..16, dashboard-01); official docs `/docs/components/base/*`; `apps/v4/examples/base/` is the companion demo |
| **`shadcn-admin`** (satnaing) | **Layout** reference from a mature admin template: settings-area secondary nav, users/tasks data pages. ⚠️ Radix project — look only at DOM/className/information hierarchy; zero control reuse | `src/features/{settings,users,tasks,dashboard}/` |
| **`formbricks`** (open-source survey SaaS) | **Layout** reference of the settings area in a real production SaaS: SettingsCard, members/billing/notifications pages. ⚠️ Same as above; Radix project used for layout reference only | `apps/web/modules/settings/components/`, `apps/web/app/(app)/organizations/[organizationId]/settings/`, `modules/ee/billing/components/pricing-table.tsx` |

(supastarter claims Base UI but is commercially closed-source, so it is not used as a reference. `boxyhq/saas-starter-kit`,
`wasp-lang/open-saas`, and `svix-webhooks` can serve as flow references.)

#### 4.5.1 Official Base UI blocks layouts (copy these first)

**Login/register** (`bases/base/blocks/login-01`, `login-02`, `signup-01`):

```tsx
// login-01/page.tsx — auth page shell (the implementation spec for AuthShell)
<div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
  <div className="w-full max-w-sm"><LoginForm/></div>   // card content laid out directly with Card or Field
</div>

// login-02's official OAuth section layout (LoginPage follows it; align the details)
<FieldSeparator>Or continue with</FieldSeparator>       // the separator from the Field family
<Button variant="outline" type="button">… Login with GitHub</Button>
```

**App shell top bar** (`blocks/sidebar-07/page.tsx`) — the blueprint for AppShell's top bar
(AppShell already renders a breadcrumb tail via its `breadcrumbTail` prop; the framework ships `components/ui/breadcrumb.tsx`):

```tsx
<header className="flex h-16 shrink-0 items-center gap-2
                   transition-[width,height] ease-linear
                   group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
  <div className="flex items-center gap-2 px-4">
    <SidebarTrigger className="-ml-1"/>
    <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto"/>
    <Breadcrumb>…</Breadcrumb>          // breadcrumb in the top bar
  </div>
</header>
<div className="flex flex-1 flex-col gap-4 p-4 pt-0">…content area…</div>
```

**Workspace switcher / user menu** (`sidebar-07/components/team-switcher.tsx`, `nav-user.tsx`) —
the official implementations behind WorkspaceSwitcher and UserMenu: `DropdownMenu` + `SidebarMenuButton size="lg"`,
trigger via `render={<SidebarMenuButton/>}` (the official Base UI polymorphic idiom), active state `data-open:bg-sidebar-accent`,
switcher body a `DropdownMenuCheckboxItem` list plus a bottom "Create workspace" item.

**Dashboard** (`blocks/dashboard-01`): `site-header` (Trigger+Separator+Breadcrumb) →
`section-cards` (metric card row) → `chart-area-interactive` → `data-table`; with the companion `data.json` demo data shape.

#### 4.5.2 Radix Removal Ruling

**Bans (code level, long-term)**:
1. Installing any `@radix-ui/*` dependency is banned (currently zero: the package.json files of `packages/ui` and `example/web`
   carry only `@base-ui/react ^1.8.0`).
2. The `asChild` polymorphic idiom is banned; always Base UI `render={<Component/>}`.
3. `data-state=open/closed` (Radix interaction-state markers) is banned; always `data-open:`/`data-closed:`.
4. Reference projects (shadcn-admin, formbricks, bases/radix/) are **layout-only reading** (DOM structure, className,
   information hierarchy, state design); control source comes solely from `bases/base/ui/`; no Radix→Base UI translation.

**Difference table (only for understanding layouts while reading Radix reference projects; not landing rules)**:

| Dimension | Radix version (what you will see in reference projects) | Base UI version (ploykit landing) |
|---|---|---|
| Open/close state selectors | `data-state=open/closed` | `data-open:` / `data-closed:` |
| Polymorphic rendering | `asChild` | `render={<Component/>}` |
| Portal positioning | `Portal + Content` | `Portal + Positioner + Popup` |
| Sidebar state | custom `data-state` | `data-[collapsible=icon]` / `data-[side=left/right]` + `group-data-*` (the official base-variant sidebar source itself writes `data-state`; ploykit translates it into the collapsible system per the bans when replaying, rather than copying verbatim) |

**Official Base UI acquisition surface**: the blocks site previews new-york-v4 by default (the Radix style path
`/r/styles/new-york-v4/*.json`); the Base UI variant has no page toggle, and its authoritative sources are the local
`bases/base/{ui,blocks}/` and the official docs `/docs/components/base/<component>`; the CLI's variant (`npx shadcn@latest
add <name>`) is decided by picking primitives at init time, with no `--base` flag — products going through the CLI
must pick Base UI at init. ploykit itself does not use the CLI (source files are taken directly from the official `bases/base/`).

#### 4.5.3 shadcn-admin layouts (settings area and data pages)

**Settings area skeleton** (blueprint `features/settings/index.tsx` + `sidebar-nav.tsx` + `content-section.tsx`,
i.e. the implementation spec for `SettingsShell`):

```
Main fixed
├─ h1 text-2xl md:text-3xl font-bold tracking-tight + p text-muted-foreground
├─ Separator my-4 lg:my-6
└─ flex flex-col lg:flex-row lg:space-x-12
    ├─ aside lg:sticky lg:w-1/5 → SidebarNav: Link + buttonVariants ghost,
    │    active state bg-muted, justify-start; degrades to a Select on narrow screens
    └─ Outlet → ContentSection{title, desc}: h3 + Separator my-4 + form area lg:max-w-xl
```

**Generic data-page skeleton** (blueprint `features/users/index.tsx`): title row (`h2` + muted description, primary action button on the right,
i.e. the existing `PageHeader`) → DataTable → dialog cluster managed centrally within the page. **Table and row actions**
(`users-columns.tsx` / `data-table-row-actions.tsx`): select column → body columns (LongText truncation) →
status Badge (outline + palette) → role column (icon + text) → row-actions column (three-dot ghost button + Menu `modal={false}`
`align=end w-40`, dangerous items `text-red-500`).

**Settings-page form pattern** (`notifications-form.tsx`): RHF+zod, a single form for the whole page; field block = Label + control +
Description; **switch row = `flex flex-row items-center justify-between rounded-lg border p-4`**
(label + desc on the left, Switch on the right; forced items get `disabled + aria-readonly`); a single submit button at the page bottom.

#### 4.5.4 formbricks layouts (a real SaaS's settings/members/billing)

**SettingsCard pattern** (`modules/settings/components/settings-card.tsx`) — the block unit for ploykit settings pages
(better suited to "general / danger zone" sectioning than a page-wide mega form):

```
<div class="my-4 w-full max-w-4xl rounded-xl border bg-card py-4 text-left shadow-xs">
  <div class="flex justify-between border-b px-4 pb-4">
    <div><h4 title/><Badge beta|soon?/><p small description/></div>
    {cta}                                  // top-right action button (Invite / Manage billing)
  </div>
  <div class={px-4 pt-4 | none(padding) | -mb-4(flush)}>{children}</div>   // three bodyVariant tiers
</div>
Page recipe: PageContentWrapper(min-h-full space-y-6 p-6) > PageHeader > stacked SettingsCards
```

**Member management** (`modules/organization/settings/teams/components/`): SettingsCard(flush) →
top action row (invite button / leave button) → **members and pending invitations merged into one table** (columns: name 15% / email 22% / role 15% (the role
Select is editable only by owner/manager) / last login 13% (sortable header) / status Badge 13% / actions 22% right-aligned —
resend/revoke/delete); invite dialog = Dialog + TabToggle (single/bulk) + RHF+zod.

**Billing page** (`modules/ee/billing/components/pricing-table.tsx`): current plan card (Badge × 3: plan name/
billing interval/in trial + the per-dimension usage bar UsageCard) → plan picker card: interval toggle pill (`w-fit rounded-xl
border bg-muted p-1`, selected `bg-primary text-primary-foreground`) → `grid gap-4 lg:grid-cols-3`
plan cards (badge row / big-number price / full-width CTA / `ul space-y-3 border-t pt-6` feature list; the pro card adds
`border-primary/20`) → a contact-sales strip at the bottom.

**Notification preferences** (`settings/account/notifications/`): SettingsTable (header `bg-muted` row + built-in skeleton rows +
empty state); columns = event name 45% / scope 30% / switch 25% (centered Switch), with Tooltip explanations on headers.

**Sidebar nav active state** (`SettingsSidebarContent.tsx`): uppercase micro-labels per section (`text-xs uppercase
tracking-wider text-muted-foreground`) + `ul` list items `border-r-4 border-r-transparent`,
active `border-brand bg-muted font-semibold`; disabled items explain why via Tooltip.

#### 4.5.5 Per-page mapping table

| ploykit page | Official Base UI block (first choice) | Supplementary reference | Content-area structure essentials |
|---|---|---|---|
| /login | `login-01` (shell) + `login-02` (OAuth section) | shadcn-admin `sign-in` | min-h-svh centered max-w-sm; FieldSeparator + outline OAuth buttons |
| RegisterPage | `signup-01` | login-02-style OAuth section | same as above + password strength hint |
| Dashboard /app | `dashboard-01` | shadcn-admin `dashboard` | Onboarding card → section-cards metric row → main table/chart |
| SettingsShell | `sidebar-07` (shell + top bar) | shadcn-admin `settings` | h1+Separator+1/5 side nav+Outlet; degrades to Select on narrow screens |
| Profile/security/notifications/PAT | — | shadcn-admin `settings/*` + formbricks SettingsCard | ContentSection/SettingsCard + field blocks/switch rows |
| Member management | — | formbricks teams + shadcn-admin users | title row + invite button → merged member/invite table → dialog cluster |
| Workspace general | — | formbricks general | SettingsCard form + danger-zone card (red-titled heading + impact list) |
| Workspace audit | — | shadcn-admin users table skeleton | filter row (action/actor/date/CSV export) → DataTable + offset pagination |
| Usage | `dashboard-01` section-cards | formbricks UsageCard | metric card grid: key + Progress + `-1 unlimited` badge |
| Billing | — | formbricks pricing-table | current plan card (Badge×3 + usage) → interval pill → plan card grid → orders table |
| Webhooks | — | shadcn-admin tasks row actions | subscriptions table (Switch + row-action Menu) → deliveries table (status Badge + redeliver) |
| Operations console /admin | `dashboard-01` + `sidebar-07` | shadcn-admin users | metric card row → Tabs → paginated table + row actions |
| Invite accept /invitations | `login-01` shell | formbricks SettingsCard | centered card + list rows (workspace/role/expiry + accept/decline) |

**Control landing rules**: for all Base UI wrappers (the §4.1 list), the **source base is taken directly from the same-named files in
`bases/base/ui/`** (60 components fully covering the §4.1 plan plus spares like radio-group/pagination/table);
the adaptation = keep DOM/class names/data-slot, and repoint the `cn` alias to `@ploykit/ui`'s `lib/utils.ts`.
**Discipline**: borrow layouts only, import no dependencies (no TanStack Table/Router/ScrollArea, no `@radix-ui/*` of any kind
— the §4.5.2 bans); Toast stays on sonner (the official base variant likewise wraps sonner directly).

---

## 5. Backend Design

### 5.1 Official Go Standards (general conventions this design follows)

1. Routing always uses Go 1.22+ `http.ServeMux` method patterns (`"DELETE /auth/sessions/{sessionId}"`); no chi/echo.
2. Handler signatures follow the existing conventions: `Deps` struct + `Mount(mux, Deps)`; `webx.P(fn)` adapts to `(w, r, p *webx.Principal)`;
   requests via `webx.DecodeJSON` (DisallowUnknownFields), responses via `webx.WriteJSON`, errors via `webx.WriteErr`
   (the service layer produces only `webx.Error`, mapped to `E_VALIDATION/E_NOT_FOUND/...`).
3. Interfaces are defined on the consumer side (`app/ports.go`); `adapters/pgrepo` asserts compliance with `var _ app.Repo = (*Repo)(nil)`;
   transactions use `pg.Within` ambient transactions, with hooks sharing the tx.
4. Context passing uses `context.Context` as the first parameter; logging uses `slog`; time is injected through the `Clock` port (testability).
5. Testing: table-driven `httptest` + real route registration (no mux mocks); pgrepo tests use testcontainers or the existing patterns.
6. Migrations come in pairs: `migrations/NNN_name.{up,down}.sql`; framework numbering is contiguous — the next free number
   defers to the actual state of the `migrations/` directory; product-side migrations are provided by the product embed (from 1001 up).

### 5.2 Endpoint Inventory

#### identity — Sessions and Account

```
DELETE /auth/sessions/{sessionId}     RequireHuman → 204
  Repository: UPDATE session SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL   -- 0 rows → 404 E_NOT_FOUND
  Notes: revoking "the current session" is equivalent to logout (the frontend may also prompt per the current flag and call /auth/logout; the backend has no special case)

DELETE /auth/me                       RequireHuman → 204
  Service: AccountService.DeleteAccount (single tx):
    1) UPDATE "user" SET status='deleted',
       email='deleted+'||id||'@invalid',        -- frees the address, allowing re-registration (email UNIQUE kept)
       display_name='', avatar_url=NULL, password_hash=NULL,
       tokens_valid_after=now()                 -- double gate: all sessions invalidated immediately
    2) UPDATE personal_access_token SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL
    3) audit account.deleted (Recorder, Observational semantics; failure does not roll back)
  Rule: the existing status check in identity's login/session validation rejects `!= 'active'`, which already covers 'deleted'; no new branch needed
```

The `GET /auth/sessions` response carries a `current` boolean field (the handler compares against `p.SessionID` to mark the current device);
the frontend renders a "current session" badge from it. `SessionInfo` gains one column — no compatibility burden.

#### notify — Notification Preferences

```
GET /api/notification-preferences     webx.P → {"items":[Preference]}
PUT  /api/notification-preferences/{type}
                                      webx.P, body {email_enabled?, in_app_enabled?} → Preference
                                      (guards aligned with notify's existing user-level routes; injection goes
                                       through the single NotifyService.WithPrefGate point)
  Preference: {notification_type, email_enabled, in_app_enabled, updated_at}
  Semantics: the table stores only "explicitly set" rows; a missing row = both channels default on (GET does not backfill default rows; the frontend merges against defaults)
  Validation: type must be non-empty and ≤64 chars, else E_VALIDATION; at least one of the two booleans must appear
  Wiring: notify/app gains a port
      type PrefGate interface {
          List(ctx, userID) ([]Preference, error)
          Upsert(ctx, userID, typ string, email, inApp *bool) (Preference, error)
          Allowed(ctx, userID, typ string) (bool, error)   // in-app gate
      }
      NotifyService.Notify checks AllowedForInApp before persisting; a nil port lets everything through
      (the framework's zero-dependency default). The email-channel gate activates the same port when email dispatch is wired in.
```

#### audit — Workspace Audit Queries

Contract: **flat routes + header context + offset pagination** (the quotahttp shape, see `audit/adapters/http/routes.go`):

```
GET /api/audit             WsMW (member check + injects WorkspaceID) + audit:read (falls back to owner/admin when no Authz)
                           ?actor_id=&action=&resource_type=&from=&to=&limit=&offset=
                           → {"items":[...], "total": n}    # from/to must be RFC3339; invalid → 400 E_VALIDATION
GET /api/audit/export.csv  same params → text/csv attachment (buffered before the response; row cap 5000)
GET /api/admin/audit{,/export.csv}  platform-level mirror (admin Deps.Rec passes through the same ListQuery)
```

`audit.ListQuery{WorkspaceID, ActorID, Action, ResourceType, From, To, Limit, Offset}` carries every filter
dimension (the workspace dimension comes from the Principal; user input is not accepted). The frontend audit page consumes it directly; CSV downloads go through
`apiFetch(url, { responseType: 'blob' })` (supported). **Zero new permission points** — `audit:read`
gets its first consumer here.

#### admin — Impersonation (migration 034)

```
POST /api/admin/users/{userId}/impersonate    requireAdmin + RequireHuman → reissues the cookie + {"user":…}
  Rules: the target must be active and not is_platform_admin; audit admin.impersonate (metadata carries both ids)
  Implementation: the session table carries an impersonated_by column (migration 034; ADR 0008);
        TTL = min(session TTL, 1h); issued as an ordinary session cookie
  Exit: reuses DELETE /auth/sessions/{sessionId} (revokes the current impersonation session) → the frontend returns to /login
        (the original admin session survives but its cookie has been replaced; re-login is required — explicitly accepted, written into the product docs)
  /auth/me response carries impersonated: boolean (true when p's session carries impersonated_by); the frontend renders a top banner
```

### 5.3 Migration SQL

Framework migrations backing these pages (actual numbering as in `migrations/`):

```sql
-- 018_notification_preference.up.sql
CREATE TABLE notification_preference (
    user_id           uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    notification_type text        NOT NULL,
    email_enabled     boolean     NOT NULL DEFAULT true,
    in_app_enabled    boolean     NOT NULL DEFAULT true,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notification_type)
);

-- 018_notification_preference.down.sql
DROP TABLE notification_preference;
```

```sql
-- 019_account_deletion.up.sql
ALTER TABLE "user" DROP CONSTRAINT user_status_check;
ALTER TABLE "user" ADD CONSTRAINT user_status_check
    CHECK (status IN ('active', 'disabled', 'deleted'));

-- 019_account_deletion.down.sql (fails if rows with status='deleted' exist: expected — clean the data first)
ALTER TABLE "user" DROP CONSTRAINT user_status_check;
ALTER TABLE "user" ADD CONSTRAINT user_status_check
    CHECK (status IN ('active', 'disabled'));
```

```sql
-- 034_session_impersonated_by.up.sql
ALTER TABLE session ADD COLUMN impersonated_by uuid REFERENCES "user"(id);

-- 034_session_impersonated_by.down.sql
ALTER TABLE session DROP COLUMN IF EXISTS impersonated_by;
```

### 5.4 example Assembly

`example/cmd/app/main.go` wires the page-facing pieces: `audithttp.Mount(mux, audithttp.Deps{...})`,
the `PrefGate` injected into the notify service via `WithPrefGate`, impersonation, and `OAuthProviders` fed into the
`/config` mount. All other domains untouched.

Environment note: `/config`'s origin feed and CSRF `TrustedOrigins` derive from `FRONTEND_ORIGIN` (default
`http://localhost:5173`). Non-production runs additionally set `TrustLocalhostAnyPort`, so a drifted vite
port (5174, 5176, ...) no longer turns every write into a CSRF 403; production must point `FRONTEND_ORIGIN`
at the deployed origin exactly. The `/ws` WebSocket allow-list still matches exact origins only.

---

## 6. Testing and Acceptance Strategy

### 6.1 Frontend (vitest + testing-library)

- Wrappers: smoke tests (render + trigger one primary interaction + a11y role assertions, e.g. `role="menu"`).
- Pages: mock `useApi` (module-level vi.mock) and assert — loading skeleton, error retry, empty state, write ops calling the correct
  path/payload, 409/402/403 error codes mapped to the expected copy. Form validation tests only schema boundaries (where aligned with backend rules).
- Data layer: `bridgeWsToQuery` rule matching tested as pure functions; `queryKeys` guarded against bare-string regressions via types
  (`as const` tuples).

### 6.2 Backend (table-driven httptest)

One case set per endpoint: unauthenticated 401 / non-human (PAT call) 403 / permission point 403 / success 2xx /
missing target 404 / invalid params 400 / concurrency idempotency (a second revocation returns 404). The pgrepo layer covers
`notification_preference` upsert idempotency and the 019 constraint behavior.

### 6.3 2FA Deferral Note (shape reservation)

The least-invasive enablement path for the future is reserved: add `'totp'` to the `auth_challenge.kind` CHECK (reusing the attempts/expires
columns for attempt limiting), and insert a challenge step after `verify-code/login` succeeds in the login flow; `SecuritySettingsPage`
reserves a "two-step verification" section (enrollment QR + recovery codes in a SecretModal). This design pre-writes no endpoints for it.

---

## 7. Dependencies and Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Some Base UI 1.8 parts (Select/Menu) may shift API in minor versions | wrapper-layer rework | wrapper-layer isolation (pages never import Base UI directly); pinned ^1.8.0 |
| WS frames (notification.created etc.) not yet emitted server-side | invalidation bridge idles | frontend degrades to polling under "register rules only when frames exist"; emit is a separate task |
| Stripe settlement mode is `mode=payment` (one-off), no real subscription cycle | billing-page semantic skew | page copy phrased as "buy per interval"; subscription automation belongs to the billing domain's existing plans and stays out of this design |
| Impersonation exit requires re-login (the original admin cookie is replaced) | operations acceptance | explicitly accepted and documented in the product docs |
