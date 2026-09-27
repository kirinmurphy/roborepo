# First-Time Setup

Use this guide to install RoboRepo, run it for the first time, and choose which behaviors it
manages.

Works with Claude Code, Codex, and Gemini CLI — any one of them, or any combination. roborepo
discovers whichever are installed and manages those; see
[Supported Harnesses](harnesses/supported-harnesses.md) for what each one receives. Requires
**Node.js 20+**. Supports macOS and Linux; Windows support is available but less tested.

## Choose An Install Path

| Path | Use when | Start with |
| --- | --- | --- |
| npm package | You want to use RoboRepo | `npm install -g codethings-roborepo-alpha` |
| Git checkout | You are developing RoboRepo, or want your config sourced from a clone | `./scripts/install/main.sh` |
| Offline transfer | Moving a verified package to a machine before it has the repo | [New-Mac Package Install](install-workflows.md#new-mac-package-install) |

## Install The Package

```sh
npm install -g codethings-roborepo-alpha
roborepo web
```

The first `roborepo web` runs one-time setup, then opens the portal. Setup creates the workspace and
state directories, detects which agent harnesses are on this machine, and records that
initialization completed. Later runs only start the portal.

Prefer the terminal? Run `roborepo init` instead. It runs the same setup, then asks whether to
configure in the browser or in the CLI.

## Install From A Checkout

From the root of a clone, preview and then install:

```sh
./scripts/install/main.sh --dry-run
./scripts/install/main.sh
```

The installer puts `roborepo` on your `PATH`; open a new shell afterwards so it resolves. It ends
with a welcome menu that can open the behavior chooser. Then use `roborepo web` or `roborepo` as
above.

## Choose Behaviors

Only the baseline is applied automatically; everything else is opt-in (telemetry stays off unless
you turn it on). Choose behaviors in the portal's `/config` page, or in the terminal chooser:

```sh
roborepo library
```

The chooser walks the same sections the `/config` page shows — Token Optimization, Commands, Code
Conventions, Chat-Time Output, and a read-only Permissions panel — one section per step:

| Key | Action |
| --- | --- |
| `←` / `→` | Move between sections |
| `↑` / `↓` | Move within a section |
| `Space` | Toggle the highlighted item |
| `Enter` | Advance (finishes on the last step) |
| `Esc` | Finish early |

`roborepo library` and `roborepo package manage` are two names for the same chooser. Rerun it any
time to change your choices. Noninteractive runs skip it and apply the baseline headlessly.

`init` is safe to re-run: once initialization has completed it reports that and exits rather than
replaying your choices. If it is interrupted partway — `Ctrl-C`, a failed step, a closed terminal —
the next run resumes instead of starting over. Zero detected harnesses is a valid outcome; install
or launch a harness later and run `roborepo harness refresh`.

## After Setup

```sh
roborepo                     # interactive menu
roborepo update              # pick up new or changed config
roborepo doctor              # health check
roborepo doctor --installed  # verify the installed harness paths
```

There is no separate `install` verb; `roborepo update` re-applies configuration.

## Choose Collision Behavior

The installer always materializes config by copying owned files and rendering generated rules. There is no install mode. Existing user config is preserved unless you choose to overwrite it.

| Policy | Use when | Result |
| --- | --- | --- |
| `keep` | You already have local Claude/Codex config you want active. | Local files stay active; repo candidates are staged beside them as `*_update_TIMESTAMP`. |
| `overwrite` | The repo baseline should replace the local file. | Local files are backed up as `*_original_TIMESTAMP`, then the repo file is copied in. |
| `abort` | You want manual review before any conflict is changed. | Install stops at the conflicting path. |

Use `--on-conflict keep`, `--on-conflict overwrite`, or `--on-conflict abort` to make this explicit. Without a flag, roborepo reuses the saved `onConflict` value from `~/.roborepo/install-state.json`; first noninteractive installs default to `keep`.

For the full decision model and terminal-style walkthroughs, see [Install Workflow Choices](install-workflows.md). For exact collision behavior, see [Config Collision Handling](../reference/config-collision-handling.md).
