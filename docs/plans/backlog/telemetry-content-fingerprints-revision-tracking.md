---
id: f0j4j8y2
priority: high
next_action: Scope the open questions (which paths count, hash granularity, hash-material rules), then implement content fingerprints in the snapshot builder and the schema bump
blocked_by: []
depends_on: []
related:
  - k8mngttv
  - roborepo-telemetry-events-experiments
reviewed_commit:
---

# Telemetry Content Fingerprints: Skill and Rule Revision Tracking

## Summary

Track skill and rules FILE changes as conditions in telemetry. Today a same-ID edit is
invisible: snapshot identity hashes package/skill ID lists, not file contents, so editing
`SKILL.md` or a rules file produces the identical snapshot_id and the system cannot tell
the revision changed. This plan adds content fingerprints (hashes only, never contents) to
the config snapshot so "skill X v1.1 → v1.2" and "rules content changed" become tracked,
comparable conditions.

This is the "why it matters" in one example: with fingerprints, an edit to a skill's
instructions becomes a ledger row and a condition boundary, so the report can answer
"did spikes drop after the skill update?" and "do sessions on v1.2 cost fewer tokens per
invocation than v1.1?" Without it, months of sessions before and after the edit are
indistinguishable.

Companion to [[k8mngttv]] (the /tokens conditions report). That plan builds the
events × conditions correlation machinery; this plan supplies the revision conditions it
will correlate against. Sequencing: its phases 1–2 ship first; this work lands when its
phase-3 groundwork (ambient hash in snapshot material) is in place.

## Context

Condition scope tiers were decided during the conditions-report design (see [[k8mngttv]],
Decision 11): rules and hooks are AMBIENT conditions (affect every session); skills and
MCP calls are INTERACTION-SCOPED (affect one invocation). Content revisions belong to the
same tiers: a rules edit is an ambient change; a skill edit changes what runs on its next
invocation.

User framing that set the priority: "a skill that has been updated is essentially a
different thing for purposes of tracking tokens," and "we should also be tracking if skill
and rules files change."

## Current state (verified source audit, 2026-09)

- **Snapshot identity is ID-based, not content-based.** `computeSnapshotId`
  (`scripts/cli/telemetry-schemas/snapshot-schema.mjs:15-26`) hashes sorted ID arrays
  (packages, rules, skills) plus hooks/commands/flags objects. A same-ID file edit yields
  the same snapshot_id.
- **`rules` is always empty** in built snapshots (`buildEffectiveSnapshot`, lines 58-87)
  and skill "installed" is a Claude-skills-dir symlink check (`scripts/cli/config.mjs:185-205`)
  even for Codex snapshots — the provider-path audit below must fix both before
  fingerprints are meaningful.
- **Snapshots are SessionStart-only** (`scripts/cli/telemetry-capture.mjs:511-555`): built
  once, ID cached per session. Mid-session edits are attributed to the next session start.
- **Partial prior art:** the per-session `intervening.diff_fingerprint` hashes
  `git diff --stat HEAD` of the session's project repo (capture v3, `intervening` field).
  That covers in-repo rules files, NOT skill install targets, and it is a change signal,
  not a persisted revision identity.
- **Hash-on-persistence precedent:** `privacyHash` (`telemetry-schemas/hash.mjs`) is the
  shared hash primitive; snapshot dedupe-by-ID persistence already exists
  (`telemetry-schemas/persistence.mjs`).

## Goals

- Same-ID content edit → different snapshot_id; unchanged content → dedupes exactly as today.
- The stored snapshot names WHICH file changed (`{id, hash}` pairs), not just "config
  changed" — so the ledger can say "jdocmunch search skill updated," never a bare hash diff.
- Rules content participates: an in-repo rules edit or package-rendered rules change is an
  ambient condition ("rules content changed"), indistinguishable by origin — by design.
- Skill revisions become invocation-scoped conditions (v1.1 vs v1.2 comparisons).
- Privacy: hashes only. Raw skill/rule file text never persists to spool or snapshot stores.

## Non-goals

- Mid-session refresh: an edit lands at the next SessionStart; the UI labels it "first
  observed" (honest interval, not an invented timestamp).
- Invoked-vs-installed attribution (a separate capture gap; not this plan).
- Any UI work on /tokens — the conditions report ([[k8mngttv]]) renders these conditions;
  this plan only makes the data exist.

## Proposed design

1. **Per-file content fingerprints in the snapshot.** `buildEffectiveSnapshot` gains
   `{id, hash}` pairs: one per installed skill (SKILL.md content) and one per contributing
   rules source. Hash with `privacyHash` over normalized content.
2. **Fingerprints join the snapshot identity material.** `computeSnapshotId` includes the
   fingerprint set, so a content edit produces a NEW snapshot_id; unchanged content dedupes
   as today.
3. **Capture point stays SessionStart.** The hot path is untouched — the heavier
   config-reading import graph already loads only there (`telemetry-capture.mjs`'s
   dynamic-import discipline).
4. **Schema version bump with backward-compatible reads.** Snapshots without fingerprints
   (old spools) still analyze; revision conditions render as honest nulls there.
5. **Analysis exposure.** Revision boundaries become first-class conditions: event rates
   compared across a revision boundary; per-revision invocation metrics for skills
   (frequency-normalized, per [[k8mngttv]]'s relative-metrics conventions).

## Implementation checklist

- [ ] Audit and enumerate fingerprint targets: installed skill dirs per harness
      (provider-specific paths — fix the Claude-dir-only install check first), global rules
      files, workspace rules, package-rendered rules sources
- [ ] Add `{id, hash}` content fingerprints to `buildEffectiveSnapshot` (privacyHash;
      never contents)
- [ ] Include fingerprints in `computeSnapshotId` material; bump `SNAPSHOT_SCHEMA_VERSION`
- [ ] Persistence: verify dedupe still collapses identical sessions; old-schema snapshots
      load without error (mixed-version spool fixture)
- [ ] Analysis: revision-boundary condition rows + per-revision skill invocation metrics
- [ ] Analysis: ambient "rules content changed" detection for the ledger (pairs with
      [[k8mngttv]] phase 2's ambient-change records)
- [ ] Tests: same-ID edit changes snapshot_id; unchanged content dedupes; mixed-version
      reads; privacy (no file content in spool or snapshot stores); provider-correct skill
      path resolution
- [ ] Portal support: condition rows carry the revision label ("v1.1 → v1.2") for the
      conditions report's ledger and popups

## Validation

- `npm run test:unit` green; new assertions in `telemetry-schemas-check.mjs` (fingerprint
  sensitivity, dedupe invariance), `telemetry-capture-v3-check.mjs` (changed-file flow),
  cohort/compare checks (revision-boundary fixtures)
- Privacy assertions: spool lines and snapshot stores asserted free of skill/rule text
  (same discipline as `testRawCommandNeverPersisted`)
- Real-path check: fingerprint of an actually-installed skill resolves on both Claude and
  Codex harness homes (the current Claude-only path bug is fixed, not papered over)

## Risks

- **Hash churn:** any formatting-only edit changes the hash and creates a condition
  boundary with no behavioral meaning. Mitigation: normalize content before hashing
  (strip whitespace-only deltas) — accepted imperfection, documented in the UI as
  "content changed."
- **Cost:** hashing every skill/rules file at every SessionStart adds I/O to the one
  heavier capture path; bounded by file counts (~dozens), same order as the existing
  config read.
- **Schema bump:** old spools must keep analyzing — mixed-version fixture is mandatory
  before merge.

## Open questions

- **Which paths count?** Installed skill dirs per harness (audit provider paths first —
  current install check is Claude-only), global rules files, workspace rules. Likely all
  three, but the provider-path audit decides scope.
- **Hash granularity:** whole-file vs per-entry (per rule, per section)? Whole-file first;
  per-entry only if ledger labels need to name individual rules.
- **Hash-material rules:** harness identity stays excluded from snapshot identity (current
  behavior) while fingerprints are included — confirm this doesn't collapse distinct
  per-harness revisions into one.
