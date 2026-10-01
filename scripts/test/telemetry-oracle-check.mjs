import fs from "node:fs";
import { analyzeTelemetry } from "../cli/telemetry-analyze.mjs";
import { conditionDemoEvidence } from "../cli/telemetry-conditions-demo.mjs";
import { runTelemetryOracle } from "../cli/telemetry-oracle-run.mjs";
import { acceptedRows, stableJson } from "../cli/telemetry-oracle-observations.mjs";
import { comparisonEntries } from "../cli/telemetry-oracle-compare.mjs";

// The comparator knows both implementations; independent calculation stays in the oracle core.
// Display-band states belong to that core's policy checks, not the production UI formatters.
function equal(label, actual, expected) {
  if (stableJson(actual) !== stableJson(expected)) throw new Error(`${label} disagreed\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
}

function verify(events, options = {}) {
  const expected = runTelemetryOracle(events, options), report = analyzeTelemetry(events, options);
  for (const { field, actual, expected: value } of comparisonEntries(report, expected)) equal(field, actual, value);
  return expected;
}

function marker(id, boundary) {
  return { schema: 2, marker_id: id, type: "change", ts: boundary, effective_at: boundary,
    scope: "all", repository_id: null, watching_kinds: ["spike", "loop", "read-warning"] };
}

function regressionTieCase({ allSameTime = false } = {}) {
  const at = "2026-09-15T12:00:00.000Z", later = allSameTime ? at : "2026-09-16T04:00:00.000Z";
  const row = (id, harness, sessionId, tool, ts, chars) => ({
    schema: 3, capture_id: `cap-${id}`, call_id: `call-${id}`, harness, session_id: sessionId,
    event: "PostToolUse", ts, repo: { label: "repo", repository_id: "git:example/repo" },
    session: { model: "model" }, tool: { name: tool }, last_result: { tool, chars },
    tokens: { input: 1_000, output: 100, total: 1_100 }, delta_tokens: 1_000,
  });
  return { events: [
    row("25-0", "codex", "shared-12", "Edit", at, 25_000),
    row("26-1", "claude", "shared-13", "Edit", at, 2_498),
    row("26-2", "claude", "shared-13", "mcp__jcodemunch__search", at, 2_632),
    row("27-0", "codex", "shared-13", "Bash", later, 4_395),
  ], snapshots: [], markers: [] };
}

function random(seed) {
  let state = seed >>> 0;
  return () => ((state ^= state << 13, state ^= state >>> 17, state ^= state << 5, state >>>= 0) / 0x1_0000_0000);
}

function seededCase(seed) {
  const next = random(seed), boundary = "2026-09-15T12:00:00.000Z";
  const snapshots = [
    { schema: 2, snapshot_id: "cfg-on", packages: ["pkg-a"], skills: ["skill-a"], evaluability: { packages: true, skills: true } },
    { schema: 2, snapshot_id: "cfg-off", packages: [], skills: [], evaluability: { packages: true, skills: true } },
  ];
  const events = [];
  for (let index = 0; index < 28; index++) {
    const harness = index % 2 ? "codex" : "claude", sessionId = `shared-${Math.floor(index / 2)}`;
    const snapshot = index === 1 || index === 2 ? null : index % 2 ? "cfg-on" : "cfg-off";
    const model = index % 7 === 0 ? null : index % 3 ? "model-a" : "model-b";
    const repositoryId = index % 9 === 0 ? null : index % 2 ? "git:example/repo-a" : "git:example/repo-b";
    const calls = index === 2 ? 8 : 2 + Math.floor(next() * 3);
    for (let call = 0; call < calls; call++) {
      let time;
      if (index === 24) time = Date.parse(boundary) + (call ? 3_600_000 : -3_600_000);
      else if (index === 25) time = Date.parse(boundary) + call * 60_000;
      else if (index === 26) time = Date.parse(boundary);
      else if (index < 12) time = Date.parse(boundary) - (index + 1) * 3_600_000 + call * 1_000;
      else time = Date.parse(boundary) + (index - 11) * 3_600_000 + call * 1_000;
      const isDoc = index % 5 === 0 && call < 2;
      const toolName = index === 2 ? "Read" : ["Read", "Edit", "Bash", "mcp__jcodemunch__search"][Math.floor(next() * 4)];
      const tokenless = index % 8 === 0 || (index === 27 && call === calls - 1);
      const spike = [3, 5, 17, 19, 23, 27].includes(index) && call === calls - 1;
      const base = {
        schema: 3, capture_id: `cap-${index}-${call}`, call_id: `call-${index}-${call}`, harness, session_id: sessionId,
        event: "PostToolUse", ts: new Date(time).toISOString(), config_snapshot_id: snapshot,
        repo: { label: repositoryId?.split("/").at(-1) ?? "unknown", repository_id: repositoryId }, session: { model },
        tool: { name: toolName, mcp_tool: toolName.startsWith("mcp__") ? toolName : null,
          file_ext: isDoc ? ".md" : toolName === "Read" ? ".mjs" : null, file_path_hash: isDoc ? `doc-${index}` : null,
          command_chars: toolName === "Bash" ? 10 : 0 },
        last_result: { tool: toolName, chars: isDoc ? 25_000 : 400 + Math.floor(next() * 4_000) },
        tokens: tokenless ? null : { input: 1_000 + call * 100, output: 100, total: 1_100 + call * 100 },
        delta_tokens: spike ? 300_000 : 500 + Math.floor(next() * 4_000),
      };
      if (call === 0 && index % 5 === 0 && index !== 25) events.push({ ...base, capture_id: `mirror-pre-${index}`, event: "PreToolUse", ts: new Date(time - 500).toISOString() });
      events.push(base);
    }
  }
  return { events, snapshots, markers: [marker(`seed-${seed}`, boundary)] };
}

function stillFails(testCase) {
  try { verify(testCase.events, testCase); return false; } catch { return true; }
}

function shrink(testCase) {
  const reduced = { ...testCase, events: [...testCase.events] };
  let changed = true;
  while (changed && reduced.events.length > 1) {
    changed = false;
    for (let index = 0; index < reduced.events.length; index++) {
      const candidate = { ...reduced, events: reduced.events.filter((_, item) => item !== index) };
      if (stillFails(candidate)) { reduced.events = candidate.events; changed = true; break; }
    }
  }
  return reduced;
}

function runCase(name, testCase) {
  try {
    const result = verify(testCase.events, testCase);
    return { name, events: testCase.events.length, condition_rows: result.conditions.length,
      marker_comparisons: result.changes.reduce((count, change) => count + change.comparisons.length, 0),
      regression_groups: result.regression.groups.length };
  }
  catch (error) {
    const minimal = shrink(testCase);
    console.error(`telemetry oracle failure: ${name}`);
    console.error(`seed: ${testCase.seed ?? "fixed"}`);
    console.error(`snapshots: ${JSON.stringify(minimal.snapshots)}`);
    console.error(`markers: ${JSON.stringify(minimal.markers)}`);
    console.error("events (JSONL):");
    for (const event of minimal.events) console.error(JSON.stringify(event));
    throw error;
  }
}

function requireCoverage(ok, message) {
  if (!ok) throw new Error(`oracle fixture lost required coverage: ${message}`);
}

const records = fs.readFileSync(new URL("../../portal/tokens/mock-spool.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const demo = conditionDemoEvidence(records);
const demoCase = { ...demo, markers: [marker("demo-boundary", "2026-06-12T00:00:00.000Z")] };
const demoStates = new Set(runTelemetryOracle(demoCase.events, demoCase).conditions.map((row) => row.presentation_state));
requireCoverage(["thin", "fewer", "more"].every((state) => demoStates.has(state)), "demo thin/fewer/more condition outcomes");
const summaries = [runCase("bundled demo", demoCase)];

const tiedRegression = regressionTieCase();
summaries.push(runCase("regression pin: equal timestamps stay together", tiedRegression));
const tiedResult = runTelemetryOracle(tiedRegression.events, tiedRegression).regression;
requireCoverage(tiedResult.split_ts === "2026-09-16T04:00:00.000Z"
  && tiedResult.groups.reduce((count, row) => count + row.before_calls, 0) === 3,
"equal-timestamp midpoint uses the nearest distinct boundary");
const noTemporalOrder = regressionTieCase({ allSameTime: true });
summaries.push(runCase("regression pin: all timestamps equal is unavailable", noTemporalOrder));
requireCoverage(runTelemetryOracle(noTemporalOrder.events, noTemporalOrder).regression.split_ts == null,
  "all-equal timestamps make regression unavailable");

const seeds = [0x00c0ffee, 0x12345678, 0x5eed5eed, 0x9e3779b9, 0xdecafbad, 0xf00dcafe];
for (const seed of seeds) {
  const testCase = { ...seededCase(seed), seed }, expected = runTelemetryOracle(testCase.events, testCase);
  const harnessesById = new Map();
  for (const event of testCase.events) {
    if (!harnessesById.has(event.session_id)) harnessesById.set(event.session_id, new Set());
    harnessesById.get(event.session_id).add(event.harness);
  }
  requireCoverage([...harnessesById.values()].some((harnesses) => harnesses.size > 1), `seed ${seed} shared ids across harnesses`);
  requireCoverage(testCase.events.some((event) => event.tokens == null) && testCase.events.some((event) => event.session?.model == null), `seed ${seed} null tokens/models`);
  requireCoverage(expected.operation_count < acceptedRows(testCase.events).length, `seed ${seed} mirrored operation deduplication`);
  requireCoverage(expected.session_count > expected.token_session_count, `seed ${seed} tokenless session subset`);
  requireCoverage(expected.affected_session_counts.loop === 1, `seed ${seed} one within-harness loop without cross-harness fabrication`);
  requireCoverage(expected.conditions.some((row) => row.unknown_condition > 0), `seed ${seed} unknown condition cohort`);
  requireCoverage(expected.conditions.some((row) => row.presentation_state === "neutral") && expected.conditions.some((row) => row.presentation_state === "thin"), `seed ${seed} 20% band and evidence-floor gating`);
  requireCoverage(expected.changes.some((change) => change.comparisons.some((row) => row.spanning_boundary > 0 && row.ambiguous_boundary > 0)), `seed ${seed} spanning and touching boundary exclusions`);
  requireCoverage(expected.regression.groups.length > 0, `seed ${seed} per-call regression`);
  summaries.push(runCase(`seed ${seed}`, testCase));
}

const total = (field) => summaries.reduce((sum, row) => sum + row[field], 0);
console.log("telemetry oracle: PASS");
console.log(`  cases: ${summaries.length} (1 bundled demo, 2 fixed regressions, ${seeds.length} seeded spools)`);
console.log(`  evidence: ${total("events")} raw events · ${total("condition_rows")} condition rows · ${total("marker_comparisons")} marker comparisons · ${total("regression_groups")} regression groups`);
console.log(`  seeds: ${seeds.join(", ")}`);
console.log("  exact checks: harness-scoped sessions, token coverage, operation deduplication, condition cohorts, boundary exclusions, evidence gating, per-call regression, loop isolation");
console.log("  failure evidence: seed, production/oracle disagreement, snapshots, markers, and minimized replayable JSONL");
