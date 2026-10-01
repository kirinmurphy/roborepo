import { test, expect } from "@playwright/test";

const NAV_ORDER = ["Home", "Agents", "Plans", "Tokens", "Runtime"];
const ROUTES = [
  { path: "/", active: "Home" },
  { path: "/config", active: "Agents" },
  { path: "/plans", active: "Plans" },
  { path: "/tokens", active: "Tokens" },
  { path: "/runtime", active: "Runtime" },
];

test.describe("repository-first portal Home", () => {
  test("Home renders the canonical repository directory", async ({ page }) => {
    const response = await page.goto("/");
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Repositories" })).toBeVisible();
    const card = roboRepoCard(page);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("RoboRepo");
    await expect(card).not.toContainText("Coverage unavailable");
    await expect(card.locator(".repository-state-badge")).toHaveText("idle");
    await expect(page.locator("body")).not.toContainText("/private/");
  });

  test("empty Plans and Tokens sections are hidden", async ({ page }) => {
    await page.goto("/");
    const card = roboRepoCard(page);
    await expect(card.locator(".home-domain-row")).toHaveCount(0);
    await expect(card.getByRole("link", { name: "view all plans" })).toHaveCount(0);
    await expect(card).not.toContainText("No active plans");
    await expect(card).not.toContainText("Token Warnings");
  });

  test("Home shows inline plan counts, progress and every token warning", async ({ page }) => {
    await homeFixture(page);
    await page.goto("/");
    const card = roboRepoCard(page);
    await expect(card.getByRole("heading", { name: "Plans", exact: true })).toBeVisible();
    await expect(card).toContainText("2 Active · 22 Backlog");
    await expect(card.getByRole("link", { name: "view all plans" })).toHaveAttribute("href", "/plans");
    await expect(card.getByRole("progressbar", { name: "First plan completion" })).toHaveAttribute("aria-valuenow", "25");
    await expect(card.getByRole("link", { name: "First plan" })).toContainText("25%");
    await expect(card.getByRole("link", { name: "Untracked plan" })).toContainText("—");
    await expect(card.getByRole("heading", { name: "Token Warnings" })).toBeVisible();
    await expect(card).toContainText("8 warnings");
    await expect(card.getByRole("list", { name: "Token warnings" }).getByRole("listitem")).toHaveCount(8);
    await expect(card.getByRole("link", { name: "view all activity" })).toHaveAttribute("href", "/tokens");
    await expect(card.locator(".status-dot")).toHaveCount(0);
  });

  test("Home Links renders its glyph, discovers routes and closes with Escape", async ({ page }) => {
    await homeFixture(page);
    await page.route("**/api/developer-runtime/metadata?*", (route) => route.fulfill({ json: { suggestions: [
      { kind: "page", source: "sitemap", path: "/docs" },
      { kind: "api", source: "openapi", method: "GET", path: "/api/example" },
    ] } }));
    await page.goto("/");
    const card = roboRepoCard(page);
    const links = card.getByRole("button", { name: "Links", exact: true });
    await expect(links.locator("portal-icon[name=link] svg")).toBeVisible();
    await expect(card.locator(".checkout-control-cell")).toHaveCount(0);
    await links.click();
    await expect(card.getByRole("link", { name: /\/docs/ })).toHaveAttribute("href", "http://127.0.0.1:4317/docs");
    await page.keyboard.press("Escape");
    await expect(links).toHaveAttribute("aria-expanded", "false");
    await links.click();
    await card.getByRole("button", { name: /GET.*api\/example/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("repository cards link to a bookmarkable detail page and browser history returns Home", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "RoboRepo", exact: true }).click();
    await expect(page).toHaveURL(/\/repositories\/roborepo$/);
    await expect(page.getByRole("heading", { level: 1, name: "RoboRepo", exact: true })).toBeVisible();
    await expect(page.locator("#nav a.active")).toHaveText("Home");
    await expect(page.getByRole("navigation", { name: "Repository domains" }).getByRole("link")).toHaveCount(4);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(roboRepoCard(page)).toHaveCount(1);
  });

  test("unknown repository keys keep the detail shell and render an explicit unavailable state", async ({ page }) => {
    const response = await page.goto("/repositories/not-a-repository");
    expect(response.status()).toBe(200);
    await expect(page.locator("#nav a.active")).toHaveText("Home");
    await expect(page.locator("#repository-content")).toContainText("This repository is unavailable");
    await expect(page.locator("#repository-warning")).toBeVisible();
  });

  test("global navigation remains the static five-item manifest", async ({ page }) => {
    await page.goto("/");
    const labels = await page.locator("#nav a").allTextContents();
    expect(labels.map((label) => label.trim())).toEqual(NAV_ORDER);
    for (const { path, active } of ROUTES) {
      const response = await page.goto(path);
      expect(response.status()).toBe(200);
      await expect(page.locator("#nav a.active")).toHaveText(active);
      await expect(page.locator("#nav a.active")).toHaveCount(1);
    }
  });

  test("the content column stays centered and the card responds at mobile width", async ({ page }) => {
    await page.goto("/");
    const desktop = await page.locator("main.inner").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { maxWidth: getComputedStyle(element).maxWidth, left: rect.left, right: innerWidth - rect.right };
    });
    expect(desktop.maxWidth).toBe("1024px");
    expect(Math.abs(desktop.left - desktop.right)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 420, height: 780 });
    const card = await roboRepoCard(page).boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(420);
  });

  test("theme toggling persists across repository navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("link", { name: "RoboRepo", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".detail-section").first()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("navigation and repository actions have visible keyboard focus", async ({ page }) => {
    await page.goto("/");
    await expect(roboRepoCard(page)).toBeVisible();
    for (const expected of NAV_ORDER) {
      await page.keyboard.press("Tab");
      const focused = await focusSummary(page);
      expect(focused.text).toBe(expected);
      expect(focused.visible).toBe(true);
    }
    await page.keyboard.press("Tab");
    const detailLink = await focusSummary(page);
    expect(detailLink.href?.match(/\/repositories\//) || detailLink.ariaLabel === "Actions").toBeTruthy();
    expect(detailLink.visible).toBe(true);
  });

  test("repository row exposes the configured Home actions", async ({ page }) => {
    await page.goto("/");
    await roboRepoCard(page).getByRole("button", { name: "Actions" }).click();
    await expect(page.locator("#home-content").getByRole("link", { name: "Agents", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Forget This Repo", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
  });
});

function focusSummary(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return {
      text: (element.textContent || "").trim(),
      href: element.getAttribute("href"),
      ariaLabel: element.getAttribute("aria-label"),
      visible: element.matches(":focus-visible") && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
    };
  });
}

function roboRepoCard(page) {
  return page.locator(".repository-card").filter({ has: page.getByRole("heading", { name: "RoboRepo", exact: true }) }).first();
}

async function homeFixture(page) {
  await page.route("**/api/home", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const repository = data.repositories.find((item) => item.displayName === "RoboRepo");
    repository.domains.plans = { status: "available", data: {
      counts: { active: 2, backlog: 22 },
      active: [
        { id: "first", title: "First plan", taskCounts: { total: 4, complete: 1 } },
        { id: "untracked", title: "Untracked plan", taskCounts: { total: 0, complete: 0 } },
      ],
    } };
    repository.domains.tokens = { status: "available", data: {
      warningCount: 8,
      warnings: Array.from({ length: 8 }, (_, index) => ({ kind: "spike", severity: "high", sessionId: `session-${index}`, harness: "codex" })),
    } };
    repository.domains.runtime = { status: "available", data: { checkouts: [{
      rootId: "main", name: "main", git: { branch: "main", provider: { ok: true } },
      primaryEntrypoint: { kind: "listener", opaqueKey: "fixture", origin: "http://127.0.0.1:4317", port: 4317, links: [] },
    }] } };
    await route.fulfill({ json: data });
  });
}
