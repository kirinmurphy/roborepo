# jcodemunch

jcodemunch-mcp is a local code intelligence MCP server. It indexes a repository into a SQLite
database and exposes symbol search, outlines, reference lookup, and context bundles, so the agent
navigates code structurally instead of reading whole files or running grep. The `jcodemunch`
package installs it, the `roborepo index code` commands, the hooks that steer agents toward it, and
the matching rules.

```sh
roborepo package enable jcodemunch
```

## Tools The Agent Uses

| Tool | What it does |
| --- | --- |
| `resolve_repo` | Registers the repository and returns its ID; called at session start |
| `search_symbols` | Finds function, class, and type definitions by name |
| `get_file_outline` | Shows a file's structure without reading it fully |
| `find_references` | Lists every usage of a symbol |
| `get_context_bundle` | Returns a focused excerpt around a symbol or line range |

Claude and Codex both run the server with `uvx jcodemunch-mcp`.

## Indexing

| Command | When to use it |
| --- | --- |
| `roborepo index code [path]` | After cloning a repository or a large branch change. `path` may be a directory or a single file; defaults to the current directory |
| `roborepo index code [path] --watch` | While actively coding. Runs in a terminal and keeps the index current as files change, so the agent never needs to reindex |

The one-shot indexer skips AI summaries for speed.

## How Agents Are Steered To It

Hooks and rules work together: rules shape the agent's intent before it acts, and hooks enforce at
the tool call.

- **Rules** (in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`) tell the agent to prefer jcodemunch
  tools, call `resolve_repo "."` at session start, index before deeper analysis, refresh the index
  after edits or branch changes, and treat a blocked `Grep`/`Glob` as a redirect.
- **Hooks** on Claude report whether the watcher is running, block `Grep` and `Glob`, and block
  shell commands that read source files directly. Codex gets a session-start reminder. See
  [Claude Hooks](claude-hooks.md) and [Codex Hooks](codex-hooks.md).

The session-start check confirms the watcher is the same live process that started it, so a
recycled process ID after a crash is not mistaken for a running watcher.
