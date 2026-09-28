import { portalWireBackdropClose } from "/portal/shared/api.js";
import { conditionTemplate, setText } from "./conditions-dom.js";
import { DIMENSION_NAMES, comparisonPresentation, changePresentation, conditionName, percent } from "./conditions-format.js";

const MAX_PREVIEW_OUTCOMES = 3;

export function renderConditionCards(report, inspect) {
  const container = document.getElementById("condition-cards");
  container.replaceChildren();
  const groups = new Map();
  for (const row of report.comparisons) {
    if (!groups.has(row.dimension)) groups.set(row.dimension, []);
    groups.get(row.dimension).push(row);
  }
  for (const [dimension, rows] of groups) container.appendChild(categoryCard(dimension, rows, report, inspect));
  if (report.changes?.length) container.appendChild(markedChanges(report.changes));
}

function categoryCard(dimension, rows, report, inspect) {
  const card = conditionTemplate("condition-card-template");
  const title = DIMENSION_NAMES[dimension] ?? dimension;
  setText(card, ".condition-card-head h3", title);
  const coverage = report.data_quality.condition_coverage[dimension];
  setText(card, "[data-coverage]", `${coverage.known} / ${coverage.eligible} known`);
  const dialog = card.querySelector("dialog");
  setText(dialog, "h3", `${title} — full outcomes`);
  dialog.setAttribute("aria-label", `${title} full outcomes`);
  card.querySelector("[data-condition-open]").onclick = () => dialog.showModal();
  card.querySelector("[data-condition-close]").onclick = () => dialog.close();
  portalWireBackdropClose(dialog, () => dialog.close());
  const presented = rows.map((row) => ({ row, view: comparisonPresentation(row) }));
  for (const { row, view } of presented) {
    const detail = conditionTemplate("condition-outcome-row-template");
    setText(detail, "[data-condition]", conditionName(row));
    detail.querySelector("[data-condition]").title = row.value;
    setText(detail, "[data-outcome]", `${view.label}. ${view.detail}`);
    setText(detail, "[data-with]", `with ${row.with_affected}/${row.with_condition} (${percent(row.with_rate)})`);
    setText(detail, "[data-without]", `without ${row.without_affected}/${row.without_condition} (${percent(row.without_rate)})`);
    setText(detail, "[data-coverage]", `${row.unknown_condition} unknown · ${percent(row.coverage)} known`);
    detail.classList.add(`outcome-${view.state}`);
    card.querySelector("[data-condition-details]").appendChild(detail);
  }
  for (const state of ["fewer", "more", "thin"]) {
    const list = card.querySelector(`[data-${state}]`);
    const matches = presented.filter(({ row, view }) => view.state === state && (state !== "thin" || row.with_affected || row.without_affected))
      .sort((a, b) => Math.abs(b.row.relative_delta ?? 0) - Math.abs(a.row.relative_delta ?? 0));
    for (const { row, view } of matches.slice(0, MAX_PREVIEW_OUTCOMES)) list.appendChild(outcomeItem(row, view, inspect));
    if (!matches.length && state !== "thin") list.textContent = "Nothing stands out.";
    if (state === "thin") {
      list.parentElement.hidden = !matches.length;
      setText(card, "[data-thin-count]", `· ${matches.length} comparison${matches.length === 1 ? "" : "s"} — show raw rates`);
    }
    if (matches.length > MAX_PREVIEW_OUTCOMES) {
      const more = document.createElement("li");
      more.textContent = `${matches.length - MAX_PREVIEW_OUTCOMES} more in Full outcomes`;
      list.appendChild(more);
    }
  }
  const strong = presented.some(({ view }) => ["fewer", "more"].includes(view.state));
  card.querySelector(".condition-columns").hidden = !strong;
  const empty = card.querySelector("[data-empty]");
  empty.hidden = strong || !card.querySelector("[data-thin]").parentElement.hidden;
  empty.textContent = presented.some(({ view }) => view.state === "unavailable") ? "A comparison group is missing. Collect sessions with and without this condition."
    : presented.some(({ view }) => view.state === "thin") ? "Too little evidence to judge a difference. Raw rates are in Full outcomes."
      : "No clear difference. Focus on the conditions with a visible signal.";
  setText(card, "[data-next]", strong ? "Inspect matching sessions; compare similar tasks before changing your setup." : "Keep collecting evidence before changing your setup.");
  return card;
}

function outcomeItem(row, view, inspect) {
  const item = conditionTemplate("condition-outcome-item-template");
  setText(item, "strong", conditionName(row));
  item.querySelector("strong").title = row.value;
  setText(item, ".condition-outcome-pill", view.label);
  setText(item, "small", `${view.state === "thin" ? "Below percentage threshold" : view.raw} · ${row.unknown_condition} unknown`);
  const button = item.querySelector("button");
  button.hidden = !row.with_affected;
  button.setAttribute("aria-label", `Inspect ${row.event_kind} sessions with ${conditionName(row)}`);
  button.onclick = () => inspect(row);
  return item;
}

function markedChanges(changes) {
  const card = conditionTemplate("condition-marked-changes-template");
  for (const change of changes) {
    const item = conditionTemplate("condition-marked-change-entry-template");
    setText(item, "a", change.marker.title);
    item.querySelector("a").href = `#change-${encodeURIComponent(change.marker.marker_id)}`;
    const views = change.comparisons.map(changePresentation);
    setText(item, "span", views.map((view) => view.label).join(" · ") || "Recorded; no watched problems");
    card.querySelector("[data-changes]").appendChild(item);
  }
  return card;
}
