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
    await expect(page.locator(".repository-card")).toHaveCount(1);
    await expect(page.locator(".repository-card")).toContainText("RoboRepo");
    await expect(page.locator(".repository-card")).toContainText("Coverage unavailable");
    await expect(page.locator("body")).not.toContainText("/private/");
  });

  test("repository cards link to a bookmarkable detail page and browser history returns Home", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /View repository/ }).click();
    await expect(page).toHaveURL(/\/repositories\/roborepo$/);
    await expect(page.getByRole("heading", { level: 1, name: "RoboRepo", exact: true })).toBeVisible();
    await expect(page.locator("#nav a.active")).toHaveText("Home");
    await expect(page.getByRole("navigation", { name: "Repository domains" }).getByRole("link")).toHaveCount(4);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".repository-card")).toHaveCount(1);
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
    const card = await page.locator(".repository-card").boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(420);
  });

  test("theme toggling persists across repository navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("link", { name: /View repository/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".detail-section").first()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("navigation and repository actions have visible keyboard focus", async ({ page }) => {
    await page.goto("/");
    for (const expected of NAV_ORDER) {
      await page.keyboard.press("Tab");
      const focused = await focusSummary(page);
      expect(focused.text).toBe(expected);
      expect(focused.visible).toBe(true);
    }
    await page.keyboard.press("Tab");
    const detailLink = await focusSummary(page);
    expect(detailLink.text).toContain("View repository");
    expect(detailLink.visible).toBe(true);
  });
});

function focusSummary(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return {
      text: (element.textContent || "").trim(),
      visible: element.matches(":focus-visible") && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
    };
  });
}
