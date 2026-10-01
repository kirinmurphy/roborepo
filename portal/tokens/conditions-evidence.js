import { portalWireBackdropClose } from "/portal/shared/api.js";
import { conditionTemplate, setText, numericDate } from "./conditions-dom.js";
import { PROBLEM_KINDS, EVENT_NAMES, sessionKey, problemLabel, problemAmount, conditionName, repositoryLabel } from "./conditions-format.js";
import { compactContext } from "./conditions-context.js";

export function createEvidenceList(openSession) {
  const section = document.getElementById("condition-investigate-events");
  const list = section.querySelector("[data-events]");
  const dialog = document.getElementById("condition-sessions-dialog");
  const dialogList = dialog.querySelector("[data-sessions]");
  let report, filter = null;
  dialog.querySelector("[data-sessions-close]").onclick = () => dialog.close();
  portalWireBackdropClose(dialog, () => dialog.close());

  const problemRows = () => (report?.ledger ?? []).filter((row) => PROBLEM_KINDS.includes(row.kind));

  // One row per session (its first finding leads; extra findings collapse into "+N findings").
  function fill(target, rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = sessionKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    target.replaceChildren();
    for (const findings of groups.values()) {
      const row = findings[0];
      const item = conditionTemplate("condition-investigate-event-template");
      setText(item, "[data-problem]", problemLabel(row));
      setText(item, "[data-repository]", row.repository_label ?? repositoryLabel(row.context.repository_id));
      setText(item, "[data-amount]", problemAmount(row));
      setText(item, "[data-findings]", findings.length > 1 ? `+${findings.length - 1} ${findings.length === 2 ? "finding" : "findings"}` : "");
      item.querySelector("[data-chips]").replaceWith(compactContext(row.context));
      const date = item.querySelector("time");
      date.textContent = numericDate(row.ts);
      if (row.ts) date.dateTime = row.ts;
      item.querySelector("button").onclick = () => openSession(row.session_id, row.harness, row.detail ?? problemLabel(row), "Session detail");
      target.appendChild(item);
    }
    return groups.size;
  }

  function matching(condition) {
    return problemRows().filter((row) => row.kind === condition.event_kind && row.context.conditions.some((entry) => entry.dimension === condition.dimension && entry.value === condition.value && entry.state === "present"));
  }

  function render(next) {
    report = next;
    const rows = problemRows();
    section.hidden = !rows.length;
    const count = fill(list, rows);
    setText(section, "[data-count]", `${count} sessions`);
    if (!count) list.textContent = "No matching problem sessions in this report.";
    if (dialog.open && filter) refreshDialog();
  }

  function refreshDialog() {
    setText(dialog, "[data-sessions-title]", `${conditionName(filter)} · ${EVENT_NAMES[filter.event_kind] ?? filter.event_kind}`);
    if (!fill(dialogList, matching(filter))) dialogList.textContent = "No matching sessions in this report.";
  }

  // "Inspect sessions" opens a dialog scoped to the clicked condition + problem kind — only the
  // sessions behind that one comparison, not a scroll back to the full list.
  return { render, show(condition) {
    filter = condition;
    refreshDialog();
    dialog.showModal();
  } };
}
