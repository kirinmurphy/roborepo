# Setup and Daily Use

This repo owns your agent harness config (Claude Code, Codex, Gemini CLI) and exposes it at the paths agents already read. To install RoboRepo and choose behaviors, start with [First-Time Setup](first-time-setup.md); this guide covers checkout details and daily use.

For install workflow tradeoffs, see [install-workflows.md](install-workflows.md). For system details, see [../reference/architecture.md](../reference/architecture.md).

---

## Platform Support

| Platform | Status                                                                                   |
| -------- | ---------------------------------------------------------------------------------------- |
| macOS    | Primary                                                                                  |
| Linux    | Primary                                                                                  |
| Windows  | Available — less tested; requires Git for Windows or WSL — see [Windows notes](#windows) |

---

## Checkout Notes

These apply when you installed from a Git checkout with `./scripts/install/main.sh` (see
[First-Time Setup](first-time-setup.md#install-from-a-checkout)).

- **Safe to re-run.** Owned copies and rendered rules are refreshed, and your local Claude/Codex
  settings are kept. When a local file differs from the repo version, the `--on-conflict` policy
  decides what happens — see [Config Collision Handling](../reference/config-collision-handling.md).
- **Preview first** with `./scripts/install/main.sh --dry-run`; verify afterwards with
  `roborepo doctor --installed`.
- **Recovering settings.** If a past update left recoverable local settings in a backup,
  `roborepo update` or `roborepo doctor --installed` points you at
  `roborepo maintenance repair local-config --dry-run`; `--apply` restores them.
- **Moved checkout.** If you move or rename the checkout, `roborepo maintenance repair` relinks
  stale symlinks to the new path and leaves copied config alone.
- **Automation.** `--no-presets-onboard` or `ROBOREPO_PRESETS_ONBOARD=skip` skips install-time
  onboarding.

### Change Permission Defaults

Day to day, change permissions in the `/config` page or `roborepo library`. To change the defaults
every machine starts from, edit `manifests/inventory/agent-permissions.json` in the checkout, then
render and check:

```sh
roborepo permissions
roborepo permissions --check
```

The rendered defaults reach an existing machine on the next `roborepo update`.

---

## Daily Use

Everything below runs through `roborepo`. Run it with no arguments for an interactive menu, or call
a command directly. Full reference: [roborepo CLI Commands](../reference/roborepo-cli.md).

### Browse and manage plan docs

Open the local portal and go to `/plans`:

```sh
roborepo web
```

The Plans page discovers Markdown files under `docs/plans/**/*.md` from configured discovery roots.
It works without enabling any workflow package: you can filter plans, open rendered Markdown, inspect
warnings/tasks, and copy repository-aware context.

Enable the Plan Docs package when you want agent workflow prompts and the `/plan-docs` slash command:

```sh
roborepo package enable plan-docs
```

Then use `/plan-docs create`, `/plan-docs start`, `/plan-docs sync`, `/plan-docs validate`,
`/plan-docs review`, or `/plan-docs handoff`.

See [Plan Docs Walkthrough](plan/lifecycle/plan-docs.md) for the full user flow.

### Index and watch a repo

Keep the package-owned code index current so Claude can navigate your codebase. Start this when opening a project you'll be actively coding in. The watcher runs continuously — edits are picked up automatically within the session.

```sh
roborepo package enable jcodemunch       # once per machine, if not already enabled
roborepo index code --watch       # watch the current dir (runs continuously)
roborepo index code path/to/dir --watch
roborepo index code path/to/dir   # one-shot index instead of watching
```

### Index docs

Index a project's documentation so Claude can search sections and headings rather than reading full files. Run once per project to initialize. After that, edits to existing files are picked up automatically via mtime detection — no manual reindex needed. Re-run only when doc files are added or deleted.

```sh
roborepo package enable jdocmunch        # once per machine, if not already enabled
roborepo index docs               # index docs in the current dir
roborepo index docs path/to/dir
```

### Add a shared skill

Use `roborepo skill new` — it scaffolds a package-owned skill resource and refreshes the shared
skill cache plus both `~/.claude/skills/<name>` and `~/.codex/skills/<name>` in one step. The
canonical source lives once in `globals/packages/<package>/skills/<name>/`. Related commands:

```sh
roborepo skill new              # scaffold + refresh shared skill cache + every harness view
roborepo skill adopt <name>     # bring in a skill created outside roborepo (by hand or natively)
roborepo skill inspect <name>   # inspect ownership, native metadata, collisions, and install state
roborepo skill native           # summarize native Claude/Codex plugin entrypoints
roborepo skill native --full    # print native help output inline
roborepo doctor --installed     # verify the live skill cache and harness links are current
```

### Edit global rules (checkout)

Global instruction files are generated tracked outputs:

- `generated/claude/CLAUDE.md`
- `generated/codex/AGENTS.md`
- `generated/gemini/GEMINI.md`

Edit source fragments instead:

- `globals/system/rules/shared/` for behavior shared by every harness
- `globals/system/rules/<harness-id>/` for behavior specific to one harness
  (`claude/`, `codex/`; add `gemini/` if Gemini ever needs its own fragments)

Shared fragments render into every managed harness. A per-harness directory is created only when
that harness needs rules the others should not get.

Then render and check:

```sh
roborepo config rules
roborepo config rules --check
```

### Check harness health

Something feels off — commands missing, config not loading, hooks not firing. Run this to verify key files, JSON/TOML config, helpers, and dependencies.

```sh
roborepo doctor                        # concise health summary
roborepo doctor --verbose              # include every passing check
roborepo doctor --installed            # also check harness links and managed skills
roborepo doctor --installed --verbose  # include every passing check
```

### Run noisy commands with trimmed output

Some commands flood the terminal. Wrap them to get only the useful tail.

```sh
roborepo run <command> [args]
```

---

## Windows

Git Bash is required — hook scripts and bin commands are bash and will not run without it.

**Requirements:**

- **Git for Windows** (https://git-scm.com) — install this first; provides Git Bash
- **Windows Developer Mode** or **admin PowerShell** — required for symlinks (`Settings > System > For Developers > Developer Mode`)

**Install from Git Bash:**

```bash
./scripts/install/main.sh
```

**Config paths on Windows:**

| Item          | Path                    |
| ------------- | ----------------------- |
| Claude config | `%USERPROFILE%\.claude\` |
| Codex config  | `%USERPROFILE%\.codex\` |
