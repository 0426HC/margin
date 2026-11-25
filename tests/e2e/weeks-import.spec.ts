import { expect, test, type Page } from "@playwright/test";
import { courseFolder, dbAll } from "./helpers";

// A way out of the import: every step (reading files, sorting into weeks, drafting the plan, the plan review) has Cancel and a back
// link, Esc works as back, and a half-finished draft waits on Your projects with Continue setup and Discard. Fake engine, throwaway data.

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = undefined;
  });
});

const projectNamed = (name: string) => dbAll<{ id: string; status: string }>("select id, status from projects where name = ?", name);

/** Hold every request to `pattern` until the test lets go, so a step can be cancelled while it is still running. */
async function hold(page: Page, pattern: string) {
  const waiting: (() => void)[] = [];
  await page.route(pattern, async (route) => {
    await new Promise<void>((resolve) => waiting.push(resolve));
    await route.continue().catch(() => {}); // the page may have aborted it meanwhile
  });
  return async () => {
    waiting.splice(0).forEach((go) => go());
    await page.unroute(pattern).catch(() => {}); // the test may already be over
  };
}

async function startImport(page: Page, name: string) {
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Project name").fill(name);
  await page.getByTestId("folder-input").setInputFiles(courseFolder());
}

test("Esc on New project goes back to Your projects; the back link is there before anything starts", async ({ page }) => {
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Back to Your projects", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0); // nothing to cancel yet
  await page.getByLabel("Project name").focus();
  await page.keyboard.press("Escape"); // typing: Esc belongs to the field
  await expect(page).toHaveURL(/\/new$/);
  await page.locator("h1").click();
  await page.keyboard.press("Escape");
  await page.waitForURL((u) => u.pathname === "/");
});

test("Cancel while the files are being read stops the reading and discards the draft", async ({ page }) => {
  const release = await hold(page, "**/api/projects/*/files");
  await startImport(page, "Cancel while reading");
  await expect(page.getByRole("status")).toHaveText(/0 of \d+ read/);
  await page.getByRole("button", { name: "Cancel" }).click();
  const dialog = page.getByRole("dialog", { name: "Discard “Cancel while reading”?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await release();
  await expect.poll(() => projectNamed("Cancel while reading").length).toBe(0);
});

test("Cancel while sorting into weeks, kept as a draft: the home page shows it, Continue setup picks it up, Discard removes it", async ({ page }) => {
  const release = await hold(page, "**/api/projects/*/analyze");
  await startImport(page, "Kept draft");
  await expect(page.getByRole("status")).toContainText("read", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Sorting into weeks" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Keep as draft" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await release();

  const card = page.locator(".ho-tile", { hasText: "Kept draft" });
  await expect(card.getByText("Draft · not finished")).toBeVisible();
  await card.getByRole("button", { name: "Continue setup" }).click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  await expect(page.getByRole("heading", { name: "Your course plan" })).toBeVisible();

  await page.goto("/");
  await page.locator(".ho-tile", { hasText: "Kept draft" }).getByRole("button", { name: "Discard" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard draft" }).click();
  await expect(page.locator(".ho-tile", { hasText: "Kept draft" })).toHaveCount(0);
  expect(projectNamed("Kept draft")).toEqual([]);
});

test("Cancel while the plan is being drafted stops it, and Esc on the plan review goes back with the draft kept", async ({ page }) => {
  const release = await hold(page, "**/structure/propose");
  await startImport(page, "Cancel while planning");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  await expect(page.getByRole("status").filter({ hasText: "proposing" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard draft" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await release();
  await expect.poll(() => projectNamed("Cancel while planning").length).toBe(0);

  // the plan review: Esc is back, and the draft stays
  await startImport(page, "Esc on the plan");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  await expect(page.getByRole("button", { name: "Looks good" }).first()).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("heading", { name: "Your course plan" }).click();
  await page.keyboard.press("Escape");
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.locator(".ho-tile", { hasText: "Esc on the plan" }).getByText("Draft · not finished")).toBeVisible();
  const [row] = projectNamed("Esc on the plan");
  await page.request.delete(`/api/projects/${row.id}`);
});
