// Deterministic synthetic evidence shared by the seeded spool and bundled portal demo.
import { buildEffectiveSnapshot } from "./telemetry-schemas/snapshot-schema.mjs";
import { privacyHash } from "./telemetry-schemas/hash.mjs";

export function conditionDemoEvidence(records) {
  records = [...records, ...comparisonSessions()];
  const snapshots = [];
  const byHarness = new Map();
  for (const harness of [...new Set(records.map((row) => row.harness))]) {
    const pair = [false, true].map((enabled) => {
      const snapshot = buildEffectiveSnapshot({ packages: [{ id: "demo-context-rules", enabled, resources: ["rules"] }], tools: [{ id: "demo-lookup", installed: enabled }] }, { harness });
      snapshot.created_at = "2026-06-01T00:00:00.000Z";
      snapshots.push(snapshot);
      return snapshot;
    });
    byHarness.set(harness, pair);
  }
  const sessionKeys = [...new Set(records.map((row) => `${row.harness}:${row.session_id}`))].sort();
  const sessionIndexes = new Map(sessionKeys.map((key, index) => [key, index]));
  const events = records.map((row, index) => {
    const sessionIndex = sessionIndexes.get(`${row.harness}:${row.session_id}`);
    const scenario = row.demo_condition;
    const missingSnapshot = scenario ? scenario === "unknown" : sessionIndex % 5 === 0;
    const snapshot = byHarness.get(row.harness)[scenario ? Number(scenario === "focused") : sessionIndex % 2];
    const { demo_condition, ...capture } = row;
    return { ...capture, schema: 3, capture_id: `cap_${privacyHash(String(index)).slice(0, 16)}`,
      call_id: `demo-call-${index}`, config_snapshot_id: missingSnapshot ? null : snapshot.snapshot_id,
      repo: { ...row.repo, repository_id: `git:github.com/demo/${row.repo?.label ?? "repo"}` },
      // One model has no valid usage; others mix complete and incomplete sessions.
      tokens: sessionIndex % 7 === 0 ? null : row.tokens,
      session: { ...row.session, model: sessionIndex % 11 === 0 ? null : row.session?.model },
    };
  });
  return { events, snapshots };
}


function comparisonSessions() {
  const events = [];
  // 48 sessions on each side, balanced across harnesses. Only synthetic source
  // evidence changes: the production analyzer computes all displayed outcomes.
  for (let index = 0; index < 100; index++) {
    const after = index >= 48;
    const position = index % 48;
    const unknown = index >= 96;
    const affected = !unknown && position < (after ? 8 : 24);
    const scenario = unknown ? "unknown" : after ? "focused" : "baseline";
    const repo = after ? "marketing-site" : "payments-api";
    const timestamp = Date.UTC(2026, 5, after ? 14 : 10, 0, index * 2);
    for (let call = 0; call < 2; call++) events.push({
      schema: 3, demo_condition: scenario, harness: index % 2 ? "codex" : "claude",
      session_id: `demo-comparison-${index}`, event: "PostToolUse",
      ts: new Date(timestamp + call * 1000).toISOString(),
      repo: { label: repo, branch: "main" },
      session: { model: unknown ? null : after ? "gpt-5-codex" : "claude-opus-4-8" },
      tool: { name: call ? "Edit" : "Read", file_ext: call ? ".js" : ".md" },
      last_result: { tool: call ? "Edit" : "Read", chars: !call && affected ? 28000 : 600 },
      tokens: unknown ? null : { input: (after ? 15000 : 44000) + call * 1000, output: 4000, total: (after ? 19000 : 48000) + call * 1000 },
      delta_tokens: call ? 1000 : after ? 19000 : 48000,
    });
  }
  return events;
}
