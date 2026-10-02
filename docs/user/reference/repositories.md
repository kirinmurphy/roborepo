# Repositories in the Portal

The portal Home page is a directory of the repositories RoboRepo already knows about. It puts
active checkouts and their running applications first, then links each repository to a persistent
detail page at `/repositories/<urlKey>`.

## Open the directory

Run:

```sh
roborepo web
```

The command opens `/`. No repository setup is required: Runtime discovery and existing RoboRepo
activity populate the shared registry. Home does not search every folder on disk. If the directory
is empty, start a local project and open [Runtime](runtime.md) so RoboRepo can observe it.

Hidden repositories do not appear. Runtime's settings can restore a repository that was hidden by
the ageing sweep.

## Directory order

Home uses the same lifecycle facts as Runtime. It orders repositories as follows:

1. pinned;
2. active;
3. idle, most recently seen first;
4. stale.

Activity that Runtime cannot associate with a canonical repository appears separately as unresolved
activity. It is not promoted into a repository card.

## Repository cards

Each card combines a compact view of several domains:

- **Workspace and Git** — every known main checkout and worktree is named by its branch when
  available. Dirty state, ahead/behind counts, and base-branch drift appear on the same row.
- **Running application** — a checkout's promoted primary application is a clickable port. A host
  development server and a Compose-backed application behave the same here. Secondary ports and
  hosting diagnostics remain on Runtime.
- **Worktree plan** — an active plan whose `worktree` field names a linked worktree appears beneath
  that worktree's row. The match is exact: the plan's value must equal the worktree's Git
  administrative name, exactly one active plan must claim it, and exactly one known worktree must
  carry it. Branch names and checkout paths are never used to guess.
- **Additional Plans** — shown while the repository has at least one active plan. It lists every
  active plan that is not beneath a worktree: plans with no `worktree`, plans naming a worktree Home
  does not currently show, and plans whose match is ambiguous. Its Active and Backlog counts cover
  the whole repository, including plans shown beneath worktrees. When every active plan sits beneath
  a worktree, the heading, counts, and **all plans** link remain. When Plans coverage is partial,
  the section says so. A repository with no active plans, or one Plans has not scanned, shows no
  Plans section. Completed plans never fill the section.
- **Tokens** — recent repository-associated session warnings appear when a cached Tokens analysis is
  available.
- **Agents** — repository-scoped agent configuration is currently unavailable and is labeled that
  way.

Cards with more than five checkouts put the additional rows in an expandable section. An open
section and a focused control are not rebuilt during polling, so keyboard position and expanded
state remain stable.

## Repository detail

Select a repository name or its **Details** link to open `/repositories/<urlKey>`. The URL is
bookmarkable and browser Back/Forward navigation works normally. The detail page includes:

- browser-safe identity and discovery provenance;
- all known checkouts, Git state, and promoted application links;
- repository-level Git warnings;
- active/backlog plan counts and plans changed in the last seven days;
- recent Tokens warnings and their severity;
- the current Agents availability state;
- links to the full Runtime, Plans, Tokens, and Agents pages.

Those domain links are currently unscoped. Repository-scoped domain navigation can be added without
changing the detail URL or its stable `urlKey`.

An unknown or hidden key renders an explicit unavailable page and the overview API returns 404.

## Status and freshness

Runtime, Plans, and Tokens refresh independently. Each domain therefore carries its own status:

| Status | Meaning |
| --- | --- |
| `available` | Cached data is present. |
| `partial` | Data is present, but coverage or collection was incomplete. |
| `stale` | The latest refresh failed and last-known data is retained. |
| `unavailable` | No usable data is currently cached for that domain. |

One unavailable domain does not remove the repository or block the other sections. Home and detail
poll cached summaries every ten seconds; those polls do not start Runtime discovery, a Plans scan,
or Tokens analysis.

## Privacy boundary

Repository identity is path-free. Repository ids, summaries, browser keys, and URLs never contain an
absolute path, so they mean the same thing on every machine and are safe to paste into a chat or an
issue. A repository with no Git remote gets an opaque `local:` id derived from its path rather than
the path itself.

Checkout paths are machine-local facts, and the browser receives them only as checkout details. The
Home payload includes each known checkout's path for its tooltip and copy button. It is never used
as identity and never appears in a URL. The portal listens on `127.0.0.1` only and answers only
requests addressed to a loopback host name, so the payload is served to this machine's browser and
not to other websites open in it.

Repository pages receive an allowlisted payload: the display name, stable browser key, lifecycle,
branch and worktree identity, selected Git facts, checkout paths as above, and the promoted
application's origin and Runtime key, which Home uses to discover that application's routes. A
linked worktree's identity is its Git administrative name, which contains no path. The payload does
not include:

- absolute paths in repository ids, browser keys, or URLs;
- the canonical internal repository id in the URL;
- Runtime keys for anything other than a checkout's promoted application;
- secondary ports, PIDs, container ids, or Compose internals;
- telemetry prompts or transcript content.

The browser key is allocated once and remains stable if the repository display name changes.

## Registry compatibility

Repository browser keys require registry schema version 2. When RoboRepo first encounters an older
version 1 registry, it replaces that registry with a fresh version 2 file. It does not migrate or
back up the old file. Runtime and later discovery repopulate repository facts, but version 1 pins,
hidden/restored choices, aliases, enrollments, timestamps, and local-root ownership are discarded.
An unknown future schema version is rejected instead of being overwritten.
