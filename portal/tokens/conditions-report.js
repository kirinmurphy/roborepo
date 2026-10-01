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
    document.getElementById("condition-changes-section").hidden = !report;
    evidence.render(report);
    ledger.render(report);
    renderCoverage(report);
    if (!report) return;
    renderConditionCards(report, evidence.show);
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
