import assert from "node:assert/strict";
import { buildConditionsReport } from "../cli/telemetry-conditions.mjs";
import { assertSupersedable } from "../cli/telemetry-markers.mjs";
import { compareAcrossMarker } from "../cli/telemetry-compare.mjs";

const token = { input: 100, output: 10, total: 110 };
const event = (id) => ({ schema: 3, capture_id: `cap-${id}`, call_id: `call-${id}`, harness: "claude", session_id: `s${id}`, session: { model: "m" },
  event: "PostToolUse", ts: `2026-09-01T00:00:0${id}Z`, tokens: token, tool: { name: "Read" } });
const events = [event(1), event(2)];
const marker = (id, extra = {}) => ({ schema: 2, marker_id: id, type: "change", ts: "2026-09-01T00:00:00Z", effective_at: "2026-09-01T00:00:00Z",
  scope: "all", repository_id: null, watching_kinds: [], ...extra });

// Finding 13: findings whose session cannot be resolved are counted, not silently dropped.
const ghost = { harness: "claude", session_id: "ghost", ts: "2026-09-01T00:00:09Z" };
const lost = buildConditionsReport(events, { spikes: [ghost], loops: [ghost], read_warnings: [] });
assert.equal(lost.data_quality.findings_lost_to_fallback, 2);

// Finding 4: equal-timestamp markers order by persisted (append) order, newest first, not by id.
const later = buildConditionsReport(events, { spikes: [], loops: [], read_warnings: [] }, { markers: [marker("mark_aaa"), marker("mark_zzz")] });
assert.deepEqual(later.ledger.filter((row) => row.kind === "manual-change").map((row) => row.id), ["mark_zzz", "mark_aaa"]);

// Finding 6: a supersede must name an existing, unsuperseded change marker.
const existing = [marker("mark_a"), { ...marker("mark_o"), type: "outcome" }, marker("mark_b", { supersedes: "mark_a" })];
assert.throws(() => assertSupersedable("mark_missing", existing), /unknown marker/);
assert.throws(() => assertSupersedable("mark_o", existing), /only change markers/);
assert.throws(() => assertSupersedable("mark_a", existing), /already superseded/);
assert.doesNotThrow(() => assertSupersedable("mark_b", existing));

// Finding 5: an unknown-scope marker is an unfair comparison, not a data-volume shortfall.
const unfair = compareAcrossMarker(events, marker("mark_u", { scope: "unknown" }), "tokens.total");
assert.equal(unfair.confidence, "can't compare fairly");
assert.ok(unfair.data_quality_issues.every((issue) => !/below the minimum/.test(issue)));
console.log("telemetry audit tier 1: ledger order, supersede validation, fairness wording and dropped-finding counter passed");
