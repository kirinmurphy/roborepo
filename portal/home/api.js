import { portalGetJson } from "/portal/shared/api.js";

export function loadHomeOverview() {
  return portalGetJson("/api/home");
}
