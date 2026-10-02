import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";

export function appendRepositoryDomains(host, domains, { onOpenPlan } = {}) {
  const counts = domains.plans.data?.counts;
  if (counts && counts.active + counts.backlog > 0) {
    host.append(domainRow("Plans", `${counts.active} Active · ${counts.backlog} Backlog`, {
      glyph: "plans", href: "/plans", linkLabel: "all plans", details: activePlanDetails(domains.plans, onOpenPlan),
    }));
  }
  const tokens = domains.tokens.data;
  if (tokens?.warningCount > 0) {
    const warnings = tokens.warnings || tokens.recent || [];
    host.append(domainRow("Token Warnings", warningSummary(tokens.warningCount, warnings), {
      glyph: "warning", warning: true, href: "/tokens", linkLabel: "all activity", details: [tokenWarnings(warnings)],
    }));
  }
  host.hidden = !host.childElementCount;
}

function domainRow(label, summary, { glyph, href, linkLabel, warning = false, details }) {
  const node = fill(tpl("tpl-domain-row"), { label, summary });
  const icon = node.querySelector("[data-slot=glyph]");
  icon.setAttribute("name", glyph);
  node.classList.toggle("is-warning", warning);
  const link = node.querySelector("[data-slot=link]");
  link.href = href;
  link.textContent = linkLabel;
  const slot = node.querySelector("[data-slot=details]");
  slot.hidden = !details.length;
  slot.append(...details);
  return node;
}

function activePlanDetails(envelope, onOpenPlan) {
  return (envelope.data?.active || []).map((plan) => {
    const total = plan.taskCounts?.total || 0;
    const percent = total > 0 ? Math.round((plan.taskCounts.complete / total) * 100) : null;
    const done = percent === 100;
    const node = fill(tpl("tpl-plan-item"), { title: plan.title, percent: percent === null ? "—" : `${percent}%` });
    node.querySelector("[data-slot=title]").addEventListener("click", () => onOpenPlan?.(plan));
    node.title = percent === null ? "No checklist tasks" : `${plan.taskCounts.complete} of ${total} tasks complete`;
    const progress = node.querySelector("[data-slot=progress]");
    progress.hidden = percent === null || done;
    node.querySelector("[data-slot=percent]").hidden = done;
    node.querySelector("[data-slot=complete]").hidden = !done;
    if (percent !== null && !done) {
      progress.setAttribute("aria-label", `${plan.title} completion`);
      progress.setAttribute("aria-valuenow", String(percent));
      progress.style.setProperty("--percent", String(percent));
    }
    return node;
  });
}

function warningSummary(count, warnings) {
  const label = `${count} warning${count === 1 ? "" : "s"}`;
  const days = warnings.map((warning) => warning.at).filter(Boolean).sort();
  if (!days.length) return label;
  const first = monthDay(days[0]);
  const last = monthDay(days[days.length - 1]);
  return first === last ? `${label} on ${first}` : `${label} from ${first} to ${last}`;
}

function monthDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
}

const KIND_LABELS = {
  spike: ["token spike", "token spikes"],
  loop: ["repeated tool loop", "repeated tool loops"],
  "read-warning": ["repeated read warning", "repeated read warnings"],
};

// One line per model ("2 token spikes and 3 repeated tool loops in gpt-5-codex"), busiest model
// first. The per-session list lives on the Tokens page.
function tokenWarnings(warnings) {
  const byModel = new Map();
  for (const warning of warnings) {
    const model = warning.model || null;
    const kinds = byModel.get(model) || new Map();
    kinds.set(warning.kind, (kinds.get(warning.kind) || 0) + 1);
    byModel.set(model, kinds);
  }
  const rows = [...byModel].map(([model, kinds]) => ({ model, kinds, total: [...kinds.values()].reduce((sum, n) => sum + n, 0) }));
  rows.sort((a, b) => b.total - a.total);
  const list = tpl("tpl-token-warnings");
  for (const { model, kinds } of rows) {
    const parts = [...kinds].map(([kind, n]) => {
      const [one, many] = KIND_LABELS[kind] || [kind, kind];
      return `${n} ${n === 1 ? one : many}`;
    });
    const item = fill(tpl("tpl-token-warning"), { summary: joinList(parts), model: model || "an unknown model" });
    if (!model) item.querySelector("[data-slot=model]").classList.add("is-unknown");
    list.append(item);
  }
  return list;
}

function joinList(parts) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
