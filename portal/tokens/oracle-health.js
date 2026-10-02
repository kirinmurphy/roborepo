import { portalGetJson, portalWireBackdropClose } from "/portal/shared/api.js";

const POLL_MS = 5000;
const STATUS_LABELS = { passed: "Passed", checking: "Checking", stale: "Stale", partial: "Partial",
  unavailable: "Unavailable", failed: "Failed" };
const SUMMARIES = { passed: "Production and oracle calculations agree for the checked supported evidence.",
  checking: "An independent comparison is in progress.", stale: "Evidence changed; the last comparison is not current.",
  partial: "Covered calculations agree, but required evidence is incomplete or unresolved.",
  unavailable: "A complete comparable input could not be evaluated.",
  failed: "Production and oracle calculations disagree on covered fields." };
const CHECKS = new Set(["sessions", "operations", "conditions", "boundaries", "gating", "regression", "loops"]);
const DIFFERENCES = { policy: "evidence policy", session_count: "session counts", token_session_count: "token-session counts",
  operation_count: "operation counts", token_operation_count: "token-operation counts", conditions: "condition comparisons",
  changes: "change boundaries", regression: "regression" };
const ERRORS = { comparison_error: "comparison error", evidence_read_error: "evidence read error",
  worker_start_error: "worker start error", worker_crash: "worker crash", worker_timeout: "worker timeout",
  invalid_worker_result: "invalid worker result", signature_error: "evidence signature error" };
const ISSUE_LABELS = { skipped_evidence: "skipped evidence", malformed_event: "malformed events",
  unsupported_event_schema: "unsupported event schemas", unknown_model: "unknown models",
  unresolved_repository: "unresolved repositories", malformed_tokens: "malformed token data" };

const panel = createOracleHealthPanel();
panel.start();

function createOracleHealthPanel() {
  const badge = document.getElementById("oracle-health-status");
  const open = document.getElementById("oracle-health-open");
  const dialog = document.getElementById("oracle-health-dialog");
  let timer = null, inFlight = false;
  open.addEventListener("click", () => { dialog.showModal(); open.setAttribute("aria-expanded", "true"); });
  dialog.querySelector("[data-oracle-close]").addEventListener("click", close);
  dialog.querySelector("[data-doc-guide]").addEventListener("click", close);
  dialog.addEventListener("close", () => open.setAttribute("aria-expanded", "false"));
  portalWireBackdropClose(dialog, close);
  document.addEventListener("visibilitychange", () => document.hidden ? stopTimer() : (refresh(), startTimer()));

  async function refresh() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try { render(normalize(await portalGetJson("/api/telemetry/oracle-health"))); }
    catch { render(unavailable()); }
    finally { inFlight = false; }
  }
  function render(health) {
    const label = STATUS_LABELS[health.status];
    badge.dataset.status = health.status;
    badge.textContent = `Oracle health: ${label}`;
    set("[data-oracle-status]", label);
    set("[data-oracle-freshness]", freshness(health.status));
    set("[data-oracle-checked]", health.checked_at ? new Date(health.checked_at).toLocaleString() : "Not yet checked");
    set("[data-oracle-duration]", health.duration_ms == null ? "Not available" : `${health.duration_ms.toLocaleString()} ms`);
    set("[data-oracle-counts]", `${health.event_count.toLocaleString()} events · ${health.session_count.toLocaleString()} sessions · ${health.operation_count.toLocaleString()} operations`);
    set("[data-oracle-coverage]", `${health.coverage.supported_events.toLocaleString()} supported · ${health.coverage.unsupported_events.toLocaleString()} unsupported`);
    const activeChecks = new Set(health.coverage.checks);
    for (const item of dialog.querySelectorAll("[data-oracle-check]")) item.hidden = !activeChecks.has(item.dataset.oracleCheck);
    dialog.querySelector("[data-oracle-checks-empty]").hidden = activeChecks.size > 0;
    set("[data-oracle-output]", output(health));
  }
  function set(selector, value) { dialog.querySelector(selector).textContent = value; }
  function close() { if (dialog.open) dialog.close(); }
  function startTimer() { if (timer == null) timer = setInterval(refresh, POLL_MS); }
  function stopTimer() { clearInterval(timer); timer = null; }
  return { start() { refresh(); if (!document.hidden) startTimer(); } };
}

function normalize(value) {
  const count = (number) => Number.isSafeInteger(number) && number >= 0;
  if (!value || value.schema !== 1 || !STATUS_LABELS[value.status] || !value.coverage
    || ![value.event_count, value.session_count, value.operation_count, value.coverage.supported_events,
      value.coverage.unsupported_events].every(count) || !Array.isArray(value.coverage.checks)) return unavailable();
  return { ...value, coverage: { ...value.coverage, checks: value.coverage.checks.filter((item) => CHECKS.has(item)),
    issues: Array.isArray(value.coverage.issues) ? value.coverage.issues : [] },
    differences: Array.isArray(value.differences) ? value.differences : [] };
}
function unavailable() { return { schema: 1, status: "unavailable", checked_at: null, duration_ms: null,
  event_count: 0, session_count: 0, operation_count: 0,
  coverage: { supported_events: 0, unsupported_events: 0, checks: [], issues: [] }, differences: [] }; }
function freshness(status) {
  if (["passed", "partial", "failed"].includes(status)) return "Yes — result matches current evidence.";
  if (status === "stale") return "No — evidence changed after this result.";
  if (status === "checking") return "Pending — comparison in progress.";
  return "No current comparison is available.";
}
function output(health) {
  if (health.status === "failed") return `Disagreement in: ${health.differences.map((item) => DIFFERENCES[item]).filter(Boolean).join(", ") || "covered fields"}.`;
  if (health.status === "partial" && health.coverage.issues.length) {
    const issues = health.coverage.issues.map((item) => `${ISSUE_LABELS[item.category] || "unsupported evidence"} (${item.count})`);
    return `Supported calculations agree. Coverage limits: ${issues.join(", ")}.`;
  }
  if (health.status === "unavailable" && ERRORS[health.error_category]) return `${SUMMARIES.unavailable} ${ERRORS[health.error_category]}.`;
  return SUMMARIES[health.status];
}
