import assert from "node:assert/strict";
import fs from "node:fs";
import { comparisonPresentation, changePresentation } from "../../portal/tokens/conditions-format.js";
import { conditionDemoEvidence } from "../cli/telemetry-conditions-demo.mjs";
import { analyzeTelemetry } from "../cli/telemetry-analyze.mjs";

const thin = { event_kind: "spike", comparison_available: true, percent_available: false, relative_delta: null,
  with_affected: 1, with_condition: 12, without_affected: 0, without_condition: 10 };
assert.equal(comparisonPresentation(thin).state, "thin");
assert.match(comparisonPresentation(thin).label, /1\/12 with/);
assert.doesNotMatch(comparisonPresentation(thin).label, /No.*difference/);
assert.equal(comparisonPresentation({ ...thin, comparison_available: false }).state, "unavailable");
assert.equal(comparisonPresentation({ ...thin, percent_available: true, relative_delta: 0.1 }).state, "neutral");
assert.equal(comparisonPresentation({ ...thin, percent_available: true, relative_delta: -0.5 }).state, "fewer");
const equal = { event_kind: "spike", state: "comparison available", relative_delta: 0, before: { affected: 3, observations: 12, rate: .25 }, after: { affected: 3, observations: 12, rate: .25 } };
assert.equal(changePresentation(equal).state, "neutral");
assert.match(changePresentation(equal).label, /No clear change/);
assert.equal(changePresentation({ ...equal, relative_delta: 0.1 }).state, "neutral"); // inside the display band
assert.equal(changePresentation({ ...equal, relative_delta: -0.5 }).state, "fewer");
assert.equal(changePresentation({ ...equal, relative_delta: 0.5 }).state, "more");
// Thin evidence: equal rates are not "no change", and no percentages are shown.
const thinChange = changePresentation({ ...equal, relative_delta: null });
assert.equal(thinChange.state, "collecting");
assert.doesNotMatch(thinChange.label, /No .*change/);
assert.doesNotMatch(thinChange.detail, /%/);
assert.equal(changePresentation({ ...equal, relative_delta: null, after: { affected: 0, observations: 12, rate: 0 } }).state, "collecting");
assert.match(changePresentation({ ...equal, relative_delta: null, after: { affected: 0, observations: 12, rate: 0 } }).label, /Early signal: fewer/);
const records = fs.readFileSync(new URL("../../portal/tokens/mock-spool.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const evidence = conditionDemoEvidence(records);
const report = analyzeTelemetry(evidence.events, { snapshots: evidence.snapshots });
// The demo must not confound the intervention with repo or model: both cohorts share them.
const cohortValues = (baseline, pick) => [...new Set(evidence.events.filter((row) => {
  const index = Number(row.session_id.match(/^demo-comparison-(\d+)$/)?.[1] ?? NaN);
  return index < 96 && (index < 48) === baseline;
}).map(pick).filter(Boolean))].sort();
for (const pick of [(row) => row.repo?.label, (row) => row.session?.model]) assert.deepEqual(cohortValues(true, pick), cohortValues(false, pick));
assert.ok(cohortValues(true, (row) => row.repo?.label).length > 1);
const states = new Set(report.conditions.comparisons.map((row) => comparisonPresentation(row).state));
assert.ok(states.has("fewer") && states.has("more") && states.has("thin"));
assert.deepEqual(conditionDemoEvidence(records), evidence);
const midpoint = report.insights.find((finding) => finding.kind === "midpoint_regression");
assert.match(midpoint.headline, /heavier: .* → .* tok\/call/);
assert.doesNotMatch(midpoint.headline, /down from|up from/);
console.log("conditions presentation: low samples, equal rates, missing baseline and deterministic active demo passed");
