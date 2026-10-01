import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";

const CHECKOUT_LIMIT = 5;

export function emptyState() {
  return fill(tpl("tpl-home-empty"), {
    title: "No repositories yet",
    body: "Start a local project, then open Runtime so RoboRepo can discover its checkouts and running application.",
  });
}

export function repositoryDirectory(repositories) {
  const node = tpl("tpl-repository-directory");
  node.append(...repositories.map(repositoryCard));
  return node;
}

export function unresolvedActivity(items) {
  const node = tpl("tpl-unresolved-activity");
  return fill(node, { summary: `${items.length} running ${items.length === 1 ? "workspace needs" : "workspaces need"} a repository association.` });
}

function repositoryCard(repository) {
  const node = fill(tpl("tpl-repository-card"), {
    name: repository.displayName,
    lifecycle: repository.lifecycle.state,
    meta: repositoryMeta(repository),
    "detail-link": { href: `/repositories/${repository.urlKey}` },
  });
  node.querySelector("[data-slot=lifecycle]").dataset.state = repository.lifecycle.state;
  const checkouts = repository.domains.runtime.data?.checkouts || [];
  const checkoutList = node.querySelector("[data-slot=checkouts]");
  if (checkouts.length === 0) checkoutList.append(checkoutRow({ name: "No known checkout", git: null, primaryEntrypoint: null }));
  else {
    checkoutList.append(...checkouts.slice(0, CHECKOUT_LIMIT).map(checkoutRow));
    if (checkouts.length > CHECKOUT_LIMIT) checkoutList.append(checkoutOverflow(checkouts.slice(CHECKOUT_LIMIT)));
  }
  node.querySelector("[data-slot=domains]").append(
    domainRow("Git", repository.domains.git, gitSummary(repository.domains.git)),
    domainRow("Plans", repository.domains.plans, plansSummary(repository.domains.plans)),
    domainRow("Tokens", repository.domains.tokens, tokensSummary(repository.domains.tokens)),
    domainRow("Agents", repository.domains.agents, "Unavailable"),
  );
  return node;
}

function checkoutRow(checkout) {
  const node = fill(tpl("tpl-checkout-row"), { name: checkout.name, git: gitState(checkout.git) });
  const slot = node.querySelector("[data-slot=entrypoint]");
  if (checkout.primaryEntrypoint) {
    const link = document.createElement("a");
    link.href = checkout.primaryEntrypoint.origin;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `:${checkout.primaryEntrypoint.port} ↗`;
    link.setAttribute("aria-label", `Open ${checkout.name} on port ${checkout.primaryEntrypoint.port}`);
    slot.replaceChildren(link);
  } else slot.textContent = "—";
  return node;
}

function checkoutOverflow(checkouts) {
  const node = fill(tpl("tpl-checkout-overflow"), { summary: `Show ${checkouts.length} more checkouts` });
  node.querySelector("[data-slot=rows]").append(...checkouts.map(checkoutRow));
  return node;
}

function domainRow(label, envelope, summary) {
  const node = fill(tpl("tpl-domain-row"), { label, status: envelope.status, summary });
  node.querySelector("[data-slot=status]").dataset.status = envelope.status;
  return node;
}

function repositoryMeta(repository) {
  const parts = [repository.kind === "git" ? "Git repository" : "Local repository"];
  if (repository.pinned) parts.push("Pinned");
  if (repository.confidence) parts.push(`${repository.confidence} confidence`);
  return parts.join(" · ");
}

function gitState(git) {
  if (!git) return "Git unavailable";
  const parts = [git.dirty === true ? "dirty" : git.dirty === false ? "clean" : "status unknown"];
  if (git.ahead) parts.push(`ahead ${git.ahead}`);
  if (git.behind) parts.push(`behind ${git.behind}`);
  return parts.join(" · ");
}

function gitSummary(envelope) {
  if (!envelope.data) return "Unavailable";
  return envelope.data.warnings.length ? `${envelope.data.warnings.length} warning${envelope.data.warnings.length === 1 ? "" : "s"}` : "No warnings";
}

function plansSummary(envelope) {
  const counts = envelope.data?.counts;
  return counts ? `${counts.active} active · ${counts.backlog} backlog` : "Coverage unavailable";
}

function tokensSummary(envelope) {
  const count = envelope.data?.warningCount;
  return count == null ? "Unavailable" : `${count} warning${count === 1 ? "" : "s"}`;
}
