import { conditionTemplate, setText, shortDate } from "./conditions-dom.js";
import { PROBLEM_KINDS, sessionKey, problemLabel, problemAmount, conditionName, repositoryLabel } from "./conditions-format.js";
import { compactContext } from "./conditions-context.js";

export function createEvidenceList(openSession) {
  const section = document.getElementById("condition-investigate-events");
  const list = section.querySelector("[data-events]");
  const filterLabel = section.querySelector("[data-filter]");
  const clear = section.querySelector("[data-clear]");
  let report, filter = null;
  clear.onclick = () => { filter = null; render(report); };

  function render(next) {
    report = next;
    const rows = (report?.ledger ?? []).filter((row) => PROBLEM_KINDS.includes(row.kind));
    section.hidden = !rows.length;
    const matches = filter ? rows.filter((row) => row.kind === filter.event_kind && row.context.conditions.some((condition) => condition.dimension === filter.dimension && condition.value === filter.value && condition.state === "present")) : rows;
    const groups = new Map();
    for (const row of matches) {
      const key = sessionKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    setText(section, "[data-count]", `${groups.size} sessions`);
    filterLabel.textContent = filter ? `Showing ${conditionName(filter)} · ${filter.event_kind}` : "Supporting evidence for the recommendations above. One row per session; open details to investigate.";
    clear.hidden = !filter;
    list.replaceChildren();
    for (const findings of groups.values()) {
      const row = findings[0];
      const item = conditionTemplate("condition-investigate-event-template");
      setText(item, "[data-problem]", problemLabel(row));
      setText(item, "[data-repository]", row.repository_label ?? repositoryLabel(row.context.repository_id));
      setText(item, "[data-amount]", problemAmount(row));
      setText(item, "[data-findings]", findings.length > 1 ? `+${findings.length - 1} ${findings.length === 2 ? "finding" : "findings"}` : "");
      item.querySelector("[data-chips]").replaceWith(compactContext(row.context));
      const date = item.querySelector("time");
      date.textContent = shortDate(row.ts);
      if (row.ts) date.dateTime = row.ts;
      item.querySelector("button").onclick = () => openSession(row.session_id, row.harness, row.detail ?? problemLabel(row), "Session detail");
      list.appendChild(item);
    }
    if (!groups.size) list.textContent = "No matching problem sessions in this report.";
  }

  return { render, show(condition) {
    filter = condition;
    render(report);
    section.open = true;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    section.querySelector("summary").focus({ preventScroll: true });
  } };
}
