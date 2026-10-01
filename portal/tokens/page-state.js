// Setup-state cascade for the Tokens page. The shown state is the FIRST failing rung:
//   telemetry off -> no harness -> no captured data -> full report.
// Pure (no DOM) so tokens-page-state-check.mjs can assert the contract directly.
export function pageState({ telemetryOn, activeHarnessCount, hasData }) {
  if (!telemetryOn) return "telemetry-off";
  if (!activeHarnessCount) return "no-harness";
  if (!hasData) return "no-data";
  return "full";
}
