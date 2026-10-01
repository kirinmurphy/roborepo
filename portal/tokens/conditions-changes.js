import { conditionTemplate, setText, shortDate } from "./conditions-dom.js";
import { changePresentation, repositoryLabel, EVENT_NAMES } from "./conditions-format.js";

export function renderConditionChanges(report, form, enabled) {
  const container = document.getElementById("condition-changes");
  container.replaceChildren();
  form.setEnabled(enabled);
  for (const change of report?.changes ?? []) {
    const card = conditionTemplate("condition-change-template");
    card.id = `change-${encodeURIComponent(change.marker.marker_id)}`;
    card.tabIndex = -1;
    setText(card, "h3", change.marker.title);
    setText(card, "[data-change-time]", `effective ${shortDate(change.marker.effective_at ?? change.marker.ts)}`);
    const scope = change.marker.scope === "all" ? "everywhere" : repositoryLabel(change.marker.repository_id);
    setText(card, "[data-change-scope]", `Watching ${(change.marker.watching_kinds ?? []).map((kind) => EVENT_NAMES[kind] ?? kind).join(" & ") || "no event kinds"} · ${scope}`);
    for (const comparison of change.comparisons) {
      const view = changePresentation(comparison);
      const item = conditionTemplate("condition-change-verdict-template");
      item.classList.add(view.state);
      setText(item, "strong", view.label);
      setText(item, "span", view.detail);
      setText(item, "p", view.next);
      card.querySelector("[data-change-verdicts]").appendChild(item);
    }
    if (!change.comparisons.length) setText(card, "[data-change-verdicts]", "Recorded · no watched problems selected.");
    const edit = card.querySelector("button");
    edit.disabled = !enabled;
    edit.onclick = () => form.open(change.marker);
    container.appendChild(card);
  }
  if (!container.children.length) container.textContent = "Record a change when you act on a recommendation, then check whether problems become less frequent.";
}
