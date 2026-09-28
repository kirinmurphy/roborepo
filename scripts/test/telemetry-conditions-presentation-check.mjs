import assert from "node:assert/strict";
import fs from "node:fs";
import { comparisonPresentation, changePresentation } from "../../portal/tokens2/conditions-format.js";
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
const equal = { event_kind: "spike", state: "comparison available", before: { affected: 3, observations: 12, rate: .25 }, after: { affected: 3, observations: 12, rate: .25 } };
assert.equal(changePresentation(equal).state, "neutral");
assert.match(changePresentation(equal).label, /No observed change/);
assert.equal(changePresentation({ ...equal, after: { affected: 0, observations: 12, rate: 0 } }).state, "collecting");
const records = fs.readFileSync(new URL("../../portal/tokens2/mock-spool.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const evidence = conditionDemoEvidence(records);
const report = analyzeTelemetry(evidence.events, { conditions: true, snapshots: evidence.snapshots });
const states = new Set(report.conditions.comparisons.map((row) => comparisonPresentation(row).state));
assert.ok(states.has("fewer") && states.has("more") && states.has("thin"));
assert.ok(report.conditions.relative_models.filter((row) => row.meets_sample_floor).length >= 3);
assert.deepEqual(conditionDemoEvidence(records), evidence);
const midpoint = report.insights.find((finding) => finding.kind === "midpoint_regression");
assert.match(midpoint.headline, /30%.*down from 89%/);
console.log("conditions presentation: low samples, equal rates, missing baseline and deterministic active demo passed");
