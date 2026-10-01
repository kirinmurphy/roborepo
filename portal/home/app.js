import { portalHideLoading, portalSetUpdatedAt } from "/portal/shared/api.js";
import { loadHomeOverview } from "./api.js";
import { emptyState, repositoryDirectory, unresolvedActivity } from "./templates.js";

const POLL_MS = 10_000;
const content = document.getElementById("home-content");
const warning = document.getElementById("home-warning");
let renderedVersion = null;
let pending = false;

async function refresh() {
  if (pending) return;
  pending = true;
  try {
    const overview = await loadHomeOverview();
    const version = JSON.stringify(overview);
    const hasActiveControl = content.contains(document.activeElement) || content.querySelector("details[open]");
    if (version !== renderedVersion && !hasActiveControl) {
      const body = overview.repositories.length ? repositoryDirectory(overview.repositories) : emptyState();
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
