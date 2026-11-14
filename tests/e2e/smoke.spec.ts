import { expect, test } from "@playwright/test";

const pages = ["/style-guide", "/design-lab", "/design-lab/home", "/design-lab/overview"];

for (const path of pages) {
  test(`${path} loads with no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(path);
    await page.waitForTimeout(1500);
    await expect(page.locator("body")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("style guide: the live controls work", async ({ page }) => {
  await page.goto("/style-guide");
  // Original | Explained
  const toggle = page.locator("#toggle");
  await toggle.getByRole("tab", { name: "Explained" }).click();
  await expect(toggle.getByRole("tab", { name: "Explained" })).toHaveAttribute("aria-selected", "true");
  // The workspace: collapse the list, then resize with the keyboard
  const ws = page.locator("#workspace");
  // At this width the list starts collapsed: show it, then hide it again.
  await ws.getByRole("button", { name: "Show the section list" }).click();
  await expect(ws.getByRole("navigation", { name: "Sections" })).toBeVisible();
  await ws.getByRole("button", { name: "Hide the section list" }).click();
  await expect(ws.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
  const chat = ws.getByRole("separator", { name: "Resize the chat" });
  const before = Number(await chat.getAttribute("aria-valuenow"));
  await chat.focus();
  await page.keyboard.press("ArrowLeft");
  expect(Number(await chat.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  // A citation switches the reading pane to Original
  await ws.getByRole("tab", { name: "Explained" }).click();
  await ws.getByRole("button", { name: /p\. 39/ }).first().click();
  await expect(ws.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true");
});

test("client navigation between pages does not error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/design-lab/home");
  await page.waitForTimeout(1500);
  await page.goto("/design-lab/overview");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Margin, back to your projects/ }).click();
  await page.waitForURL(/design-lab\/home/);
  expect(errors).toEqual([]);
});
