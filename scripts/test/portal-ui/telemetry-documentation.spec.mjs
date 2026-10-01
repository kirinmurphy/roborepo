import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { documentationScenario } from "../fixtures/telemetry-conditions-documentation.mjs";

const destination = process.env.TELEMETRY_DOC_SCREENSHOTS;
test.use({ locale: "en-US", timezoneId: "UTC", viewport: { width: 1440, height: 1050 } });
for (const theme of ["light", "dark"]) {
  test(`documentation screenshots: ${theme}`, async ({ page, request }) => {
    test.skip(!destination, "Set TELEMETRY_DOC_SCREENSHOTS to regenerate documentation images");
    fs.mkdirSync(destination, { recursive: true });
    const { report } = documentationScenario();
    const config = await (await request.get("/api/config")).json();
    config.telemetry = { ...config.telemetry, enabled: true };
    config.machineHarnesses = [{ id: "claude", enabled: true, confidence: "confirmed" }];
    await page.route("**/api/config", (route) => route.fulfill({ json: config }));
    await page.route("**/api/data", (route) => route.fulfill({ json: report }));
    // This fixture never writes a marker or uses personal telemetry.
    await page.route("**/api/telemetry/markers", (route) => route.abort());
    await page.addInitScript((value) => localStorage.setItem("portal-theme", value), theme);
    await page.goto("/tokens");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("#condition-report")).toBeVisible();
    // Sticky section heads and the portal header would paint over the top of an element screenshot.
    await page.addStyleTag({ content: ".t2-sec-head, .portal-header { position: static !important; margin-top: 0 !important; }" });
    const capture = async (locator, name) => {
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: path.join(destination, `${name}-${theme}.png`), animations: "disabled" });
    };
    await expect(page.locator("#condition-cards")).toContainText("67%");
    await capture(page.locator("#condition-report"), "conditions");
    const packageCard = page.locator(".condition-card").filter({ has: page.getByRole("heading", { name: "Configured packages", exact: true }) });
    await packageCard.locator("[data-condition-open]").click();
    const detail = packageCard.locator("[data-condition-dialog]");
    await expect(detail).toContainText("with 3/12 (25%)");
    await expect(detail).toContainText("without 9/12 (75%)");
    await expect(detail).toContainText("2 unknown");
    await capture(detail, "comparison-detail");
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    // model-metrics-*.png is not regenerated: the Tokens page no longer renders that panel, so the
    // existing images are stale until the panel is restored or its guide section is removed.
    await expect(page.locator("#condition-ledger")).toContainText("sample-project");
    await page.setViewportSize({ width: 1440, height: 2600 });
    await capture(page.locator("#condition-ledger-section"), "event-ledger");
    await page.setViewportSize({ width: 1440, height: 1050 });
    await capture(page.locator("#condition-changes-section"), "recorded-change");
    await page.locator("#condition-mark-change").click();
    const form = page.locator("#condition-change-form");
    await form.locator('[name="title"]').fill("Prefer section-level document reads");
    await form.locator('[name="intent"]').selectOption("suspected");
    await form.locator('[name="effective_at"]').fill("2026-09-04T03:00");
    await form.getByRole("heading", { name: "Mark a change" }).click();
    await capture(page.locator("#condition-change-dialog"), "mark-change");
  });
}


test("Tokens user guide serves its screenshots inside the portal", async ({ page, request }) => {
  const guide = await (await request.get("/api/telemetry/guide")).json();
  expect(guide.ok).toBe(true);
  expect(guide.title).toBe("Tokens page user guide");
  const images = [...guide.html.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);
  expect(images).toHaveLength(5);
  for (const image of images) {
    expect(image).toMatch(/^\/docs\/images\/tokens\//);
    const response = await request.get(image);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  await page.goto("/tokens");
  await page.locator('portal-info-icon[data-doc-anchor="testing-efficiency"]').click();
  const dialog = page.locator("#tokensdocmodal");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#testing-efficiency")).toBeVisible();
  const image = dialog.locator("img").first();
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
});
