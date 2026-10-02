import { portalConfig, portalHideLoading, portalSetUpdatedAt } from "/portal/shared/api.js";
import { loadRepositoryOverview } from "./api.js";
import { repositoryDetail, unavailableView } from "./templates.js";

const POLL_MS = 10_000;
const content = document.getElementById("repository-content");
const warning = document.getElementById("repository-warning");
const urlKey = portalConfig().routeParams?.urlKey;
let renderedVersion = null;
let pending = false;

async function refresh() {
  if (pending) return;
  pending = true;
  try {
    if (!urlKey) throw new Error("Repository key is missing from this route.");
    const overview = await loadRepositoryOverview(urlKey);
    const version = JSON.stringify(overview);
    if (version !== renderedVersion && !content.contains(document.activeElement)) {
      content.replaceChildren(repositoryDetail(overview.repository));
      renderedVersion = version;
    }
    warning.hidden = true;
    portalSetUpdatedAt(new Date(), { cadenceMs: POLL_MS });
    document.title = `${overview.repository.displayName} · roborepo`;
  } catch (error) {
    content.replaceChildren(unavailableView(`This repository is unavailable. It may be hidden, removed, or unknown. ${error.message}`));
    warning.textContent = "Repository detail could not be loaded.";
    warning.hidden = false;
  } finally {
    pending = false;
    portalHideLoading();
  }
}

await refresh();
setInterval(refresh, POLL_MS);
