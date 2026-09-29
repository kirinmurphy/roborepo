# jdocmunch

jdocmunch-mcp is a documentation intelligence MCP server. It indexes doc files into section-level
chunks and exposes search, tables of contents, and targeted retrieval, so the agent reads the one
section it needs instead of whole files. It complements [jcodemunch](jcodemunch.md): jcodemunch
handles code, jdocmunch handles docs. The `jdocmunch` package installs it, the
`roborepo index docs` command, a session-start hook, and the matching rules.

```sh
roborepo package enable jdocmunch
```

## Tools The Agent Uses

| Tool | What it does |
| --- | --- |
| `list_repos` | Shows which doc sets are indexed; called at session start |
| `search_sections` | Weighted search returning section summaries, not full content |
| `get_toc` / `get_toc_tree` | Flat or hierarchical section listing for a doc set |
| `get_section` / `get_sections` | Full content of one or several sections by ID |
| `get_section_context` | A section plus its ancestor headings and child summaries |
| `index_local` | Indexes a local docs folder |
| `delete_index` | Removes an index |

Claude and Codex both run the server with `uvx jdocmunch-mcp`.

## Indexing

```sh
roborepo index docs docs/   # index a specific docs folder
roborepo index docs         # index the current directory
```

There is no watch mode. Edits to indexed files are picked up automatically; rerun
`roborepo index docs` only when doc files are added or deleted.

The index is stored globally at `~/.doc-index/`, so an indexed doc set is searchable from any
session. There is no CLI command to delete one; remove `~/.doc-index/<name>/` by hand.
`GITHUB_TOKEN` is needed only when indexing a private GitHub repository.

## Index Marker

A successful `roborepo index docs` writes a `.jdm-indexed` marker into the indexed directory. The
session-start hook on Claude and Codex checks for `docs/.jdm-indexed` and, if `docs/` exists
without it, reminds the agent to run `roborepo index docs docs/`. The checkout installer adds
`.jdm-indexed` to your global gitignore (`~/.gitignore_global`) so the marker is never committed.

The generated rules tell the agent to prefer `search_sections`, `get_toc`, and `get_section` over
reading full doc files, and to call `list_repos` at session start.
