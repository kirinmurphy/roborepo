---
id: jqi1dof
priority: high
next_action: Review the completed implementation and decide whether to commit it or begin integration closeout
blocked_by: []
depends_on: []
related:
  - pljvmyh
  - canonical-repository-identity-plan-v2
  - h4tqm2wz
  - nl40n9vr
reviewed_commit: 4ad4eeb
---

# Evolve Portal Home into a Repository-First Workspace

## Summary

Home already exists. `scripts/cli/portal-server.mjs` serves a `home` page at `/` as the default open destination, and Agents already lives at its canonical `/config` route. What Home is *not* yet is repository-first: `portal/home/index.html` is a static welcome page with four section cards (Agents, Plans, Tokens, Runtime) and no page script.

This story evolves that existing shell into a repository-first workspace and adds a persistent repository detail route. Home should answer one operational question: **what repositories am I working in, what is happening in each one, and how do I immediately get back into a running project?** It is a jumping-off point, not a passive metrics dashboard. Quick access to active worktrees/checkouts and the user-facing application running in each is the primary use case.

Home consumes the repositories RoboRepo *already* knows about through existing discovery and activity. It does not configure where repositories come from and does not add a shared Portal repository filter — those are [[pljvmyh]]. The one piece of identity work this story needs and does not yet have is a stable, URL-safe repository key (`urlKey`) for the detail route; that identity work is pulled forward here (Phase 1) and consumed by [[pljvmyh]] rather than reinvented there.

Repository detail lives at `/repositories/<urlKey>`: a bookmarkable, back/forward-navigable page that gathers cross-domain context for one repository and links into the deeper domain pages.

## Goals

- Turn the existing `/` Home from a static welcome page into a repository directory.
- Make repositories the dominant Home content, ordered so the work in progress is reachable first.
- Surface each repository's known checkouts/worktrees with their promoted running application, so an active worktree can be opened from Home without visiting Runtime.
- Add `/repositories/<urlKey>` as a persistent repository detail route.
- Allocate a stable browser `urlKey` as repository identity (the minimum identity work the detail route requires), designed so [[pljvmyh]] consumes it unchanged.
- Reuse the completed Runtime workspace infrastructure (`deriveLifecycle`, `lastSeenAtFor`, `primaryEntrypoint`, the private local-root index, `pinRepository`) rather than building a second repository lifecycle/recency model.
- Show concise per-repository Git, Runtime, Plans, Tokens, and Agents status without duplicating the full domain pages.
- Keep Runtime the deeper operational surface; Home shows the useful application entrypoint, Runtime explains how it is hosted.
- Degrade per domain: one failed domain must not remove a repository from Home or detail.
- Keep normal browser payloads free of absolute filesystem paths.

## Non-goals

- Creating the Home shell, registering `/`, moving Agents to `/config`, or changing the default open route. All already shipped (see Current State).
- Building global repository-source configuration or a shared Portal repository filter ([[pljvmyh]] owns both).
- Building the Runtime workspace/lifecycle/checkout model ([[h4tqm2wz]] already shipped it).
- Adding one-repository filtering to Runtime.
- Implementing repository-level agent configuration.
- Exposing secondary Runtime ports, container IDs, Compose internals, PIDs, or raw listener inventory on Home.
- A modal-only repository detail experience.
- Broad global cross-cutting dashboards: global telemetry-threshold policy, a structured Doctor redesign, Doctor caching architecture, an installation health dashboard, a generic Attention/health aggregator. Repository-associated warnings are in scope only where they directly improve the repository experience.
- Exposing repository checkout paths on Home or detail.

## Current State

Verified against `80728a7`.

**Already shipped — do not re-plan:**

- `scripts/cli/portal-server.mjs` `PAGES` serves `home` at `/` with `default: true`, and Agents at `/config`. `roborepo web` opens `/`.
- `portal/home/` exists but holds only `index.html` (a static welcome page with four nav cards) and `styles.css` — no `app.js`, `api.js`, or `templates.js`.
- The canonical repository registry (`modules/repositories/`) stores discovery provenance, opaque local-root IDs, a private `rootId -> absolute path` index (`registry.localRootPaths`), visibility, resolution, activity, aliases, `pinned`, and enrollments.
- The registry is not only a discovery cache. It also preserves user choices and durable history: pins, hidden/restored state, confirmed aliases, enrollments, `firstSeenAt`, and local-root ownership. A version change must either migrate those fields or explicitly accept losing them.
- Browser-safe summaries (`modules/repositories/summary.mjs`) already strip paths: `repositorySummary`, `repositoryListPayload`, and `repositoryDetailPayload` whitelist fields and map local roots to kind/timestamps only.
- [[h4tqm2wz]] (completed) delivered the Runtime workspace model: `deriveLifecycle` returns `active`/`idle`/`stale` (`modules/repositories/lifecycle.mjs`), `lastSeenAtFor` gives a repository's recency, `ageOutCandidates` ages repositories out after 30 days of not being seen, and visibility-based hiding is in place.
- `buildDeveloperRuntimeSnapshot` (`modules/developer-runtime/snapshot.mjs`) already builds the repository → checkouts(`roots`) → `primaryEntrypoint` model this story needs. Each root carries `primaryEntrypoint` = `{ kind, opaqueKey, origin, port }`, and `primaryEntrypointFor` treats Compose containers and host listeners identically — a container-backed web UI already promotes the same way a dev-server does. `scripts/cli/developer-runtime.mjs` assembles `persistedRepositories`, `repositoryNames`, and `pinnedRepositoryIds` from the registry and feeds the builder.
- [[canonical-repository-identity-plan-v2]] (completed) established canonical `repositoryId` and alias resolution.

**Gaps this story fills:**

- No `urlKey` exists anywhere in `modules/repositories/`; repository API routes key on an encoded `repositoryId` (`/api/repositories/:id`).
- Home is not repository-aware.
- There is no `/repositories/<urlKey>` route, and no repository detail surface.
- Portal *page* routing is static exact-match: `handlePortalPage` resolves `PAGE_BY_PATH.get(urlPath)`. (The *API* route tables in `scripts/cli/portal-router.mjs` already match `:param` segments; the page layer does not.)
- `repositorySummary` does not expose `urlKey`, `pinned`, lifecycle, or recency — it carries `resolution`/`activity`/`visibility` only.

## Relationship to [[pljvmyh]]

These two stories share one canonical repository universe and must not form a dependency cycle.

```text
Existing canonical repository knowledge
        ↓
Repository-first Home + detail        ← this story (jqi1dof), ships first
        ↓
Global repository sources
        ↓
Shared canonical repository filtering ← pljvmyh, ships second, additive to Home
```

This story ships first and works with zero setup, consuming the repositories already known through Runtime discovery and other existing activity. It does **not** depend on [[pljvmyh]]: Home needs stable repository identity (`urlKey`), not global source configuration or a shared filter.

`urlKey` is allocated here because the detail route requires it. [[pljvmyh]] treats `urlKey` as established browser identity and consumes it for `?repository=<urlKey>` scope — it does not reinvent a slug/key concept. This is the one shared-identity seam between the stories, and it points one way (this story produces it; [[pljvmyh]] consumes it).

## What "all repositories" means here

For this story, the Home directory shows **all visible canonical repositories RoboRepo currently knows about through existing discovery and activity** — the registry as it stands. It does *not* mean exhaustive discovery of every Git repository on disk. Broadening coverage through user-configured repository/folder sources is [[pljvmyh]].

Hidden repositories (registry `visibility: hidden`) do not appear in the normal directory. Reuse the existing visibility and `includeHidden` behavior in `repositoryListPayload` rather than inventing a Home-specific visibility system.

## Proposed Design

### 1. Stable browser `urlKey`

Add a persisted, URL-safe key to canonical repository records. It is the one new identity field this story introduces, and the only repository identity Home/detail URLs ever carry.

| Field | Purpose | Example |
| --- | --- | --- |
| `repositoryId` | Internal canonical joins | `git:github.com/kirinmurphy/roborepo` |
| `urlKey` | Browser selection and `/repositories/<urlKey>` | `roborepo` |
| `displayName` | Visible label | `RoboRepo` |

`urlKey` invariants:

- lowercase ASCII slug matching `[a-z0-9]+(?:-[a-z0-9]+)*`, at most 80 characters;
- unique within the local registry;
- allocated once and persisted; independent of later display-name changes;
- never contains an absolute path, provider URL, credentials, or the canonical ID;
- collision-safe, with a deterministic suffix (`roborepo`, then `roborepo-a31f` on collision);
- validated as unique across every repository record;
- old keys continue resolving through canonical repository aliases if repositories are deliberately merged;
- allocated at record creation, so every record has one by construction.

Derive the readable base from `displayName`, falling back to `repository` if normalization removes every character, and truncate the base to leave room for a suffix. The first record allocated an available base keeps it. A collision adds the first four base36 characters of a hash of canonical identity, extending the hash deterministically until the candidate is unique. Persist the result so discovery order or later display-name changes never alter an existing URL.

Resolve `urlKey -> repositoryId` once at the server boundary, then resolve any canonical repository alias and pass the surviving `repositoryId` to domain loaders. Do not persist `urlKey` as a foreign key in Plans, telemetry, Runtime, or agent-config data. Expose `urlKey` through `repositorySummary`/`repositoryDetailPayload` (path-free by construction).

**Decision — reset registry v1 without a backup.** When `loadRegistry` sees an older version, replace it with a fresh v2 registry and do not retain a v1 backup. This intentionally discards pins, hidden/restored state, aliases, enrollments, timestamps, and local-root mappings. Runtime and later repository-source discovery repopulate repository facts; user-managed state is not migrated. Tests must assert both the fresh v2 shape and the absence of a backup file so compatibility behavior is not reintroduced accidentally.

This field and its allocation/collision/lookup rules are shared infrastructure: [[pljvmyh]] builds its `?repository=<urlKey>` scope on exactly this field.

### 2. Repository directory is the primary Home content

Replace the static welcome cards with a directory of visible canonical records from the registry. Git-backed and `local:` repositories are both valid cards; resolution/confidence is displayed honestly rather than used to hide a registered local repository.

Ordering (reusing existing signals, not a new model):

1. pinned (`record.pinned` / `pinRepository`);
2. currently active (`deriveLifecycle` state `active`);
3. recently active / idle (`idle`, ordered by `lastSeenAtFor`);
4. stale (`stale`).

`sortRepositoriesForDisplay` in `modules/developer-runtime/snapshot.mjs` already proves the active/pinned signals, but its idle group falls back to name rather than recency. Add the Home-specific comparator in the server-side overview module, using the existing `pinned`, lifecycle, and `lastSeenAt` facts; do not sort in browser code or create another lifecycle model.

If the registry is empty, Home presents the zero-configuration path that exists today: start a local project, then open Runtime so discovery can register it. Do not ship a dead "Manage repositories" link to a route that [[pljvmyh]] has not delivered yet. Leave a stable action slot in the layout; [[pljvmyh]] makes that slot interactive as "Manage repositories" when its destination exists.

Runtime activity that has no registered canonical record must not render as a fake repository card. Surface it separately as unresolved activity with a path to the existing Runtime association workflow.

### 3. Checkout/worktree rows are a core Home primitive

For each repository, Home shows its known checkouts/worktrees — not merely a count like `3 worktrees`. The checkout identity is useful on its own and becomes especially useful paired with the running application entrypoint.

Conceptually:

```text
my-project

main                   :4317 ↗
feature/new-layout     :5173 ↗
fix/auth
experiment/foo         :3000 ↗
```

Required behavior (exact layout may evolve):

- every known checkout/worktree is identifiable by branch/name;
- any checkout with an active promoted user-facing application can be opened immediately (the port/URL is clickable);
- inactive checkouts stay visible without a link;
- Home never requires navigating to Runtime to open an already-running worktree.

The data already exists: `buildDeveloperRuntimeSnapshot` produces `repository.roots[]`, each with `isWorktree`, `git` (branch), and `primaryEntrypoint`. Home consumes that repository-keyed view; it does not re-enumerate checkouts. For a repository with unusually many worktrees, use a compact/collapsible presentation rather than collapsing the rows into an aggregate count.

### 4. Runtime behavior on Home: promoted primary entrypoint only

For an active worktree Home prioritizes checkout identity, active state, the promoted user-facing application, its primary port/URL, and immediate click-through:

```text
feature/new-layout     :5173 ↗
```

Use the already-computed `primaryEntrypoint` (`primaryEntrypointFor` in `snapshot.mjs`). Home normally shows **only** that one promoted entrypoint per checkout. Do not add `+2`, secondary-port lists, or port inventories unless later product evidence demands it; the full listener/port collection stays on `/runtime`.

**Container-backed applications must appear.** Home is origin-agnostic. `primaryEntrypointFor` already ranks Compose containers and host listeners together, so a web UI served from a Compose container promotes exactly like a host-process dev server:

```text
main     :4317 ↗
```

Home does not explain that the app runs in Docker. Implementation/diagnostic detail — container IDs, Docker ownership, Compose service internals, PIDs, raw listener inventory, network plumbing, full route metadata, management controls — stays on `/runtime`. The rule: **Home shows the useful application entrypoint regardless of how it is hosted; Runtime explains how it is hosted.**

Architectural caveat: a repository may intentionally expose several meaningful user-facing apps (customer app, admin app, docs site). The MVP still prefers the single promoted `primaryEntrypoint`; Runtime remains where every entrypoint is inspectable. If a repository genuinely needs multiple promoted apps on Home, treat that as a later, evidence-driven extension rather than MVP scope.

### 5. Git is a first-class repository domain

Git state is fundamental to repository identity and worktree context. Make Git first-class, but do not duplicate the checkout list in a separate Git section when one shared checkout-row presentation can carry both Runtime and Git identity.

Home might eventually render rows like:

```text
main                  clean        :4317 ↗
feature/new-layout    dirty +1     :5173 ↗
fix/auth              behind 2
```

The architectural principle, not the exact copy, is the requirement: **checkout/worktree identity is shared context; Git and Runtime contribute to the same Home row while keeping separate underlying data contracts.**

**Decision — define a small repository workspace summary contract; browser pages do not receive Runtime's full view-model.** A server-side mapper consumes the cached `loadDeveloperRuntimeSnapshot()` result and projects only repository lifecycle, checkout identity/Git state, and `primaryEntrypoint`. This reuses the expensive discovery and Git work without re-enumerating checkouts or coupling Home markup to unrelated Runtime fields. Home and repository detail consume the named projection; deeper Git fields can be added to that contract only when the detail view needs them.

Git fields a Home row needs (the likely contract surface): branch/worktree name, dirty state, ahead/behind, a notable drift warning, current/default branch where useful. Keep it compact; the deeper Git view belongs on repository detail, which can read more from the same contract.

### 6. Plans summary (coverage-aware)

Home shows repository-associated plan information: active count, backlog count, and recently changed where useful.

Until [[pljvmyh]] lands, **Plans still owns its `discoveryRoots`** (`modules/plan-docs/index.mjs`). A repository Home knows about may be entirely outside what Plans has scanned. Therefore Home must not render `0 plans` as an authoritative zero. Represent domain coverage explicitly — a small state such as `available` / `partial` / `unavailable` / `stale` (or a simpler equivalent) — so "not scanned" never looks like "no plans". Home consumes whatever repository-associated plan data exists today; it does not redesign Plans discovery. That redesign is [[pljvmyh]], which resolves this coverage ambiguity by making Plans scan the canonical repository set.

For "recently changed", prefer the plan file's Git last-commit timestamp, falling back to filesystem mtime; label it **Recently changed**, not "created" (do not infer creation from first discovery). Use a trailing seven-day window.

### 7. Tokens summary

Keep a compact repository-level token/session signal on Home: warning count, highest severity, or recent concerning session state. Repository detail can expand it. This story does not rewrite the Tokens dashboard and does not depend on global telemetry-policy work. The Tokens report also returns `waste` totals (each turn counted once); a repository-scoped waste share is a candidate signal once shared scope lands.

### 8. Agents/config summary

Agent configuration is not repository-aware yet. Home/detail establish a stable conceptual slot, but the initial state is `unavailable`; do not claim `not configured` when no repository-scoped check exists. Future repository-aware config can replace the envelope with `configured` or `not-configured` data without changing the card contract.

### 9. Repository card surface

A repository Home surface might look like this (illustrative only — Git state may instead sit alongside the checkout rows if that reads cleaner; do not lock the plan to a redundant layout):

```text
my-project

main                  :4317 ↗
feature/new-layout    :5173 ↗
fix/auth
experiment/foo        :3000 ↗

Git      1 dirty · 1 behind
Plans    2 active · 4 backlog
Tokens   1 warning
Agents   Unavailable

View repository →
```

The required *behavior* (identifiable checkouts, immediate access to running apps, compact cross-domain status, coverage honesty) outranks the exact section structure.

### 10. Persistent repository detail route

Add:

```text
/repositories/<urlKey>
```

A persistent route (not a modal) so detail is bookmarkable, supports back/forward, and has room to grow. Resolve `urlKey` at the server boundary; keep internal data keyed by canonical `repositoryId`.

Detail is the repository-centric cross-domain view. The distinction from domain pages:

```text
Repository Detail   "What is happening in this repository?"
Runtime             "What is running across my development environment?"
Plans               "What plans exist / what is their status?"
Tokens              "What token/session activity exists?"
```

Detail provides deeper per-repository views of the domains Home surfaces and does not replace the domain pages:

- repository identity/source information where appropriate (display name, provider URL, discovery provenance, local-root count/kinds — never paths);
- deeper Git: all checkouts/worktrees, branches, clean/dirty, ahead/behind, remote/provider context, repository-level Git status;
- Runtime summary with a link to the full `/runtime`;
- Plans summary with a scoped link;
- recent Tokens/session summary with a scoped link;
- Agents status with a scoped link.

Reuse `repositoryDetailPayload` for browser-safe identity fields. Load discovery and local-root provenance through the existing associations service only when the detail view needs it; do not duplicate repository lookup or expose the private alias/path indexes.

### 11. Dynamic routing for the detail page

Portal *page* routing is currently static exact-match: `handlePortalPage` does `PAGE_BY_PATH.get(urlPath)`. `/repositories/<urlKey>` needs pattern support at the page layer. (The API route tables in `portal-router.mjs` already match `:param` segments and can serve the overview API by pattern today — the gap is the HTML page handler, not the API dispatcher.)

**Decision — generalize page matching without adding dynamic destinations to global navigation.** Keep `PAGES` as the static, navigable manifest that feeds the header, `/api/portal/status`, sitemap, and manifest metadata. Add a separate derived page-route table containing those static entries plus a non-navigable `/repositories/:urlKey` entry whose `navId` is `home`. `pageHtml` injects the matched route's `navId` as current-page metadata; `theme.js` activates that ID instead of inferring ownership from exact path equality. Export and reuse `matchSegments` (or an equivalent shared matcher) from `portal-router.mjs`; do not add a second segment matcher or a one-off `/repositories/` branch.

Implementation and tests must cover:

- recognizing the `/repositories/:urlKey` page pattern while leaving `PAGES` and its five-item browser manifest unchanged;
- extracting and decoding `urlKey`;
- serving the repository detail shell;
- malformed path encoding → server 404; unknown or hidden `urlKey` → overview API 404 rendered by the detail shell as an explicit unavailable state, never a redirect to Home or "all";
- marking Home active in global navigation while repository detail is open;
- preserving the existing static global-nav and metadata behavior (all continue to read `PAGES`).

### 12. Cross-domain aggregation and partial failure

Home/detail aggregate existing service functions server-side; they do not fetch the portal's own HTTP endpoints from the server. Add a focused `scripts/cli/repository-overview.mjs` coordinator behind `GET /api/home` and `GET /api/repositories/:urlKey/overview`. Responsibilities:

- load visible canonical repositories once and use them as the anchor set;
- map the cached Runtime snapshot through the narrow repository workspace contract;
- group a cached Plans snapshot by canonical `repositoryId`, carrying explicit coverage/freshness;
- read a compact per-repository telemetry projection retained alongside the default analysis cache instead of parsing or returning the multi-megabyte `/api/data` JSON;
- represent Agents/config as an explicit unavailable/not-configured state until repository-aware config exists;
- join domain data by canonical `repositoryId`;
- isolate each loader with `try`/`catch` and return partial results when one fails; keep stale-but-successful data marked stale rather than empty.

The portal server and these loaders are synchronous on one Node thread, so the aggregate request path uses cached, bounded projections only. Expensive Runtime refresh, plan discovery, and telemetry analysis remain owned by their existing background/manual refresh paths. Add timeout/cancellation semantics only if a loader later becomes genuinely asynchronous and interruptible.

Every domain result uses one small envelope so absence is not confused with a valid zero:

```json
{ "status": "available|partial|stale|unavailable|not-configured", "updatedAt": "ISO-8601|null", "data": {} }
```

**One failed domain must not make a repository disappear.** A card like:

```text
Runtime   available
Git       available
Plans     unavailable
Tokens    available
```

is still a useful card. Domain failures are independently representable; Home does not depend on all domain APIs succeeding. This preserves the existing partial-failure philosophy.

### 13. Browser surface

Build a framework-less repository-first Home under `portal/home/` following current portal conventions (the existing static page is the shell to grow from):

- `portal/home/index.html` (already exists — evolve it)
- `portal/home/app.js`, `portal/home/api.js`, `portal/home/templates.js` (new)
- `portal/home/styles.css` (already exists)

Add the focused detail surface under `portal/repositories/`. Follow the loaded `code-style` and `javascript-typescript` conventions: page `app.js` stays wiring/orchestration; server/domain calculations stay out of browser code; named ESM exports; reusable multi-element markup in real HTML `<template>` elements (not nested `createElement` or JS template strings); split files by responsibility before they grow into mixed orchestrator/render modules.

Refresh: poll Home aggregate state at a modest interval; let Runtime's established cache/refresh policy govern discovery; detail may refresh active/runtime summaries without reloading stable repository metadata; correctness and clear stale/error states matter more than fine-grained DOM patching.

## Routing and Navigation

The canonical page layout (already true except the last row) is:

| Route | Page |
| --- | --- |
| `/` | Home |
| `/config` | Agents |
| `/plans` | Plans |
| `/tokens` | Tokens |
| `/runtime` | Runtime |
| `/repositories/<urlKey>` | Repository detail (this story) |

Navigation behavior:

- Home always opens unscoped `/` (it is the directory; it does not use `/?repository=…`);
- repository cards open `/repositories/<urlKey>`;
- repository detail links into Plans/Tokens/Agents using the shared scope [[pljvmyh]] defines;
- Runtime links remain unscoped;
- browser back/forward works across Home → detail → domain pages.

Scoped domain links (`/plans?repository=<urlKey>`, etc.) depend on the shared scope [[pljvmyh]] delivers. Until then, detail may link to the unscoped domain pages; the scoped form is additive.

## Code Touchpoints

### Repository identity and payloads

- `modules/repositories/schema.mjs` — version the registry for required, unique `urlKey`; define the fresh v2 shape.
- `modules/repositories/registry.mjs` — reset older registries without migration or backup, allocate/lookup `urlKey`, and keep local-root metadata keyed by opaque IDs.
- `modules/repositories/summary.mjs` — add `urlKey` and `pinned` to browser-safe summary/detail payloads without adding paths; dynamic lifecycle/recency stay in the overview projection.
- `modules/repositories/index.mjs` — export the new `urlKey` APIs.

### Portal routing/chrome

- `scripts/cli/portal-router.mjs` — export the segment matcher for page routing as well as API routing.
- `scripts/cli/portal-server.mjs` — replace `PAGE_BY_PATH.get` with shared pattern matching over a page-route table; keep dynamic repository detail out of `PAGES` so nav and metadata remain static.
- `scripts/cli/portal-routes-repositories.mjs` — add the Home/overview aggregate routes and accept `urlKey` at the browser boundary while internal functions keep taking `repositoryId`.
- `scripts/cli/telemetry.mjs` — wire the aggregate handlers and expose a compact cached telemetry projection without parsing the full serialized report.
- `portal/shared/theme.js` — honor the current dynamic page's nav owner so repository detail highlights Home.
- `portal/shared/base.css` — reuse shared layout/status primitives; keep page-specific layout in each page folder.

### Home and repository detail

- `portal/home/*` — repository directory, checkout rows, cross-domain status, empty/loading/error/partial-failure states.
- `portal/repositories/*` — identity/activity, deeper per-domain sections, scoped links, unavailable state.
- `scripts/cli/repositories.mjs` — `urlKey` resolution and browser-safe repository access.
- `scripts/cli/repository-overview.mjs` — aggregation, domain envelopes, canonical-ID joins, and Runtime-to-workspace projection.

### Domain summary sources (reuse, do not reimplement)

- Runtime/Git: cached `loadDeveloperRuntimeSnapshot()` repository view (`roots`, `root.git`, `primaryEntrypoint`, lifecycle), projected by `repository-overview.mjs`.
- Plans: `scripts/cli/plans.mjs` exposes a cached repository summary with counts, coverage, freshness, and recently-changed timestamps.
- Tokens/telemetry: `scripts/cli/telemetry.mjs` retains a compact per-repository warning/session projection beside the default analysis-cache entry.
- Agents/config: the aggregate returns `unavailable` until repository-aware agent configuration has a real data owner.
- Documentation: update `docs/internal/portal-architecture.md` and add `docs/user/reference/repositories.md` for the Home directory, detail route, states, and privacy boundary.

## Implementation Plan

### Phase 1 — Stable repository browser identity

- [x] Add persisted `urlKey` to the registry schema with a version bump.
- [x] Reset an older registry directly to a fresh v2 registry; do not migrate or create a backup.
- [x] Allocate `urlKey` at record creation, deterministically, with collision handling (`roborepo`, `roborepo-a31f`).
- [x] Add `urlKey -> repositoryId` lookup at the repository service boundary.
- [x] Add browser-safe URL helpers and expose `urlKey` in summary/detail payloads.
- [x] Test required/unique schema validation, allocation stability, collisions, canonical alias resolution, hidden repositories, reset behavior, absence of a backup, and path privacy.

### Phase 2 — Repository detail route infrastructure

- [x] Generalize the page router to match `:param` segments with the shared matcher while keeping `/repositories/:urlKey` outside `PAGES`.
- [x] Serve the `portal/repositories/` shell for a decoded route key.
- [x] Return API 404 for unknown/hidden keys and render that as an explicit unavailable state; malformed encoding stays a server 404.
- [x] Keep the five-item static nav, status payload, manifest, and sitemap unchanged while marking Home active on detail routes.

### Phase 3 — Repository Home directory

- [x] Build server-side Home repository summaries keyed by canonical `repositoryId`.
- [x] Render visible canonical Git and `local:` repositories; reuse existing visibility/`includeHidden` handling and expose resolution/confidence honestly.
- [x] Order by pinned → active → idle(recent) → stale in the server overview, using `deriveLifecycle`/`lastSeenAtFor`/`pinned` rather than the Runtime comparator's alphabetical idle fallback.
- [x] Add the zero-repository Runtime-discovery guidance and a stable future action slot; do not render a dead repository-management link before [[pljvmyh]].
- [x] Keep unresolved activity out of normal repository cards.
- [x] Add per-repository/per-domain partial-failure handling.

### Phase 4 — Checkout/worktree Home model

- [x] Add the narrow server-side workspace projection over `loadDeveloperRuntimeSnapshot()`.
- [x] Render every known checkout/worktree with branch/name.
- [x] Associate the promoted Runtime entrypoint per checkout.
- [x] Keep inactive checkouts visible without a link.
- [x] Use a compact/collapsible presentation for repositories with many worktrees.

### Phase 5 — Runtime quick accessibility

- [x] Show the promoted `primaryEntrypoint` per active checkout with a clickable port/URL.
- [x] Treat host-process and container/Compose sources identically (already true in `primaryEntrypointFor`).
- [x] Show only the primary entrypoint; keep secondary ports on `/runtime`.
- [x] Deep-link to the full Runtime page.

### Phase 6 — Git repository summary

- [x] Include the thin Git fields in the shared repository workspace contract without exposing the rest of Runtime's view-model.
- [x] Surface clean/dirty, ahead/behind, and worktree-level status on Home rows.
- [x] Aggregate repository-level Git warnings for the card.
- [x] Reuse existing Runtime checkout Git data/caches.

### Phase 7 — Plans integration

- [x] Add a cached repository-associated Plans projection rather than refreshing discovery on every Home poll.
- [x] Represent coverage explicitly (`available`/`partial`/`unavailable`/`stale`); never render a misleading authoritative `0 plans`.
- [x] Add seven-day recently-changed data on detail (Git last-commit, mtime fallback; label "Recently changed").

### Phase 8 — Tokens integration

- [x] Retain a compact per-repository token/session warning projection alongside the default telemetry analysis cache.
- [x] Read that compact projection from Home/detail without parsing or returning the full `/api/data` report.
- [x] Expand recent/high-severity findings on detail.

### Phase 9 — Agents/config integration

- [x] Render the repository agent/config slot as `unavailable`; reserve `configured`/`not-configured` for a future real repository-scoped check.

### Phase 10 — Repository detail composition and polish

- [x] Compose the deeper cross-domain detail sections and domain navigation.
- [x] Apply partial-failure handling on detail.
- [x] Handle responsive layout and large-worktree repositories.
- [x] Add consistent healthy/loading/empty/error states and keyboard-accessible navigation; preserve focus across refreshes; avoid rebuilding open controls during polling.
- [x] Update portal reference docs for Home-as-directory and the repository detail route.

Adjust ordering if implementation inspection suggests a stronger sequence; Phases 1–2 (identity + routing) should land before the visible directory work in Phase 3.

## Implementation Status

All ten phases are implemented on `codex/portal-repository-home-and-detail`. No implementation task
is blocked. The implementation kept these material decisions from the plan and review pass:

- registry v1 resets directly to a fresh v2 file with no migration or backup;
- `urlKey` is stable browser identity, while every domain join resolves to canonical
  `repositoryId`, including aliases;
- Home/detail polls read cached Runtime, Plans, and Tokens projections and never start their
  expensive refresh paths synchronously;
- dynamic route parameters are escaped before they enter the inline browser manifest;
- detail links remain unscoped until [[pljvmyh]] supplies shared repository scope.

Verification completed successfully:

- the exhaustive unit run passed 117/117 suites;
- the portal browser run passed 24 tests with two opt-in documentation screenshot cases skipped;
- `npm run check` passed its doctor, CLI integration, install-collision, CI unit, package-install,
  available Docker clean-machine, and browser gates; Windows installer parity was skipped because
  PowerShell is unavailable on the validation host;
- `git diff --check` and syntax checks for the changed server/browser modules passed.

## Risks

- The v1 reset intentionally loses user-managed registry state. Keep the behavior isolated to the explicit version mismatch and cover it with a destructive-reset test.
- Home polling can make the single-threaded portal unresponsive if it triggers discovery, Git traversal, or telemetry analysis. The aggregate path must read bounded cached projections only.
- Runtime, Plans, and telemetry refresh at different times. Every domain envelope needs its own freshness timestamp/state so the UI does not imply an atomic cross-domain snapshot.
- A dynamic page accidentally added to `PAGES` would leak a literal `:urlKey` link into navigation and metadata; manifest tests must keep the static five-entry contract exact.

## Open Questions

None. Registry v1 is intentionally reset without migration or backup.

## Validation

Use focused domain tests while building, then the full suite because Home crosses routing and several shared domains.

Existing repo-native checks to preserve and extend:

```text
npm run test:unit -- --filter repositories
npm run test:unit -- --filter repository-overview
npm run test:unit -- --filter developer-runtime
npm run test:unit -- --filter portal-pages
npm run test:unit -- --filter plans-portal-state
npm run test:telemetry
npm run test:portal-ui
npm run check
```

Add focused coverage for:

- `urlKey` allocation stability, collisions, uniqueness validation, and canonical aliases; an older registry resets to fresh with no migration and no backup;
- `urlKey -> repositoryId` resolution, including hidden/unknown keys;
- dynamic `/repositories/:urlKey` page routing, missing/invalid key handling, browser history, and Home-active navigation, with the static nav manifest unchanged;
- Home rendering visible canonical repositories and excluding hidden ones;
- repository ordering (pinned/active/idle/stale) against `deriveLifecycle`/`lastSeenAtFor` under a fixed clock;
- checkout/worktree rows carrying branch identity and the promoted entrypoint;
- container/Compose-backed `primaryEntrypoint` appearing identically to a host-process one;
- only the primary entrypoint on Home; secondary ports absent from Home payloads;
- coverage-aware Plans state (no misleading authoritative zero when Plans has not scanned a repository);
- recently-changed plan timestamp precedence and seven-day boundaries under a fixed clock;
- repository-associated Tokens warnings;
- Agents stable-state rendering;
- partial responses when one domain fails, with the repository card still rendering;
- stale domain envelopes preserving last successful data and per-domain timestamps;
- Home/detail requests avoiding synchronous Runtime discovery, Plans refresh, or telemetry analysis; Runtime may schedule its established asynchronous refresh after returning the cached snapshot;
- no absolute paths in Home/detail browser payloads.

## Acceptance Criteria

- `/` remains the existing Home (no re-registration, no default-route change).
- Home is repository-first: a directory of visible canonical repositories is the dominant content.
- Hidden repositories do not appear in the normal directory.
- Repositories are ordered with meaningful lifecycle/recency (pinned → active → idle → stale) reusing the Runtime workspace lifecycle, not a new model.
- Every known checkout/worktree can be represented with its branch/name.
- Any checkout with a promoted active user-facing application can be opened immediately from Home.
- Container/Compose-backed promoted applications work identically to host-process applications on Home.
- Home shows only the primary promoted entrypoint per checkout; secondary Runtime ports remain on `/runtime`.
- Git state is represented on Home and expanded on detail.
- Plans state is repository-associated and coverage-aware (no misleading authoritative zero before [[pljvmyh]]).
- Tokens warnings can be repository-associated.
- Agents has a stable future-facing state.
- `/repositories/<urlKey>` works, is bookmarkable, and supports back/forward.
- Dynamic repository-detail page routing is supported without breaking the static nav manifest.
- `urlKey` is allocated at record creation, collision-safe, and consumable by [[pljvmyh]]; an older registry resets to fresh without migration or backup.
- One failed domain does not break the full repository card or detail page.
- No absolute filesystem paths leak through general browser-safe repository payloads.
- Runtime remains the deeper operational surface.
- Targeted unit/browser checks and the full `npm run check` gate pass.
