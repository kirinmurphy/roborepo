import { conditionTemplate, setText } from "./conditions-dom.js";
import { percent } from "./conditions-format.js";
import { renderConditionCards } from "./conditions-cards.js";
import { createEvidenceList } from "./conditions-evidence.js";
import { createConditionLedger } from "./conditions-ledger.js";
import { createChangeForm } from "./conditions-change-form.js";
import { renderConditionChanges } from "./conditions-changes.js";

export function createConditionsReport({ openSession, getData, onSaved }) {
  const evidence = createEvidenceList(openSession);
  const ledger = createConditionLedger(openSession);
  const form = createChangeForm(getData, onSaved);
  return { render(data, enabled) {
    const report = data.conditions;
    document.getElementById("condition-report").hidden = !report;
    document.getElementById("condition-model-section").hidden = !report;
    document.getElementById("condition-changes-section").hidden = !report;
    evidence.render(report);
    ledger.render(report);
    renderCoverage(report);
    if (!report) return;
    renderConditionCards(report, evidence.show);
    renderMetrics(report);
    renderConditionChanges(report, form, enabled);
    document.getElementById("timeline-section").hidden = true;
  } };
}

function renderCoverage(report) {
  const band = document.getElementById("investigation-condition-coverage");
  const labels = { model: "model", repo: "repository", harness: "harness", packages: "package snapshot", skills: "skill snapshot" };
  const rows = Object.entries(report?.data_quality?.condition_coverage ?? {});
  band.hidden = !rows.length;
  band.replaceChildren();
  for (const [key, value] of rows) {
    const entry = document.createElement("span");
    entry.textContent = `${labels[key] ?? key} ${value.known}/${value.eligible} known`;
    band.appendChild(entry);
  }
}

function renderMetrics(report) {
  const metrics = document.getElementById("condition-model-metrics");
  metrics.replaceChildren();
  for (const row of report.relative_models.filter((item) => item.meets_sample_floor)) {
    const metric = conditionTemplate("condition-metric-template");
    setText(metric, "h4", row.model);
    setText(metric, "[data-value]", row.average_tokens == null ? "Token usage unavailable" : `${Math.round(row.average_tokens).toLocaleString()} tokens / session`);
    setText(metric, "[data-coverage]", `${row.valid_token_observations} valid / ${row.eligible_observations} eligible sessions · ${row.coverage_state} · ${percent(row.coverage)}`);
    metric.querySelector("[data-coverage]").classList.toggle("partial", row.coverage_state !== "available");
    const ratio = row.input_tokens == null || !row.output_tokens ? null : `${(row.input_tokens / row.output_tokens).toFixed(1)}:1`;
    setText(metric, "[data-mix]", ratio ? `Input:output ${ratio}` : "Input:output unavailable");
    setText(metric, "[data-attribution]", `${row.approximate_model_observations} approximate model attributions · ${row.exact_model_observations} exact`);
    metrics.appendChild(metric);
  }
  if (!metrics.children.length) metrics.textContent = `Collect at least ${report.policy.minimum_model_sessions} sessions per model to show usage.`;
}
