---
id: k8mngttv
priority: high
next_action: Implement Phase 1 capture surfaces (per-model tool-call rows, capture-time context snapshot fields), then the report aggregation, then the portal conditions report and event ledger
blocked_by: []
depends_on: []
related:
  - roborepo-telemetry-events-experiments
  - f0j4j8y2
reviewed_commit:
---

# Tokens Conditions Report: Events × Conditions Correlation on /tokens

## Summary

Extend the /tokens report from "what problems happened" to "what problems happened, under
which conditions, and what changed beforehand." The page already tracks EVENTS (spikes,
loops, read warnings, over-testing); this plan adds the CONDITIONS dimension (model, repo,
harness, ambient configuration) and correlates the two, plus relative per-model metrics and
a unified event ledger. Correlation language is association-only — the system never claims
causation.

The approved UX is fully specified and user-reviewed in the design mock
`portal/mockups/tokens-connectivity-vision.html` (sections, layout, copy, and interaction
states below reference it as the visual contract).

## Context

The v2 dashboard (shipped 2026-09, PR #14) renders a waste decision line, action items,
Investigate evidence sections, and an agent-ready prompt. The user's next goal, stated
directly: associate the events we already track with potential triggers, and derive
potential conclusions about what might have led to them — plus flat relative metrics
(e.g. tokens-per-call per model, input:output mix normalized by frequency) that drive
decisions like "which model gives me more efficiency."

Design decisions were made interactively across multiple sessions and are all restated in
the Design decisions table below (the working decision log was a session-local file, since
retired; this plan is the durable record).

### Design decisions (user-verified)

| # | Decision | Detail |
|---|---|---|
| 1 | Problem-first | Warnings open evidence; the ledger and history support investigation, they are not the front door. |
| 2 | Organizing frame | EVENTS (already tracked) × CONDITIONS (surfaced by this plan) → potential conclusions. Plus flat RELATIVE metrics. |
| 3 | Sequencing | Ship model/repo/harness conditions first (capture-ready today); packages/skills and marker conditions follow once capture gaps close. |
| 4 | Visual placement | Condition context folds into Investigate rows; ONE new section "Do problems follow a condition?"; relative metrics live in Investigate as "Which model costs the most per call?". |
| 5 | Mark change | One form, two intents (cause-suspected = backdated, response = now); behavioral changes only; auto-attaches when launched from a finding; watching-kinds declared per marker. |
| 6 | Review view | Marker rows carry honest verdict states (recorded → collecting → comparison available → can't compare fairly); association language only. |
| 7 | Ledger over chart | The marks-only timeline strip is superseded by a chronological event ledger (scales by scrolling); no even-dated chart (empty space), no swim lanes (don't scale). |
| 8 | Marker management | "Your changes" section is the canonical surface for markers: edit, delete, watching-kinds. |
| 9 | Conditions report | Category roll-up cards (Models / Repos / Harnesses / Marked changes), full-width with Fewer\\|More-than-mean internal columns (revised from Better\\|Worse — direction of deviation, not quality); report-not-inventory: only mean deviations on the card, every item in a per-category popup. Percent vs category mean only above a minimum event-count floor; below the floor, raw rate + denominator. Never multipliers. |
| 10 | Copy diet | One-line section subtitles; dense explanations live in ⓘ tooltips (structured fact lists), never dense inline copy. |
| 11 | Condition scope tiers | AMBIENT (rules, hooks, permissions, MCP registration, harness config — affects every session) vs INTERACTION-SCOPED (skill revisions, MCP calls, commands — affects one invocation). |

### Condition scope tiers (Decision 11, audited against the package system)

Audited every resource type in `scripts/cli/package-catalog.mjs` `RESOURCE_TYPES` and all 24
`globals/packages/*/package.config.json` files:

| Tier | Primitives | Rationale |
|---|---|---|
| Ambient (every session) | `rules` (8 pkgs), `hooks` (10), `permissions` (1), `codex_tool_approvals` (2), `mcp` registration (2), `plugin` (1), `harness-config` (2), `service` (1), `runtime-asset` (5) | Installed state that shapes behavior continuously; never "invoked" by the model. Hook events vary (SessionStart vs PreToolUse) but hooks are installed state, not invocations. |
| Interaction-scoped (one invocation) | `skill` (14: 7 auto, 7 manual), `slash-command`/`cli-command` (3+), MCP tool calls | Exist only during an invocation; even "auto" skills are auto-triggered per-use, injecting context only when they run. |

**Package bundle resolution:** a package's ambient footprint = rules + hooks + permissions +
MCP registration + harness-config; its interaction surface = skills + commands + MCP calls.
Enabling a package produces ONE ambient ledger row only if the effective ambient context hash
changed (naming the delta, e.g. "+2 rules, 1 SessionStart hook"). A skills-only package (13 of
24) produces no ambient row. Hand-edited rules and package-rendered rules are indistinguishable
to correlation — both are "rules content changed," which is the honest framing.

### Honesty constraints (non-negotiable, from a source audit)

Verified against current capture code, these limits shape what the UI may claim:

- **Model is a state, not an event.** Capture records the model in effect per capture
  (`scripts/harnesses/transcript-parse.mjs` — latest observed; Codex resolves both
  `session_meta.payload.model` and `turn_context.payload.model`). There is no "model switched"
  event; mid-session switches are only approximately inferable and are not asserted.
- **Config snapshots are SessionStart-only** (`scripts/cli/telemetry-capture.mjs`
  `resolveConfigSnapshotId`): built once, ID cached for the session. Differences between
  successive snapshots show "observed by this session," never the change moment. Mid-session
  changes are invisible until the next session start.
- **Snapshot identity hashes ID lists, not file content** (`snapshot-schema.mjs`
  `computeSnapshotId`): a same-ID skill file edit produces the same snapshot_id — content
  revisions are undetectable *via snapshot IDs* today (deferred: skill/rule revision
  fingerprinting is a separate follow-up plan). Note: the ambient context hash DOES include
  rules content, so a same-ID rules edit will surface as an "ambient changed" ledger row —
  coarse-grained (change detected, not which edit), and skill-file revisions remain invisible
  until the fingerprinting follow-up lands.
- **Exposure ≠ invocation.** Snapshots record what was configured; captures record tool
  calls, not which skill ran. Condition labels must distinguish configured / observed-available
  / observed-used.
- **Marker provenance.** `createMarker` stamps NOW and inherits the portal process's CWD
  (`createMarkerFromPortalRequest` passes no cwd). Phase 1 markers need explicit effective-time
  and repo scope before they can anchor comparisons.
- **Correlation, never causation.** Every conditions claim is "associated with" / "more often
  with," with denominators. Confidence labels stay heuristic; insufficient-sample cells render
  as explicit nulls, never 0%. UI wording follows: "fewer spikes than the category mean,"
  never "better outcomes"; verdict bands describe direction of deviation, not improvement.
- **Per-call model attribution is approximate for mixed sessions.** Model is a session-level
  state ("latest observed") for most harnesses; per-call model breakdown is exact only where
  the harness records turn-level model (Codex). In a mixed-model session, per-call metrics
  attribute all calls to the last-seen model — the relative-metrics section must say so.

## Goals

- Each Investigate finding shows the conditions in effect when it fired (model, harness, repo,
  ambient config summary, nearby changes).
- A per-category conditions report answers: "do any items in this category run better or worse
  than the category mean?" (models, repos, harnesses, marked changes).
- Relative metrics answer: "which model costs the most per call?" (tokens-per-call and
  input:output mix, normalized by frequency, share-first).
- A chronological event ledger unifies problems, manual marks, and auto-tracked ambient
  changes, replacing the marks-only timeline strip.
- "Mark a change" records behavioral changes with effective time and watching-kinds; marker
  rows carry honest review states over time.
- Every event×condition claim carries sample sizes, denominators, and association-only wording.

## Non-goals

- Skill/rule file-content revision fingerprinting (separate follow-up plan).
- Mid-session config refresh in the hot capture path (ambient changes are attributed to the
  next session start, labeled honestly as "first observed").
- Causal claims, dollar costs, or volume-over-time charts.
- Removing any existing Investigate panel or data (new surfaces deepen, not replace).
- Runtime LLM prose: all text is deterministic templates authored in the analysis layer.

## Current state

Relevant existing machinery (all verified this session):

| Capability | Location | Gap for this plan |
|---|---|---|
| Flagged-event strip | `portal/tokens2/app.js` `renderTimelineStrip` | Superseded by the ledger; delete after ledger ships |
| Marker persistence + endpoints | `telemetry-markers.mjs`, `portal-routes-telemetry.mjs` `/api/telemetry/markers` | No effective-time (always NOW), no repo scope (process CWD), no watching-kinds, not linked to findings |
| Before/after comparison | `telemetry-compare.mjs` `compareAcrossMarker` | Session-cohort only; excludes marker-spanning sessions; minimum 10 sessions/cohort — reuse for marker verdicts, not per-event context |
| Per-model data | `capture.session.model`; cohort filter `models` dimension (`telemetry-cohort.mjs`) | Not surfaced per-event on /tokens; no per-model relative metrics |
| Capture record | schema v3 with `config_snapshot_id` | Snapshot ID exists per capture but is not resolved/joined for /tokens display |
| Mock pipeline | `portal/tokens2/mock-spool.jsonl` + seeding scripts | No markers, no condition variety (model/repo mix exists); needs honesty-state sessions |

## Proposed design

Three capture surfaces feed one report layer, which feeds four portal sections. The mock
`portal/mockups/tokens-connectivity-vision.html` is the visual contract for section order
(waste → action items → Investigate → conditions report → ledger → your changes → prompt),
layout, and copy.

### 1. Capture: condition surfaces on the record (additive, schema v4)

- **Per-model tool-call rows:** record `model` on each capture's session block (exists) and
  expose per-call model breakdown in analysis (new aggregation over existing fields).
- **Context snapshot join:** analysis resolves each session's `config_snapshot_id` to its
  stored snapshot (enabled package IDs, installed skill IDs, hook counts) so conditions like
  "jcodemunch enabled" are derivable at report time without new capture fields.
- **Ambient context hash:** a hash of the effective ambient surface (rules content + hook
  IDs + permissions + MCP registrations) computed at SessionStart alongside the existing
  snapshot; successive differing hashes become auto-tracked "ambient changed" ledger rows.

### 2. Analysis: conditions aggregation (deterministic, in `telemetry-analyze.mjs`)

- **Per-event conditions:** for each spike/loop/read-warning row, the model, harness, repo,
  and ambient hash in effect at its capture.
- **Category roll-up:** per condition category (model / repo / harness), per item: event rate
  with vs without, vs the category mean, with denominators and a ≈-mean band (±20% starting
  point; bands are data-driven, never manufactured danger limits).
- **Cross-category confounding:** categories overlap — the same event backs multiple cards
  (e.g. opus spikes and payments-api spikes may be the same events). Roll-ups are computed
  per category independently with no cross-attribution claim; each conditions card and
  popup carries a standing caveat ("categories overlap — one event can appear on several
  cards; differences are associated, not attributed").
- **Relative model metrics:** tokens-per-call and input:output mix per model, normalized by
  call frequency; minimum sample before a model renders (aligned with the existing
  minimum-sample discipline in the metrics registry); mixed-model sessions attributed to
  last-seen model with an explicit caveat in the section tooltip.
- **Marker verdicts:** reuse `compareAcrossMarker` for watched event kinds across an
  effective timestamp, surfacing its existing confidence/data-quality labels verbatim.

### 3. Portal: four sections (per the mock)

- **Investigate additions:** each finding row gains a dim conditions line (model · repo ·
  harness) clickable into the session popup; popup gains a Conditions fact row.
- **"Do problems follow a condition?"** — per-category full-width cards with "Fewer |
  More than mean" internal columns (stack on small screens; direction-of-deviation labels,
  not "better/worse"); percent vs category mean only above a minimum event-count floor —
  below the floor, cells render raw rate + denominator (e.g. "2 spikes / 38 sessions vs
  mean 1 / 31") instead of an unstable percentage; only deviations on the card;
  per-category popup lists every item incl. ≈-mean, with denominators, the overlap caveat,
  and "not enough data" cells. Association wording only (see Honesty constraints).
- **"Which model costs the most per call?"** (inside Investigate) — relative metrics,
  share-first formatting per the existing share-units convention.
- **Event ledger** — chronological, newest first: problem rows (colored severity icons:
  red spike, yellow loop, default read) and change rows (manual marks = pencil icon;
  auto-tracked ambient changes = dashed icon), purple-tinted change rows spanning all three
  columns, 10px row separation, scroll container max-height 85vh / min-height 500px.
  **Ledger change-row scope:** Phase 1 ships problem rows only; Phase 2 adds manual marks
  and auto-tracked ambient-change rows (ambient rows carry no verdict badge). The mock's
  "Skill revision — v1.1 → v1.2" auto-tracked rows are OUT OF SCOPE until the revision
  fingerprinting follow-up plan lands (snapshots hash ID lists, not content); the mock is
  amended accordingly so the visual contract matches what ships.
- **"Your changes"** — marker cards with cause→effect flow ("watching spikes & loops → in
  payments-api"), verdict band (green fewer / red more / blue still collecting — direction of
  deviation wording, not "improved"), Edit/Delete.
- **Mark-change dialog** — title, effective time (now | earlier), optional repo scope,
  optional free-text intent; watching-kinds selection; auto-attaches the finding when launched
  from one. Replaces the hidden v1 banner/button.
- **Copy diet:** one-line subtitles; ⓘ tooltips carry structured explanations (the mock's
  tooltip text is the copy source).

## Implementation checklist

Phased so real-data visibility ships first (user: "the more visibility we get sooner the
better"). Phase 2 marker semantics and phase 3 revision fingerprinting are separate follow-up
plans; this plan includes only their capture groundwork.

### Phase 1 — conditions on real data (model / repo / harness)

- [ ] Capture: record per-call model breakdown aggregation input (schema additive; verify mixed
      v3/v4 spools still analyze — the codebase never gates reads on `.schema`)
- [ ] Analysis: per-event conditions join (model/harness/repo per spike, loop, read-warning)
- [ ] Analysis: category roll-up computation with denominators and ≈-mean band
- [ ] Analysis: relative model metrics (tokens-per-call, input:output mix, minimum sample)
- [ ] Analysis: extend deterministic session findings with condition context
- [ ] Portal: Investigate condition lines + session-popup Conditions row
- [ ] Portal: conditions report cards + per-category popup (per the mock, with overlap caveat
      tooltip and event-count floor rendering)
- [ ] Portal: relative-metrics Investigate section (per the mock, with mixed-session caveat)
- [ ] Portal: ledger section (problem rows first; change rows arrive with markers in phase 2)
- [ ] Mock: amend `tokens-connectivity-vision.html` ledger to drop skill-revision rows (out of
      scope — see ledger change-row scope) and rename Better/Worse columns to Fewer/More
- [ ] Tests: analysis fixtures for roll-up math (denominators, ≈ band, empty-category nulls),
      relative metrics, mixed-schema reads; portal checks for section presence and copy rules

### Phase 2 — markers with semantics (marker conditions + ledger change rows)

- [ ] Capture: ambient context hash at SessionStart; auto-tracked ambient-change records
- [ ] Markers: effective time (explicit, validated), repo scope override (fix the process-CWD
      provenance issue), watching-kinds, finding attachment
- [ ] Analysis: marker verdicts via `compareAcrossMarker` on watched kinds; honest state machine
      (recorded / collecting / comparison available / can't compare fairly)
- [ ] Portal: "Your changes" cards, mark-change dialog, ledger change rows
- [ ] Tests: marker provenance (repo stamping), effective-time backdating, verdict states
      including thin/overlapping cohorts, ambient-hash change detection

### Phase 3 groundwork only

- [ ] Ambient-hash field included in snapshot material (schema bump with backward-compatible
      reads) so the follow-up revision-fingerprinting plan can land without another migration

## Validation

- `npm run test:unit` (all existing check suites stay green; new suites auto-discovered via the
  `scripts/test/*-check.mjs` glob)
- New analysis checks: category roll-up (mean math, bands, denominators, null states,
  event-count floor fallback to raw rates), relative metrics (frequency normalization,
  mixed-session attribution caveat), per-event condition joins, mixed-schema spool reads
- New marker checks: effective-time and scope stamping, verdict-state machine, watching-kind
  filtering (extends `telemetry-marker-cli-check.mjs` patterns)
- Portal checks: section presence/order, one-line subtitle rule (no dense copy regression),
  association-wording rule (no "better/worse outcomes" copy), ledger row rendering,
  conditions-popup content incl. overlap caveat
- Playwright suite (`scripts/test/portal-ui/`): conditions cards, ledger, popups, both themes;
  hermetic boot with seeded mock spool exercising every display state (per the mock-data rule:
  same pipeline as real data, only the source file differs)
- Screenshots of every rendered state (dark + light) attached to the implementing PR — standing
  acceptance requirement for portal UI work

## Risks

- **Small-sample means mislead.** With few sessions per item, a category mean swings on one
  outlier. Mitigation: minimum-sample gates per cell; ≈-band labels; percent deviation only
  above a minimum event-count floor (below it, raw rate + denominator); "not enough data" as
  a first-class state (the mock models this).
- **Cross-category confounding (Simpson's paradox).** Model/repo/harness usage is correlated;
  the same events back multiple category cards, and per-category roll-ups can overstate an
  item. Mitigation: standing overlap caveat on every card/popup; no cross-attribution claims;
  Investigate rows carry the per-event ground truth.
- **Ambient-hash false positives** (hash changes without a meaningful behavior change) could
  flood the ledger. Mitigation: hash only the ambient surface that actually renders into
  harness context; dedupe consecutive changes; cap visible auto-tracked rows with a "N more"
  affordance if needed.
- **Marker provenance change is behavior-affecting** (repo stamping): existing markers keep
  their stored identity; only new markers get explicit scope. Verify no reader assumes CWD.
- **Ledger growth.** Unbounded rows are fine (scrolls), but auto-tracked noise is not — the
  ambient-row gating above is the control.
- **Schema v4 additive risk:** the pipeline reads never gate on `.schema`, but the snapshot
  material change (phase 3 groundwork) is a schema bump — needs the mixed-version test.

## Open questions

- **≈-mean band width AND deviation units:** ±20% is the working default from the mock; the
  deeper open question is whether percent deviation is meaningful for rare event kinds at all
  (2 spikes vs 1 is "100% more"). Phase 1 ships the event-count floor (percent only above the
  floor, raw rates below); band width and the floor value are confirmed against real data
  before phase 1 ships (too narrow floods the report, too wide hides real deviations).
- **Ledger retention:** should the ledger window match the report window (range filter) or
  always show all history? Mock shows all; a range filter may be phase 2 polish.
- **Marker watching-kinds vocabulary:** resolved — fixed vocabulary of the four existing event
  kinds (spike, loop, read warning, over-testing) for correlation; extending it is a follow-up.
