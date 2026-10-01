import { repositoryRefForEvent } from "./telemetry-repository.mjs";

export function buildTelemetryRepositoryProjection(events, report, repositoryHashIndex) {
  const repositoryBySession = new Map();
  let updatedAt = null;
  for (const event of events) {
    if (!updatedAt || event.ts > updatedAt) updatedAt = event.ts;
    const repositoryId = repositoryRefForEvent(event, repositoryHashIndex).repositoryId;
    if (repositoryId) repositoryBySession.set(sessionKey(event), repositoryId);
  }

  const repositories = {};
  const ensure = (repositoryId) => repositories[repositoryId] || (repositories[repositoryId] = {
    sessionCount: 0,
    warningCount: 0,
    highestSeverity: null,
    recent: [],
  });
  for (const session of report.sessions || []) {
    const repositoryId = repositoryBySession.get(sessionKey(session));
    if (repositoryId) ensure(repositoryId).sessionCount += 1;
  }
  for (const [kind, severity, rows] of [
    ["spike", "high", report.spikes || []],
    ["loop", "high", report.loops || []],
    ["read-warning", "warn", report.read_warnings || []],
  ]) {
    for (const row of rows) addWarning(repositoryBySession, ensure, kind, severity, row);
  }
  for (const summary of Object.values(repositories)) {
    summary.recent.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    summary.recent = summary.recent.slice(0, 5);
  }
  return { status: "available", updatedAt, repositories };
}

function addWarning(repositoryBySession, ensure, kind, severity, row) {
  const repositoryId = repositoryBySession.get(sessionKey(row));
  if (!repositoryId) return;
  const summary = ensure(repositoryId);
  summary.warningCount += 1;
  if (summary.highestSeverity !== "high") summary.highestSeverity = severity;
  summary.recent.push({ kind, severity, sessionId: row.session_id, harness: row.harness || null, at: row.ts || null });
}

function sessionKey(record) {
  return `${record.harness || "unknown"}:${record.session_id || "unknown"}`;
}
