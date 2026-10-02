# Start Workflow

1. Resolve the selected plan.
2. Validate it is not completed or archived.
3. Verify current plan claims against the repository.
4. Update obsolete context before implementation.
5. Confirm dependencies and blockers.
6. When implementation will run in a linked worktree, record that worktree's Git administrative
   name in `worktree` (see "Worktree association" in `plan-schema.md`). Leave it empty when work
   runs in the main checkout or no worktree exists yet.
7. Move from `backlog/` to `active/` when work is genuinely beginning.
8. Preserve stable `id`.
9. Update links or references affected by the move when necessary.
10. Begin the plan's next actionable task.
11. Run the smallest relevant verification.

A plan already in `active/` is not moved again; record or correct `worktree` in place.

## Under `plan-start`

When `plan-start` drives the start, Plan Docs still owns steps 6-9 — the frontmatter value and the
lifecycle move — and `plan-start` owns everything around them: resolving the worktree first,
committing only the canonical plan paths on the base branch, and holding implementation outside the
worktree until its start validator approves. Perform steps 6-9 in the primary checkout, then return
to `plan-start`'s transition for the commit and validation; do not begin step 10 until it approves.
See `plan-start`'s `references/start-validation.md`.
