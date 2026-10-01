---
id: jqi1dof
priority: high
next_action: Allocate stable repository urlKey (Phase 1), then add the dynamic /repositories/<urlKey> page route (Phase 2) before evolving Home into the repository directory
blocked_by: []
depends_on: []
related:
  - pljvmyh
  - canonical-repository-identity-plan-v2
  - h4tqm2wz
  - nl40n9vr
reviewed_commit: 85390e9
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

Verified against `85390e9`.

**Already shipped — do not re-plan:**

- `scripts/cli/portal-server.mjs` `PAGES` serves `home` at `/` with `default: true`, and Agents at `/config`. `roborepo web` opens `/`.
- `portal/home/` exists but holds only `index.html` (a static welcome page with four nav cards) and `styles.css` — no `app.js`, `api.js`, or `templates.js`.
- The canonical repository registry (`modules/repositories/`) stores discovery provenance, opaque local-root IDs, a private `rootId -> absolute path` index (`registry.localRootPaths`), visibility, resolution, activity, aliases, `pinned`, and enrollments.
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

- short, URL-safe, human-readable;
- unique within the local registry;
- allocated once and persisted; independent of later display-name changes;
- never contains an absolute path, provider URL, credentials, or the canonical ID;
- deterministic and collision-safe (`roborepo`, then `roborepo-a31f` on collision);
- old keys stay reserved as aliases if a deliberate rename/merge happens;
- allocated at record creation, so every record has one by construction.

Resolve `urlKey -> repositoryId` once at the server boundary and pass canonical `repositoryId` to domain loaders. Do not persist `urlKey` as a foreign key in Plans, telemetry, Runtime, or agent-config data. Expose `urlKey` through `repositorySummary`/`repositoryDetailPayload` (path-free by construction).

**Decision — legacy registry data is wiped, not migrated.** The existing on-disk registry is discardable: rather than writing a `v1 -> v2` upgrade that backfills `urlKey` onto old records, bump `REGISTRY_VERSION` and have the load path reset to a fresh registry when it sees an older version (keeping the existing `backupRegistryFile` step so the old file is preserved on disk, never silently deleted). This removes the whole class of "record exists without a `urlKey`" states — `urlKey` is allocated when a record is created, so every record always has one. The tradeoff accepted here: repositories re-populate from discovery (Runtime activity, and later [[pljvmyh]] sources) rather than carrying over, which is acceptable because nothing durable is lost — the registry is a cache of what discovery can re-derive.

This field and its allocation/collision/lookup rules are shared infrastructure: [[pljvmyh]] builds its `?repository=<urlKey>` scope on exactly this field.

### 2. Repository directory is the primary Home content

Replace the static welcome cards with a directory of visible resolved repositories from the canonical registry.

Ordering (reusing existing signals, not a new model):

1. pinned (`record.pinned` / `pinRepository`);
2. currently active (`deriveLifecycle` state `active`);
3. recently active / idle (`idle`, ordered by `lastSeenAtFor`);
4. stale (`stale`).

This mirrors `sortRepositoriesForDisplay` in `modules/developer-runtime/snapshot.mjs`, which already groups running repositories ahead of idle/stale and honors `pinned`. Prefer sharing that ordering (or its inputs) over re-deriving it in Home browser code.

If the registry is empty, Home presents the zero-configuration model: start a local project (Runtime will discover it) or add a repository/folder — the latter linking to the repository management surface [[pljvmyh]] delivers. Leave that affordance ("Manage repositories" / "Add repositories") visible even when the directory is non-empty, so the progression *see what RoboRepo knows → broaden coverage* is discoverable. This story only links to that surface; it does not implement it.

Unresolved repository/activity signals must not render as fake canonical cards. Surface them separately as an unresolved item with a path to association/management.

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

Git state is fundamental to repository identity and worktree context, and the current plan under-specified it. Make Git first-class — but do not duplicate the checkout list in a separate Git section if one shared checkout-row presentation can carry both Runtime and Git identity.

Home might eventually render rows like:

```text
main                  clean        :4317 ↗
feature/new-layout    dirty +1     :5173 ↗
fix/auth              behind 2
```

The architectural principle, not the exact copy, is the requirement: **checkout/worktree identity is shared context; Git and Runtime contribute to the same Home row while keeping separate underlying data contracts.**

**Decision — define a small, stable repository Git/checkout summary contract; Home does not read Runtime's view-model directly.** Home must not reach into the shape `buildDeveloperRuntimeSnapshot` produces for Runtime's own page, because that couples the two surfaces — a later change to how Runtime renders would silently break Home. Instead, introduce one narrow, named Git-summary contract that both Home and repository detail read from, fed by the *underlying* Git data/caches (the `root.git` already on each snapshot root, and the repository Git helpers in `modules/repositories/` such as `collectBranchSyncFacts`) rather than by shelling out again or by consuming Runtime's rendered model. Keep the contract deliberately thin — only the fields a Home row and the detail Git view actually need, decided against the real data when implemented, not speculatively widened.

Git fields a Home row needs (the likely contract surface): branch/worktree name, dirty state, ahead/behind, a notable drift warning, current/default branch where useful. Keep it compact; the deeper Git view belongs on repository detail, which can read more from the same contract.

### 6. Plans summary (coverage-aware)

Home shows repository-associated plan information: active count, backlog count, and recently changed where useful.

Until [[pljvmyh]] lands, **Plans still owns its `discoveryRoots`** (`modules/plan-docs/index.mjs`). A repository Home knows about may be entirely outside what Plans has scanned. Therefore Home must not render `0 plans` as an authoritative zero. Represent domain coverage explicitly — a small state such as `available` / `partial` / `unavailable` / `stale` (or a simpler equivalent) — so "not scanned" never looks like "no plans". Home consumes whatever repository-associated plan data exists today; it does not redesign Plans discovery. That redesign is [[pljvmyh]], which resolves this coverage ambiguity by making Plans scan the canonical repository set.

For "recently changed", prefer the plan file's Git last-commit timestamp, falling back to filesystem mtime; label it **Recently changed**, not "created" (do not infer creation from first discovery). Use a trailing seven-day window.

### 7. Tokens summary

Keep a compact repository-level token/session signal on Home: warning count, highest severity, or recent concerning session state. Repository detail can expand it. This story does not rewrite the Tokens dashboard and does not depend on global telemetry-policy work. The Tokens report also returns `waste` totals (each turn counted once); a repository-scoped waste share is a candidate signal once shared scope lands.

### 8. Agents/config summary

Agent configuration is intended to become repository-aware but is not yet. Home/detail establish a stable conceptual slot for repository agent/config state without blocking the MVP. Allowed initial states: `configured`, `not configured`, `unavailable`, or a future/placeholder. A detail link to Agents may land on the [[pljvmyh]] repository-config placeholder.

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
Agents   Not configured

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

Extend `repositoryDetailPayload` (which already lazy-loads provenance separately from the list payload) rather than duplicating repository lookup.

### 11. Dynamic routing for the detail page

Portal *page* routing is currently static exact-match: `handlePortalPage` does `PAGE_BY_PATH.get(urlPath)`. `/repositories/<urlKey>` needs pattern support at the page layer. (The API route tables in `portal-router.mjs` already match `:param` segments and can serve the overview API by pattern today — the gap is the HTML page handler, not the API dispatcher.)

**Decision — generalize the page router, do not special-case it.** Rather than adding a one-off branch for `/repositories/`, teach the page layer to match `:param` segments the way the API router already does, so a `PAGES` entry can carry a pattern (e.g. `/repositories/:urlKey`) and future dynamic pages need no further routing work. Reuse the existing `matchSegments`/`defineRoutes` machinery in `portal-router.mjs` rather than writing a second matcher — exact-match pages keep working because a pattern with no `:param` segments is just an exact match. The cost accepted here is slightly more work now (the page handler stops being a plain `Map.get`) in exchange for not accumulating per-page routing special cases; this suits a portal that already expects more dynamic surfaces (repository detail is the first, not the last).

Implementation and tests must cover:

- recognizing the `/repositories/:urlKey` page pattern without turning per-repository pages into static `PAGES` manifest entries;
- extracting and decoding `urlKey`;
- serving the repository detail shell;
- missing/invalid/hidden `urlKey` → explicit not-found/unavailable, never a silent redirect to Home or "all";
- preserving the existing static global-nav manifest behavior (the header nav still reads `PAGES`).

### 12. Cross-domain aggregation and partial failure

Home/detail aggregate existing service functions server-side; they do not fetch the portal's own HTTP endpoints from the server. Add a focused aggregate boundary, for example `GET /api/home` and `GET /api/repositories/<urlKey>/overview`. Responsibilities:

- resolve repositories once;
- fan out to independent domain summary loaders, each behind its own timeout/cancellation boundary;
- join domain data by canonical `repositoryId`;
- return partial results when one domain fails — a timeout becomes e.g. `{ "domain": "plans", "status": "timeout" }`, the response still completes, names the affected domain, and keeps any stale-but-successful data marked stale rather than empty.

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

Add a focused repository-detail surface under a clear ownership boundary (a dedicated `portal/repository/` folder or a shared Home/repository feature folder). Follow the loaded `code-style` and `javascript-typescript` conventions: page `app.js` stays wiring/orchestration; server/domain calculations stay out of browser code; named ESM exports; reusable multi-element markup in real HTML `<template>` elements (not nested `createElement` or JS template strings); split files by responsibility before they grow into mixed orchestrator/render modules.

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

- `modules/repositories/schema.mjs` — version the registry for persisted `urlKey`; reset (not migrate) on an older version, since legacy data is discardable.
- `modules/repositories/registry.mjs` — allocate/lookup `urlKey`; keep local-root metadata keyed by opaque IDs.
- `modules/repositories/summary.mjs` — add `urlKey`, `pinned`, lifecycle, and recency to the browser-safe summary/detail payloads without adding paths.
- `modules/repositories/index.mjs` — export the new `urlKey` APIs.

### Portal routing/chrome

- `scripts/cli/portal-server.mjs` — generalize `handlePortalPage` to match `:param` page patterns (reusing `portal-router.mjs`'s `matchSegments`) instead of a plain `PAGE_BY_PATH.get`; `/repositories/:urlKey` becomes a patterned `PAGES`-style entry while exact-match pages and the nav manifest behave as before.
- `scripts/cli/portal-routes-repositories.mjs` — add the Home/overview aggregate routes and accept `urlKey` at the browser boundary while internal functions keep taking `repositoryId`.
- `portal/shared/theme.js`, `portal/shared/chrome-partial.html`, `portal/shared/base.css` — reuse shared chrome.

### Home and repository detail

- `portal/home/*` — repository directory, checkout rows, cross-domain status, empty/loading/error/partial-failure states.
- New repository-detail surface — identity/activity, deeper per-domain sections, scoped links.
- `scripts/cli/repositories.mjs` — extend the browser-safe detail/overview service or delegate to a focused aggregation service.

### Domain summary sources (reuse, do not reimplement)

- Runtime: `modules/developer-runtime/snapshot.mjs` repository view (`roots`, `primaryEntrypoint`, lifecycle) via `scripts/cli/developer-runtime.mjs`.
- Git: `root.git` on snapshot roots and `modules/repositories/` Git helpers (`collectBranchSyncFacts`).
- Plans: repository-associated counts and recently-changed timestamps.
- Tokens/telemetry: repository-associated recent-session summary and warning counts.
- Agents/config: repository config state (placeholder until the dedicated feature lands).

## Implementation Plan

### Phase 1 — Stable repository browser identity

- [ ] Add persisted `urlKey` to the registry schema with a version bump.
- [ ] Reset the registry on an older version (bump `REGISTRY_VERSION`, back up the old file, start fresh) rather than migrating/backfilling old records.
- [ ] Allocate `urlKey` at record creation, deterministically, with collision handling (`roborepo`, `roborepo-a31f`).
- [ ] Add `urlKey -> repositoryId` lookup at the repository service boundary.
- [ ] Add browser-safe URL helpers and expose `urlKey` in summary/detail payloads.
- [ ] Test allocation stability, collisions, reserved aliases, hidden repositories, and path privacy.

### Phase 2 — Repository detail route infrastructure

- [ ] Generalize the page router to match `:param` segments (reusing `matchSegments` from `portal-router.mjs`) so a patterned page entry like `/repositories/:urlKey` resolves; keep exact-match pages and the nav manifest unchanged.
- [ ] Resolve/decode `urlKey`; serve the detail shell.
- [ ] Handle missing/invalid/hidden keys with an explicit not-found/unavailable state.
- [ ] Preserve the existing static global-nav manifest behavior.

### Phase 3 — Repository Home directory

- [ ] Build server-side Home repository summaries keyed by canonical `repositoryId`.
- [ ] Render visible resolved repositories; reuse existing visibility/`includeHidden` handling.
- [ ] Order by pinned → active → idle(recent) → stale, reusing `deriveLifecycle`/`lastSeenAtFor`/`pinned` (prefer sharing `sortRepositoriesForDisplay`'s inputs over re-deriving).
- [ ] Add the zero-repository state and the persistent "Manage repositories" affordance (link only; [[pljvmyh]] implements it).
- [ ] Keep unresolved activity out of normal repository cards.
- [ ] Add per-repository/per-domain partial-failure handling.

### Phase 4 — Checkout/worktree Home model

- [ ] Consume `buildDeveloperRuntimeSnapshot`'s repository → `roots` view for checkout identity.
- [ ] Render every known checkout/worktree with branch/name.
- [ ] Associate the promoted Runtime entrypoint per checkout.
- [ ] Keep inactive checkouts visible without a link.
- [ ] Use a compact/collapsible presentation for repositories with many worktrees.

### Phase 5 — Runtime quick accessibility

- [ ] Show the promoted `primaryEntrypoint` per active checkout with a clickable port/URL.
- [ ] Treat host-process and container/Compose sources identically (already true in `primaryEntrypointFor`).
- [ ] Show only the primary entrypoint; keep secondary ports on `/runtime`.
- [ ] Deep-link to the full Runtime page.

### Phase 6 — Git repository summary

- [ ] Add a reusable repository Git/checkout summary contract decoupled from Runtime's view model.
- [ ] Surface clean/dirty, ahead/behind, and worktree-level status on Home rows.
- [ ] Aggregate repository-level Git warnings for the card.
- [ ] Reuse existing Runtime checkout Git data/caches.

### Phase 7 — Plans integration

- [ ] Add repository-associated plan counts/status from existing plan data.
- [ ] Represent coverage explicitly (`available`/`partial`/`unavailable`/`stale`); never render a misleading authoritative `0 plans`.
- [ ] Add seven-day recently-changed data on detail (Git last-commit, mtime fallback; label "Recently changed").

### Phase 8 — Tokens integration

- [ ] Add a compact repository-level token/session warning signal to Home.
- [ ] Expand recent/high-severity findings on detail.

### Phase 9 — Agents/config integration

- [ ] Establish the stable repository agent/config slot with `configured`/`not configured`/`unavailable`/placeholder states.

### Phase 10 — Repository detail composition and polish

- [ ] Compose the deeper cross-domain detail sections and domain navigation.
- [ ] Apply partial-failure handling on detail.
- [ ] Handle responsive layout and large-worktree repositories.
- [ ] Add consistent healthy/loading/empty/error states and keyboard-accessible navigation; preserve focus across refreshes; avoid rebuilding open controls during polling.
- [ ] Update portal reference docs for Home-as-directory and the repository detail route.

Adjust ordering if implementation inspection suggests a stronger sequence; Phases 1–2 (identity + routing) should land before the visible directory work in Phase 3.

## Validation

Use focused domain tests while building, then the full suite because Home crosses routing and several shared domains.

Existing repo-native checks to preserve and extend:

```text
npm run test:repositories
npm run test:repositories-service
npm run test:repositories-api
npm run test:developer-runtime
npm run test:developer-runtime-repository-merge
npm run test:plans
npm run test:plans-portal-state
npm run test:telemetry
npm test
```

Add focused coverage for:

- `urlKey` allocation stability, collisions, and reserved aliases; a registry at an older version resets to fresh (with a backup) rather than carrying old records forward;
- `urlKey -> repositoryId` resolution, including hidden/unknown keys;
- dynamic `/repositories/:urlKey` page routing, missing/invalid key handling, and browser history, with the static nav manifest unchanged;
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
- `urlKey` is allocated at record creation, collision-safe, and consumable by [[pljvmyh]]; an older registry resets to fresh (with a backup) rather than migrating.
- One failed domain does not break the full repository card or detail page.
- No absolute filesystem paths leak through general browser-safe repository payloads.
- Runtime remains the deeper operational surface.
- Targeted tests and `npm test` pass.
