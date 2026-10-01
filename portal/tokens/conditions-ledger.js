import { conditionTemplate, setText, shortDate } from "./conditions-dom.js";
import { problemLabel, problemAmount, repositoryLabel } from "./conditions-format.js";

const PAGE_SIZE = 12;
const EVENT_ICONS = { spike: "↗", loop: "↻", "read-warning": "!", "ambient-change": "⇣", "manual-change": "✎" };

export function createConditionLedger(openSession) {
  const ledger = document.getElementById("condition-ledger");
  const more = document.getElementById("condition-ledger-more");
  let report, limit = PAGE_SIZE;
  more.onclick = () => { limit += PAGE_SIZE; render(report); };

  function render(next) {
    report = next;
    const rows = report?.ledger ?? [];
    document.getElementById("condition-ledger-section").hidden = !rows.length;
    ledger.replaceChildren();
    for (const row of rows.slice(0, limit)) {
      const item = conditionTemplate("condition-ledger-template");
      item.classList.toggle("is-change", row.kind.endsWith("change"));
      const date = item.querySelector("time");
      date.textContent = shortDate(row.ts);
      if (row.ts) { date.dateTime = row.ts; date.title = new Date(row.ts).toLocaleString(); }
      setText(item, "[data-icon]", EVENT_ICONS[row.kind] ?? "•");
      const action = item.querySelector("button");
      action.textContent = row.marker ? `Marked change — ${row.marker.title}`
        : row.kind === "ambient-change" ? "Ambient context changed — configured packages" : problemLabel(row);
      action.disabled = !row.session_id && !row.marker;
      action.onclick = () => {
        if (row.marker) {
          const change = document.getElementById(`change-${encodeURIComponent(row.marker.marker_id)}`);
          change?.scrollIntoView({ behavior: "smooth", block: "start" });
          change?.focus({ preventScroll: true });
        } else openSession(row.session_id, row.harness, row.detail ?? problemLabel(row), null);
      };
      const scope = row.marker?.scope === "all" ? "Everywhere" : row.repository_label ?? repositoryLabel(row.context.repository_id);
      setText(item, "p", row.marker ? `effective ${shortDate(row.marker.effective_at ?? row.marker.ts)} · ${scope} · watching ${(row.marker.watching_kinds ?? []).join(", ")}`
        : row.kind === "ambient-change" ? `${scope} · first observed here; exact file revision unknown`
          : [scope, problemAmount(row), row.max_repeat ? `${row.tool ?? "Tool"} ×${row.max_repeat}` : null].filter(Boolean).join(" · "));
      const change = row.marker && report.changes.find((entry) => entry.marker.marker_id === row.marker.marker_id);
      setText(item, "[data-status]", change ? [...new Set(change.comparisons.map((entry) => entry.before && entry.after ? `${entry.before.observations} before / ${entry.after.observations} after · ${entry.state}` : entry.state))].join("; ")
        : row.kind === "ambient-change" ? "Observed configuration" : "");
      ledger.appendChild(item);
    }
    more.hidden = rows.length <= limit;
    more.textContent = `Show ${Math.min(PAGE_SIZE, rows.length - limit)} more (${rows.length} total)`;
  }
  return { render };
}
