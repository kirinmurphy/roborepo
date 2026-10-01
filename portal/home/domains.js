import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";

export function appendRepositoryDomains(host, domains) {
  const counts = domains.plans.data?.counts;
  if (counts && counts.active + counts.backlog > 0) {
    host.append(domainRow("Plans", `${counts.active} Active · ${counts.backlog} Backlog`, {
      href: "/plans", linkLabel: "view all plans", details: activePlanDetails(domains.plans),
    }));
  }
  const tokens = domains.tokens.data;
  if (tokens?.warningCount > 0) {
    host.append(domainRow("Token Warnings", `${tokens.warningCount} warning${tokens.warningCount === 1 ? "" : "s"}`, {
      href: "/tokens", linkLabel: "view all activity", warning: true, details: [tokenWarnings(tokens)],
    }));
  }
  host.hidden = !host.childElementCount;
}

function domainRow(label, summary, { href, linkLabel, warning = false, details }) {
  const node = fill(tpl("tpl-domain-row"), { label, summary });
  const link = node.querySelector("[data-slot=link]");
  link.href = href;
  link.textContent = linkLabel;
  node.querySelector("[data-slot=warning-icon]").hidden = !warning;
  const slot = node.querySelector("[data-slot=details]");
  slot.hidden = !details.length;
  slot.append(...details);
  return node;
}

function activePlanDetails(envelope) {
  return (envelope.data?.active || []).map((plan) => {
    const total = plan.taskCounts?.total || 0;
    const percent = total > 0 ? Math.round((plan.taskCounts.complete / total) * 100) : null;
    const node = fill(tpl("tpl-plan-item"), { title: plan.title, percent: percent === null ? "—" : `${percent}%` });
    node.href = `/plans#${encodeURIComponent(plan.id)}`;
    node.title = percent === null ? "No checklist tasks" : `${plan.taskCounts.complete} of ${total} tasks complete`;
    const progress = node.querySelector("[data-slot=progress]");
    progress.hidden = percent === null;
    if (percent !== null) {
      progress.setAttribute("aria-label", `${plan.title} completion`);
      progress.setAttribute("aria-valuenow", String(percent));
      progress.querySelector("[data-slot=fill]").style.width = `${percent}%`;
    }
    return node;
  });
}

function tokenWarnings(tokens) {
  const list = tpl("tpl-token-warnings");
  const labels = { spike: "Token spike", loop: "Repeated tool loop", "read-warning": "Repeated read warning" };
  for (const warning of tokens.warnings || tokens.recent || []) {
    const context = [warning.harness, warning.sessionId, warning.at ? new Date(warning.at).toLocaleString() : null].filter(Boolean).join(" · ");
    list.append(fill(tpl("tpl-token-warning"), { label: labels[warning.kind] || warning.kind, context }));
  }
  return list;
}
