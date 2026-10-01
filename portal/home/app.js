import { portalHideLoading, portalSetUpdatedAt } from "/portal/shared/api.js";
import * as api from "./api.js";
import { mountHomeLinks } from "./links.js";
import { emptyState, repositoryDirectory, unresolvedActivity } from "./templates.js";

const POLL_MS = 10_000;
const content = document.getElementById("home-content");
const warning = document.getElementById("home-warning");
let renderedVersion = null;
let pending = false;

const menuActions = {
  onMountLinks: (slot, entrypoint) => mountHomeLinks(slot, entrypoint, { onStale: refresh }),
  onToggleMenu: toggleActionMenu,
  onSelectMenu: selectRepositoryAction,
};

async function refresh() {
  if (pending) return;
  pending = true;
  try {
    const overview = await api.loadHomeOverview();
    const version = JSON.stringify(overview);
    const hasActiveControl = content.contains(document.activeElement) || content.querySelector("details[open], .menu-button-panel, [data-menu]:not([hidden])") || document.querySelector("dialog[open]");
    if (version !== renderedVersion && !hasActiveControl) {
      const body = overview.repositories.length ? repositoryDirectory(overview.repositories, menuActions) : emptyState();
      content.replaceChildren(body);
      if (overview.unresolvedActivity.length) content.append(unresolvedActivity(overview.unresolvedActivity));
      renderedVersion = version;
    }
    warning.hidden = true;
    portalSetUpdatedAt(overview.updatedAt);
  } catch (error) {
    warning.textContent = `Repository overview unavailable: ${error.message}`;
    warning.hidden = false;
    if (!content.hasChildNodes()) content.replaceChildren(emptyState());
  } finally {
    pending = false;
    portalHideLoading();
  }
}

await refresh();
setInterval(refresh, POLL_MS);

function toggleActionMenu(card) {
  const menu = card.querySelector("[data-menu]");
  const trigger = card.querySelector("[data-action=menu]");
  if (!menu || !trigger) return;
  const willOpen = menu.hidden;
  closeActionMenus();
  menu.hidden = !willOpen;
  trigger.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) card.classList.add("has-open-menu");
}

function closeActionMenus() {
  for (const menu of content.querySelectorAll("[data-menu]")) {
    menu.hidden = true;
    menu.closest(".repository-card")?.classList.remove("has-open-menu");
    menu.closest(".action-menu")?.querySelector("[data-action=menu]")?.setAttribute("aria-expanded", "false");
  }
}

async function selectRepositoryAction(key, repository, item, event) {
  if (item.href) {
    closeActionMenus();
    return;
  }
  closeActionMenus();
  try {
    if (key === "pin") await api.setRepositoryPinned({ repositoryId: repository.repositoryId, pinned: !repository.pinned });
    else if (key === "hide") await api.setRepositoryVisibility({ repositoryId: repository.repositoryId, hidden: true });
    else if (key === "forget") await api.forgetRepository({ repositoryId: repository.repositoryId });
    renderedVersion = null;
    await refresh();
  } catch (error) {
    warning.textContent = `Repository action unavailable: ${error.message}`;
    warning.hidden = false;
  }
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-menu")) closeActionMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeActionMenus();
});

for (const close of document.querySelectorAll("#api-route-dialog [data-close]")) {
  close.addEventListener("click", () => close.closest("dialog").close());
}
