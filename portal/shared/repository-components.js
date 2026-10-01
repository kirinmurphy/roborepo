// Shared repository/workspace primitives. The pages own their surrounding markup and unique
// slots, while this module keeps the repeated identity and action affordances consistent.

export function repositoryPageUrl(repository) {
  return repository?.urlKey ? `/repositories/${encodeURIComponent(repository.urlKey)}` : null;
}

export function configureRepositoryName(node, { name, href }) {
  const slot = node.querySelector("[data-slot=repository-name]");
  if (!slot) return;
  if (href) {
    slot.href = href;
    slot.textContent = name || "Repository";
  } else {
    const heading = slot.parentElement;
    slot.remove();
    heading.textContent = name || "Repository";
  }
}

export function configureProviderLink(node, providerUrl, label = "GitHub") {
  const link = node.querySelector("[data-slot=provider-link]");
  if (!link) return;
  if (!providerUrl) {
    link.remove();
    return;
  }
  link.hidden = false;
  link.href = providerUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  const labelSlot = link.querySelector("[data-slot=provider-link-label]");
  if (labelSlot) labelSlot.textContent = label;
  else link.textContent = label;
}

// A menu is only a useful control when it has at least one visible item. Both Home and Runtime
// use this builder, so a page-specific menu can be composed from links and callbacks without
// leaving behind an empty three-dot trigger.
export function mountActionMenu(host, items, { onToggle, onSelect, ariaLabel = "Actions" } = {}) {
  if (!host) return null;
  host.replaceChildren();
  const usable = (items || []).filter((item) => !item.hidden);
  if (!usable.length) return null;

  const menu = document.createElement("div");
  menu.className = "action-menu";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "menu-trigger";
  trigger.dataset.action = "menu";
  trigger.setAttribute("aria-label", ariaLabel);
  trigger.setAttribute("aria-expanded", "false");
  trigger.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));

  const panel = document.createElement("div");
  panel.className = "menu-panel";
  panel.dataset.menu = "";
  panel.hidden = true;
  for (const item of usable) {
    const control = item.href ? document.createElement("a") : document.createElement("button");
    if (!item.href) control.type = "button";
    control.textContent = item.label;
    control.dataset.action = item.key;
    if (item.href) {
      control.href = item.href;
      if (item.external) {
        control.target = "_blank";
        control.rel = "noreferrer";
      }
    }
    control.addEventListener("click", (event) => {
      if (!item.href) event.preventDefault();
      event.stopPropagation();
      onSelect?.(item.key, item, event);
    });
    panel.append(control);
  }
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle?.(host.closest(".instance-card, .repository-card") || host);
  });
  panel.addEventListener("click", (event) => event.stopPropagation());
  menu.append(trigger, panel);
  host.append(menu);
  return menu;
}

export function configureLinksTrigger(button) {
  if (!button) return;
  button.icon = "link";
  button.label = "";
  button.setAttribute("aria-label", "Links");
  button.title = "Links";
}

// Row-level composition boundary shared by Home and Runtime. The host templates provide their own
// page-specific body slots; this function owns the repository identity, provider link, and optional
// action menu that every repository row presents the same way.
export function mountRepositoryRow(node, { name, href, providerUrl, providerLabel, menuItems, onToggleMenu, onSelectMenu, slots = {} }) {
  configureRepositoryName(node, { name, href });
  configureProviderLink(node, providerUrl, providerLabel || "GitHub");
  mountActionMenu(node.querySelector("[data-slot=repository-menu]"), menuItems, {
    onToggle: onToggleMenu,
    onSelect: onSelectMenu,
  });
  slots.header?.(node);
  slots.body?.(node);
  return node;
}

// Checkout/worktree rows have a richer Runtime body than Home, so their unique content stays in
// slots. The shared part still enforces the global identity behavior: the visible branch/worktree
// name is the tooltip trigger and the decorative info icon is never required.
export function mountCheckoutRow(node, { name = null, slots = {} } = {}) {
  const label = node.querySelector("[data-slot=name], [data-slot=root-branch]");
  if (name != null && label) label.textContent = name;
  const trigger = node.querySelector("[data-slot=root-info]") || node.querySelector(".checkout-name-trigger");
  trigger?.querySelector("portal-info-icon")?.remove();
  if (trigger && name) trigger.title = name;
  slots.identity?.(node, trigger);
  slots.actions?.(node);
  slots.body?.(node);
  return node;
}
