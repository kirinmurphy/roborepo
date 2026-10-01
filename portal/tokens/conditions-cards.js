import { portalWireBackdropClose } from "/portal/shared/api.js";
import { conditionTemplate, setText } from "./conditions-dom.js";
import { DIMENSION_NAMES, EVENT_NAMES, comparisonPresentation, changePresentation, conditionName, percent } from "./conditions-format.js";

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
  const dialog = card.querySelector("[data-condition-dialog]");
  setText(dialog, "h3", `${title} — full outcomes`);
  dialog.setAttribute("aria-label", `${title} full outcomes`);
  card.querySelector("[data-condition-open]").onclick = () => dialog.showModal();
  card.querySelector("[data-condition-close]").onclick = () => dialog.close();
  portalWireBackdropClose(dialog, () => dialog.close());
  const thinDialog = card.querySelector("[data-condition-thin-dialog]");
  setText(thinDialog, "h3", `${title} — more evidence needed`);
  thinDialog.setAttribute("aria-label", `${title} more evidence needed`);
  card.querySelector("[data-condition-thin-open]").onclick = () => thinDialog.showModal();
  card.querySelector("[data-condition-thin-close]").onclick = () => thinDialog.close();
  portalWireBackdropClose(thinDialog, () => thinDialog.close());
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
  for (const state of ["fewer", "more"]) {
    const list = card.querySelector(`[data-${state}]`);
    const matches = presented.filter(({ view }) => view.state === state)
      .sort((a, b) => Math.abs(b.row.relative_delta ?? 0) - Math.abs(a.row.relative_delta ?? 0));
    // One row per condition: its name, then every outcome for it stacked in the second column.
    const byCondition = new Map();
    for (const match of matches) {
      const key = conditionName(match.row);
      if (!byCondition.has(key)) byCondition.set(key, []);
      byCondition.get(key).push(match);
    }
    const conditions = [...byCondition.entries()];
    for (const [name, outcomes] of conditions.slice(0, MAX_PREVIEW_OUTCOMES)) list.appendChild(conditionItem(name, outcomes, inspect));
    if (!matches.length) list.textContent = "-";
    if (conditions.length > MAX_PREVIEW_OUTCOMES) {
      const more = document.createElement("li");
      more.textContent = `${conditions.length - MAX_PREVIEW_OUTCOMES} more in Full outcomes`;
      list.appendChild(more);
    }
  }
  const thin = presented.filter(({ row, view }) => view.state === "thin" && (row.with_affected || row.without_affected));
  fillThinDialog(thinDialog, thin);
  card.querySelector("[data-condition-thin-open]").hidden = !thin.length;
  const strong = presented.some(({ view }) => ["fewer", "more"].includes(view.state));
  card.querySelector(".condition-columns").hidden = !strong;
  const empty = card.querySelector("[data-empty]");
  empty.hidden = strong || thin.length > 0;
  empty.textContent = presented.some(({ view }) => view.state === "unavailable") ? "A comparison group is missing. Collect sessions with and without this condition."
    : presented.some(({ view }) => view.state === "thin") ? "Too little evidence to judge a difference. Raw rates are in Full outcomes."
      : "No clear difference.";
  return card;
}

// "More evidence needed" = the raw counts exist but are too small to print a percentage. Each row
// says exactly what is still missing, from the same policy the server used to withhold the percent.
function fillThinDialog(dialog, thin) {
  const policy = thin[0]?.row.policy ?? { minimum_cohort: 10, minimum_events: 3 };
  setText(dialog, "[data-thin-explainer]", `A percentage appears once a comparison has at least ${policy.minimum_cohort} sessions with and without the condition, and at least ${policy.minimum_events} sessions with the problem in each group. Until then only the raw counts are shown.`);
  const body = dialog.querySelector("[data-thin]");
  body.replaceChildren();
  for (const { row } of thin) {
    const item = conditionTemplate("condition-thin-row-template");
    const event = EVENT_NAMES[row.event_kind] ?? row.event_kind;
    setText(item, "[data-condition]", conditionName(row));
    setText(item, "[data-problem]", event);
    setText(item, "[data-with]", `${row.with_affected} of ${row.with_condition} sessions`);
    setText(item, "[data-without]", `${row.without_affected} of ${row.without_condition} sessions`);
    setText(item, "[data-needed]", evidenceNeeded(row, event).join("; "));
    body.appendChild(item);
  }
}

function evidenceNeeded(row, event) {
  const { minimum_cohort: cohort, minimum_events: events } = row.policy;
  const needs = [];
  if (row.with_condition < cohort) needs.push(`${cohort - row.with_condition} more sessions with it`);
  if (row.without_condition < cohort) needs.push(`${cohort - row.without_condition} more sessions without it`);
  if (row.with_affected < events) needs.push(`${events - row.with_affected} more with ${event} among sessions with it`);
  if (row.without_affected < events) needs.push(`${events - row.without_affected} more with ${event} among sessions without it`);
  return needs.length ? needs : ["No " + event + " seen in the sessions without it"];
}

function conditionItem(name, outcomes, inspect) {
  const item = conditionTemplate("condition-outcome-item-template");
  setText(item, "strong", name);
  item.querySelector("strong").title = outcomes[0].row.value;
  const column = item.querySelector("[data-outcomes]");
  for (const { row, view } of outcomes) column.appendChild(outcomeLine(row, view, inspect));
  return item;
}

function outcomeLine(row, view, inspect) {
  const line = conditionTemplate("condition-outcome-line-template");
  setText(line, ".condition-outcome-pill", view.label);
  const info = outcomeTip(row, view);
  const icon = line.querySelector("portal-info-icon");
  icon.dataset.tip = info;
  icon.setAttribute("aria-label", info.replaceAll("\n", ". "));
  const button = line.querySelector("button");
  button.hidden = !row.with_affected;
  button.setAttribute("aria-label", `Inspect ${row.event_kind} sessions with ${conditionName(row)}`);
  button.onclick = () => inspect(row);
  return line;
}

// One fact per line: what each group looked like, what was left out, and the caveat.
function outcomeTip(row, view) {
  const event = EVENT_NAMES[row.event_kind] ?? row.event_kind;
  const group = (affected, total, rate) => `${affected} of ${total} sessions had ${event}${rate == null ? "" : ` (${percent(rate)})`}`;
  const lines = [
    `With ${conditionName(row)}: ${group(row.with_affected, row.with_condition, row.with_rate)}`,
    `Without it: ${group(row.without_affected, row.without_condition, row.without_rate)}`,
  ];
  if (row.unknown_condition) lines.push(`Not counted: ${row.unknown_condition} sessions with unknown ${DIMENSION_NAMES[row.dimension]?.toLowerCase() ?? row.dimension}`);
  if (view.state !== "thin") lines.push("Association only; tasks and other conditions may differ.");
  return lines.join("\n");
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
