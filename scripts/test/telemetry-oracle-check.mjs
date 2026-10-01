import fs from "node:fs";
import { createHash } from "node:crypto";
import { analyzeTelemetry } from "../cli/telemetry-analyze.mjs";
import { conditionDemoEvidence } from "../cli/telemetry-conditions-demo.mjs";
import { comparisonPresentation, changePresentation } from "../../portal/tokens2/conditions-format.js";

// This file deliberately does not import telemetry observations, conditions, boundaries, metrics,
// or finding helpers. The implementation below starts again from persisted event fields so a bug
// shared by production normalization and its focused fixtures cannot make both sides agree.
const POLICY = Object.freeze({ minimum_cohort: 10, minimum_events: 3, display_band: 0.2 });
const LOOP_REPEAT_THRESHOLD = 8;
const LARGE_DOCUMENT_READ_CHARS = 20_000;
const REPEATED_DOCUMENT_READ_COUNT = 2;
const MIXED_CODE_LOOKUP_NATIVE_READS = 4;
const DOC_EXTS = new Set([".md", ".mdx", ".rst", ".txt"]);
const SOURCE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".sh", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".php", ".cs", ".cpp", ".c", ".h", ".hpp", ".toml", ".yaml", ".yml"]);

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const digest = (value) => createHash("sha256").update(stableJson(value)).digest("hex");
const known = (value) => typeof value === "string" && value && value !== "unknown" ? value : null;
const sessionKey = (row) => JSON.stringify([row.harness ?? null, row.session_id || "unknown"]);
const observationId = (row) => JSON.stringify(["session", row.harness, row.session_id]);
const validTime = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const consensus = (rows, pick) => {
  const values = rows.map(pick);
  return values.length && values.every((value) => value != null && value === values[0]) ? values[0] : null;
};
const hasTokens = (row) => row?.tokens && typeof row.tokens.total === "number";
const mcpServer = (name) => typeof name === "string" && name.startsWith("mcp__") ? name.split("__")[1] || null : null;

function acceptedRows(events) {
  const unique = new Map();
  for (const row of events) {
    if (!row || ![null, 2, 3].includes(row.schema ?? null) || !(row.session_id || row.capture_id || row.tokens || row.tool)) continue;
    unique.set(stableJson(row), row);
  }
  return [...unique.values()].sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
}

function flowIdentity(row) {
  const harness = known(row.harness), session = known(row.session_id), call = known(row.call_id);
  if (row.schema === 3 && harness && session && call && !call.startsWith("derived_")) return JSON.stringify(["flow", harness, session, call]);
  const fallback = known(row.capture_id) || digest(row);
  return JSON.stringify(["capture", harness, session, fallback]);
}

function canonicalOperations(rows) {
  const flows = new Map();
  for (const row of rows) {
    const id = flowIdentity(row);
    if (!flows.has(id)) flows.set(id, []);
    flows.get(id).push(row);
  }
  const compare = (a, b) => Number(b.event === "PostToolUse") - Number(a.event === "PostToolUse")
    || String(b.ts).localeCompare(String(a.ts))
    || String(a.spool_provenance?.source ?? "").localeCompare(String(b.spool_provenance?.source ?? ""))
    || (b.spool_provenance?.sequence ?? 0) - (a.spool_provenance?.sequence ?? 0)
    || stableJson(a).localeCompare(stableJson(b));
  return { count: flows.size, rows: [...flows.values()].map((group) => [...group].sort(compare)[0]) };
}

function normalizedUsage(tokens) {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return null;
  const values = [tokens.input, tokens.output, tokens.cache_creation ?? 0, tokens.cache_read ?? 0, tokens.total];
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  return { input: values[0] + values[2] + values[3], output: values[1], total: values[4] };
}

function buildSessions(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!known(row.harness) || !known(row.session_id)) continue;
    const key = sessionKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((group) => {
    const times = [...new Set(group.map((row) => validTime(row.ts)).filter(Boolean))].sort();
    const latest = times.at(-1) ?? null;
    const lastRows = group.filter((row) => validTime(row.ts) === latest);
    const usages = lastRows.map((row) => normalizedUsage(row.tokens));
    const tokens = group.every((row) => row.schema === 2 || row.schema === 3) && usages.length
      && usages.every((usage) => usage && stableJson(usage) === stableJson(usages[0])) ? usages[0] : null;
    return {
      id: observationId(group[0]), harness: consensus(group, (row) => known(row.harness)),
      session_id: consensus(group, (row) => known(row.session_id)),
      repository_id: consensus(group, (row) => known(row.repo?.repository_id)),
      model: consensus(group, (row) => known(row.session?.model)),
      first_seen: times[0] ?? null, last_seen: latest, tokens, rows: group,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function spikeSessions(operations) {
  const captures = operations.filter(hasTokens);
  const deltas = captures.map((row) => row.delta_tokens || 0).filter((value) => value > 0);
  let threshold = 50_000;
  if (deltas.length >= 2) {
    const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length;
    threshold = Math.max(threshold, Math.round(mean + 2 * Math.sqrt(variance)));
  }
  return new Set(captures.filter((row) => threshold > 0 && (row.delta_tokens || 0) >= threshold).map(sessionKey));
}

function loopSessions(operations) {
  const groups = new Map();
  for (const row of operations.filter(hasTokens)) {
    if (row.event !== "PostToolUse" || !row.tool?.name) continue;
    const key = sessionKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const affected = new Set();
  for (const [key, rows] of groups) {
    let previous = null, run = 0, best = 0;
    for (const row of rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) {
      const tool = row.tool.mcp_tool || row.tool.name;
      run = tool === previous ? run + 1 : 1;
      previous = tool;
      best = Math.max(best, run);
    }
    if (best >= LOOP_REPEAT_THRESHOLD) affected.add(key);
  }
  return affected;
}

function isNativeSourceRead(row) {
  const name = row.tool?.name || row.last_result?.tool;
  if (!["Read", "Grep", "Glob", "Bash"].includes(name)) return false;
  if (SOURCE_EXTS.has(row.tool?.file_ext)) return true;
  return name === "Bash" && (row.tool?.command_chars || 0) > 0 && (row.last_result?.chars || 0) > 0;
}

function readWarningSessions(operations) {
  const affected = new Set(), byDocument = new Map(), bySession = new Map();
  for (const row of operations) {
    const key = sessionKey(row);
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(row);
    const fileHash = row.tool?.file_path_hash, extension = row.tool?.file_ext;
    if (row.event === "PostToolUse" && row.last_result?.chars >= LARGE_DOCUMENT_READ_CHARS && DOC_EXTS.has(extension)) affected.add(key);
    if (row.event === "PostToolUse" && fileHash && DOC_EXTS.has(extension)) {
      const documentKey = `${key}:${fileHash}`;
      const current = byDocument.get(documentKey) ?? { key, count: 0, chars: 0 };
      current.count += 1;
      current.chars += row.last_result?.chars || 0;
      byDocument.set(documentKey, current);
    }
  }
  const repeated = new Set();
  for (const row of byDocument.values()) if (row.count >= REPEATED_DOCUMENT_READ_COUNT && row.chars >= LARGE_DOCUMENT_READ_CHARS) {
    affected.add(row.key); repeated.add(row.key);
  }
  for (const [key, rows] of bySession) {
    const jdoc = rows.filter((row) => mcpServer(row.last_result?.tool || row.tool?.name) === "jdocmunch").length;
    if (repeated.has(key) && jdoc === 0) affected.add(key);
    const jcode = rows.filter((row) => mcpServer(row.last_result?.tool || row.tool?.name) === "jcodemunch").length;
    if (jcode > 0 && rows.filter(isNativeSourceRead).length >= MIXED_CODE_LOOKUP_NATIVE_READS) affected.add(key);
  }
  return affected;
}

function evaluateCondition(session, condition, snapshotIndex) {
  const field = { model: "model", repo: "repository_id", harness: "harness" }[condition.dimension];
  if (field) return session[field] == null ? "unknown" : session[field] === condition.value ? "present" : "absent";
  const states = session.rows.map((row) => {
    const snapshot = snapshotIndex.get(row.config_snapshot_id);
    if (!snapshot || ![1, 2].includes(snapshot.schema) || !["packages", "skills"].includes(condition.dimension)
      || (snapshot.schema === 2 && snapshot.evaluability?.[condition.dimension] !== true)
      || snapshot.unavailable?.includes(condition.dimension) || !Array.isArray(snapshot[condition.dimension])) return null;
    return snapshot[condition.dimension].includes(condition.value);
  });
  return states.length && states.every((state) => state != null && state === states[0]) ? states[0] ? "present" : "absent" : "unknown";
}

function conditionRows(sessions, snapshots, affectedByKind) {
  const conditions = [];
  for (const [dimension, field] of [["model", "model"], ["repo", "repository_id"], ["harness", "harness"]]) {
    for (const value of [...new Set(sessions.map((session) => session[field]).filter(Boolean))].sort()) conditions.push({ dimension, value });
  }
  for (const dimension of ["packages", "skills"]) {
    for (const value of [...new Set(snapshots.flatMap((snapshot) => snapshot[dimension] ?? []))].sort()) conditions.push({ dimension, value });
  }
  const snapshotIndex = new Map(snapshots.map((snapshot) => [snapshot.snapshot_id, snapshot]));
  const rows = [];
  for (const [eventKind, affectedKeys] of affectedByKind) for (const condition of conditions) {
    const cohorts = { present: [], absent: [], unknown: [] };
    for (const session of sessions) cohorts[evaluateCondition(session, condition, snapshotIndex)].push(session);
    const present = cohorts.present.length, absent = cohorts.absent.length, unknown = cohorts.unknown.length;
    const withAffected = cohorts.present.filter((session) => affectedKeys.has(sessionKey(session))).length;
    const withoutAffected = cohorts.absent.filter((session) => affectedKeys.has(sessionKey(session))).length;
    const withRate = present ? withAffected / present : null, withoutRate = absent ? withoutAffected / absent : null;
    const comparisonAvailable = present > 0 && absent > 0;
    const percentAvailable = comparisonAvailable && withoutRate > 0 && Math.min(present, absent) >= POLICY.minimum_cohort
      && Math.min(withAffected, withoutAffected) >= POLICY.minimum_events;
    const relativeDelta = percentAvailable ? (withRate - withoutRate) / withoutRate : null;
    rows.push({ ...condition, event_kind: eventKind, with_condition: present, without_condition: absent,
      unknown_condition: unknown, known_condition: present + absent, total_observations: sessions.length,
      coverage: sessions.length ? (present + absent) / sessions.length : 0,
      with_affected: withAffected, without_affected: withoutAffected, with_rate: withRate, without_rate: withoutRate,
      relative_delta: relativeDelta, comparison_available: comparisonAvailable, percent_available: percentAvailable,
      presentation_state: !comparisonAvailable ? "unavailable" : !percentAvailable ? "thin"
        : Math.abs(relativeDelta) < POLICY.display_band ? "neutral" : relativeDelta < 0 ? "fewer" : "more" });
  }
  return rows.sort(rowSort);
}

function splitBoundary(sessions, marker) {
  const result = { before: [], after: [], spanning: [], ambiguous: [] };
  const boundary = Date.parse(marker.effective_at ?? marker.ts);
  for (const session of sessions) {
    const first = Date.parse(session.first_seen), last = Date.parse(session.last_seen);
    if (![boundary, first, last].every(Number.isFinite)) result.ambiguous.push(session);
    else if (first < boundary && last > boundary) result.spanning.push(session);
    else if (last < boundary) result.before.push(session);
    else if (first > boundary) result.after.push(session);
    else {
      const comparable = marker.sequence_domain && Number.isSafeInteger(marker.sequence) && session.rows.length
        && session.rows.every((row) => row.sequence_domain === marker.sequence_domain && Number.isSafeInteger(row.sequence));
      if (comparable && session.rows.every((row) => row.sequence < marker.sequence)) result.before.push(session);
      else if (comparable && session.rows.every((row) => row.sequence > marker.sequence)) result.after.push(session);
      else result.ambiguous.push(session);
    }
  }
  return result;
}

function changeRows(sessions, snapshots, markers, affectedByKind) {
  const superseded = new Set(markers.map((marker) => marker.supersedes).filter(Boolean));
  return markers.filter((marker) => marker.type === "change" && !superseded.has(marker.marker_id)).map((marker) => {
    const scopeKnown = marker.schema >= 2 && (marker.repository_id || marker.scope === "all");
    const scoped = scopeKnown ? sessions.filter((session) => !marker.repository_id || session.repository_id === marker.repository_id) : [];
    return { marker_id: marker.marker_id, comparisons: (marker.watching_kinds ?? []).map((eventKind) => {
      const split = splitBoundary(scoped, marker), affected = affectedByKind.get(eventKind) ?? new Set();
      const cohort = (items) => ({ observations: items.length, affected: items.filter((session) => affected.has(sessionKey(session))).length,
        rate: items.length ? items.filter((session) => affected.has(sessionKey(session))).length / items.length : null });
      const before = cohort(split.before), after = cohort(split.after);
      const enough = Math.min(before.observations, after.observations) >= POLICY.minimum_cohort;
      const state = !scopeKnown ? "can't compare fairly" : !scoped.length ? "recorded"
        : (!before.observations || !after.observations) && (split.ambiguous.length || split.spanning.length) ? "can't compare fairly"
          : enough ? "comparison available" : "collecting";
      const relativeDelta = enough && before.rate > 0 && Math.min(before.affected, after.affected) >= POLICY.minimum_events
        ? (after.rate - before.rate) / before.rate : null;
      const presentationState = state !== "comparison available" ? "collecting" : relativeDelta == null ? "collecting"
        : Math.abs(relativeDelta) < POLICY.display_band ? "neutral" : relativeDelta < 0 ? "fewer" : "more";
      return { event_kind: eventKind, before, after, ambiguous_boundary: split.ambiguous.length,
        spanning_boundary: split.spanning.length, unknown_condition: 0, state, relative_delta: relativeDelta, presentation_state: presentationState };
    }).sort((a, b) => a.event_kind.localeCompare(b.event_kind)) };
  }).sort((a, b) => a.marker_id.localeCompare(b.marker_id));
}

function toolGroup(name) {
  const server = mcpServer(name);
  if (server === "jcodemunch" || server === "jdocmunch") return server;
  if (server) return "mcp-other";
  if (["Read", "Grep", "Glob"].includes(name)) return "native-read";
  if (["Edit", "Write", "NotebookEdit"].includes(name)) return "edit";
  if (name === "Bash") return "bash";
  return "other";
}

function regression(operations) {
  const rows = operations.filter(hasTokens).filter((row) => row.last_result && typeof row.last_result.chars === "number" && row.last_result.tool)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  if (rows.length < 4) return { split_ts: null, groups: [] };
  const target = rows.length / 2;
  const boundaries = rows.flatMap((row, index) => index > 0 && rows[index - 1].ts !== row.ts ? [index] : []);
  if (!boundaries.length) return { split_ts: null, groups: [] };
  const middle = boundaries.reduce((best, index) => Math.abs(index - target) < Math.abs(best - target) ? index : best);
  const beforeRows = rows.slice(0, middle), afterRows = rows.slice(middle);
  const aggregate = (items) => {
    const result = new Map();
    for (const row of items) {
      const group = toolGroup(row.last_result.tool), current = result.get(group) ?? { calls: 0, chars: 0 };
      current.calls++; current.chars += row.last_result.chars; result.set(group, current);
    }
    return result;
  };
  const before = aggregate(beforeRows), after = aggregate(afterRows);
  const latest = rows.at(-1).ts, cutoff = new Date(Date.parse(latest) - 7 * 86_400_000).toISOString();
  const weekRows = rows.filter((row) => row.ts >= cutoff), week = aggregate(weekRows);
  const total = (items) => items.reduce((sum, row) => sum + (row.last_result.chars || 0), 0);
  const beforeTotal = total(beforeRows), afterTotal = total(afterRows), weekTotal = total(weekRows);
  const groups = [...new Set([...before.keys(), ...after.keys()])].map((group) => {
    const b = before.get(group), a = after.get(group), w = week.get(group);
    const beforeAverage = b ? Math.round((b.chars / b.calls) / 4) : 0;
    const afterAverage = a ? Math.round((a.chars / a.calls) / 4) : 0;
    return { group, before_avg_tokens: beforeAverage, after_avg_tokens: afterAverage,
      delta_tokens: afterAverage - beforeAverage, before_calls: b?.calls ?? 0, after_calls: a?.calls ?? 0,
      before_share: beforeTotal > 0 ? (b?.chars ?? 0) / beforeTotal : 0,
      after_share: afterTotal > 0 ? (a?.chars ?? 0) / afterTotal : 0,
      week_share: weekTotal > 0 ? (w?.chars ?? 0) / weekTotal : 0 };
  }).sort((a, b) => a.group.localeCompare(b.group));
  return { split_ts: rows[middle].ts, groups };
}

function oracle(events, { snapshots = [], markers = [] } = {}) {
  const rawRows = acceptedRows(events), operations = canonicalOperations(rawRows), sessions = buildSessions(rawRows);
  const affectedByKind = new Map([
    ["spike", spikeSessions(operations.rows)], ["loop", loopSessions(operations.rows)], ["read-warning", readWarningSessions(operations.rows)],
  ]);
  return { session_count: sessions.length,
    token_session_count: new Set(operations.rows.filter(hasTokens).map(sessionKey)).size,
    operation_count: operations.count, token_operation_count: operations.rows.filter(hasTokens).length,
    conditions: conditionRows(sessions, snapshots, affectedByKind),
    changes: changeRows(sessions, snapshots, markers, affectedByKind), regression: regression(operations.rows),
    affected_session_counts: Object.fromEntries([...affectedByKind].map(([kind, sessions]) => [kind, sessions.size])) };
}

const rowSort = (a, b) => a.event_kind.localeCompare(b.event_kind) || a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value);
const conditionProjection = (row) => ({ dimension: row.dimension, value: row.value, event_kind: row.event_kind,
  with_condition: row.with_condition, without_condition: row.without_condition, unknown_condition: row.unknown_condition,
  known_condition: row.known_condition, total_observations: row.total_observations, coverage: row.coverage,
  with_affected: row.with_affected, without_affected: row.without_affected, with_rate: row.with_rate,
  without_rate: row.without_rate, relative_delta: row.relative_delta, comparison_available: row.comparison_available,
  percent_available: row.percent_available, presentation_state: comparisonPresentation(row).state });
const changeProjection = (change) => ({ marker_id: change.marker.marker_id, comparisons: change.comparisons.map((row) => ({
  event_kind: row.event_kind, before: row.before, after: row.after, ambiguous_boundary: row.ambiguous_boundary,
  spanning_boundary: row.spanning_boundary, unknown_condition: row.unknown_condition, state: row.state,
  relative_delta: row.relative_delta, presentation_state: changePresentation(row).state,
})).sort((a, b) => a.event_kind.localeCompare(b.event_kind)) });

function equal(label, actual, expected) {
  if (stableJson(actual) !== stableJson(expected)) throw new Error(`${label} disagreed\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
}

function verify(events, options = {}) {
  const expected = oracle(events, options), report = analyzeTelemetry(events, options);
  equal("policy", { minimum_cohort: report.conditions.policy.minimum_cohort, minimum_events: report.conditions.policy.minimum_events,
    display_band: report.conditions.policy.display_band }, POLICY);
  equal("session count", report.conditions.data_quality.sessions, expected.session_count);
  equal("sessions with token data", report.sessions.length, expected.token_session_count);
  equal("operation count", report.conditions.data_quality.flows, expected.operation_count);
  equal("token operation count", report.capture_count, expected.token_operation_count);
  equal("condition rates", report.conditions.comparisons.map(conditionProjection).sort(rowSort), expected.conditions);
  equal("change boundaries", report.conditions.changes.map(changeProjection).sort((a, b) => a.marker_id.localeCompare(b.marker_id)), expected.changes);
  equal("per-call regression", { split_ts: report.regression.split_ts,
    groups: report.regression.groups.map((row) => ({ ...row })).sort((a, b) => a.group.localeCompare(b.group)) }, expected.regression);
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
  try { verify(testCase.events, testCase); }
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

const records = fs.readFileSync(new URL("../../portal/tokens2/mock-spool.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const demo = conditionDemoEvidence(records);
const demoCase = { ...demo, markers: [marker("demo-boundary", "2026-06-12T00:00:00.000Z")] };
const demoStates = new Set(oracle(demoCase.events, demoCase).conditions.map((row) => row.presentation_state));
requireCoverage(["thin", "fewer", "more"].every((state) => demoStates.has(state)), "demo thin/fewer/more condition outcomes");
runCase("bundled demo", demoCase);

const tiedRegression = regressionTieCase();
runCase("regression pin: equal timestamps stay together", tiedRegression);
const tiedResult = oracle(tiedRegression.events, tiedRegression).regression;
requireCoverage(tiedResult.split_ts === "2026-09-16T04:00:00.000Z"
  && tiedResult.groups.reduce((count, row) => count + row.before_calls, 0) === 3,
"equal-timestamp midpoint uses the nearest distinct boundary");
const noTemporalOrder = regressionTieCase({ allSameTime: true });
runCase("regression pin: all timestamps equal is unavailable", noTemporalOrder);
requireCoverage(oracle(noTemporalOrder.events, noTemporalOrder).regression.split_ts == null,
  "all-equal timestamps make regression unavailable");

const seeds = [0x00c0ffee, 0x12345678, 0x5eed5eed, 0x9e3779b9, 0xdecafbad, 0xf00dcafe];
for (const seed of seeds) {
  const testCase = { ...seededCase(seed), seed }, expected = oracle(testCase.events, testCase);
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
  runCase(`seed ${seed}`, testCase);
}

console.log(`telemetry oracle: bundled demo and ${seeds.length} seeded spools matched independent session, operation, condition, boundary, gating, regression and loop calculations`);
