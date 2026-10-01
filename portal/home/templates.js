import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";
import { mountRepositoryRow, repositoryPageUrl } from "/portal/shared/repository-components.js";
import { appendRepositoryDomains } from "./domains.js";
import { buildRootSection } from "/portal/developer-runtime/repository-root-row.js";

export function emptyState() {
  return fill(tpl("tpl-home-empty"), {
    title: "No repositories yet",
    body: "Start a local project, then open Runtime so RoboRepo can discover its checkouts and running application.",
  });
}

export function repositoryDirectory(repositories, actions) {
  const node = tpl("tpl-repository-directory");
  node.append(...repositories.map((repository) => repositoryCard(repository, actions)));
  return node;
}

export function unresolvedActivity(items) {
  const node = tpl("tpl-unresolved-activity");
  return fill(node, { summary: `${items.length} running ${items.length === 1 ? "workspace needs" : "workspaces need"} a repository association.` });
}

function repositoryCard(repository, actions) {
  const node = fill(tpl("tpl-repository-card"), {
  });
  mountRepositoryRow(node, {
    name: repository.displayName,
    href: repositoryPageUrl(repository),
    providerUrl: repository.providerUrl,
    menuItems: homeMenuItems(repository),
    onToggleMenu: actions.onToggleMenu,
    onSelectMenu: (key, item, event) => actions.onSelectMenu(key, repository, item, event),
  });
  const lifecycleState = repository.lifecycle?.state || "active";
  if (lifecycleState !== "active") {
    node.classList.add("is-not-running");
    const badge = node.querySelector("[data-slot=lifecycle-state]");
    badge.hidden = false;
    badge.textContent = lifecycleState;
    badge.classList.add(`is-${lifecycleState}`);
    if (repository.lifecycle?.reason) badge.title = repository.lifecycle.reason;
  }
  const checkouts = repository.domains.runtime.data?.checkouts || [];
  const checkoutList = node.querySelector("[data-slot=checkouts]");
  if (checkouts.length === 0) checkoutList.append(noCheckoutRow());
  else checkoutList.append(...checkouts.map((checkout) => checkoutRow(checkout, actions)));
  appendRepositoryDomains(node.querySelector("[data-slot=domains]"), repository.domains);
  return node;
}

function checkoutRow(checkout, actions) {
  return buildRootSection({
    root: {
      rootId: checkout.rootId,
      isWorktree: checkout.isWorktree,
      projectRoot: checkout.projectRoot,
      checkoutState: checkout.checkoutState,
      checkoutReason: checkout.checkoutReason,
      git: checkout.git,
      primaryEntrypoint: checkout.primaryEntrypoint,
      members: [],
      composeGroups: [],
    },
    repository: { name: "Repository" },
    mode: "home",
    onMountLinks: actions.onMountLinks,
  });
}

function noCheckoutRow() {
  const row = document.createElement("div");
  row.className = "repository-root repository-root-empty";
  row.textContent = "No known checkout";
  return row;
}

function homeMenuItems(repository) {
  const checkouts = repository.domains.runtime.data?.checkouts || [];
  const knownCheckout = checkouts.length > 0;
  return [
    { key: "agents", label: "Agents", href: "/config" },
    { key: knownCheckout ? "hide" : "forget", label: knownCheckout ? "Hide" : "Forget This Repo" },
    { key: "pin", label: repository.pinned ? "Unpin" : "Pin" },
  ];
}
