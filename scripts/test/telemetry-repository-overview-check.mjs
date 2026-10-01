#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildTelemetryRepositoryProjection } from "../cli/telemetry-repository-overview.mjs";

const REPOSITORY = "git:github.com/example/app";
const events = [
  event("s1", "2026-09-30T10:00:00.000Z", REPOSITORY),
  event("s2", "2026-09-30T11:00:00.000Z", REPOSITORY),
  event("unresolved", "2026-09-30T12:00:00.000Z", null),
];
const report = {
  sessions: [{ session_id: "s1", harness: "codex" }, { session_id: "s2", harness: "codex" }, { session_id: "unresolved", harness: "codex" }],
  spikes: [{ session_id: "s1", harness: "codex", ts: "2026-09-30T10:30:00.000Z" }],
  loops: [],
  read_warnings: [{ session_id: "s2", harness: "codex", ts: "2026-09-30T11:30:00.000Z" }],
};

const projection = buildTelemetryRepositoryProjection(events, report, null);
assert.equal(projection.updatedAt, "2026-09-30T12:00:00.000Z");
assert.equal(projection.repositories[REPOSITORY].sessionCount, 2);
assert.equal(projection.repositories[REPOSITORY].warningCount, 2);
assert.equal(projection.repositories[REPOSITORY].highestSeverity, "high");
assert.deepEqual(projection.repositories[REPOSITORY].recent.map((finding) => finding.kind), ["read-warning", "spike"]);
assert.equal(Object.keys(projection.repositories).length, 1, "unresolved sessions stay out of repository summaries");

console.log("telemetry repository overview checks passed");

function event(sessionId, ts, repositoryId) {
  return {
    session_id: sessionId,
    harness: "codex",
    ts,
    repo: repositoryId ? { repository_id: repositoryId } : null,
  };
}
