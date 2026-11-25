import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { e2eDataDir, layerIdsOf, seedProject } from "./helpers";

/**
 * Writing a layer is honest about what it is doing: the steps in plain words until its first words arrive, and when the AI fails, hits the
 * plan's usage limit or goes quiet for too long, a clear message and Try again, never a spinner with no end. The fake engine fails on
 * purpose for a layer whose title says "(fake: usage limit)", "(fake: error)" or "(fake: hang)"; the e2e server stops after
 * MARGIN_LAYER_IDLE_S quiet seconds.
 */

const retitle = (id: string, title: string) => {
  const db = new Database(path.join(e2eDataDir(), "margin.db"));
  try {
    db.prepare("update layers set title = ? where id = ?").run(title, id);
  } finally {
    db.close();
  }
};

async function layerToFail(page: Page, request: import("@playwright/test").APIRequestContext, how: string) {
  const id = await seedProject(request, `Failing ${how}`);
  const [layer] = await layerIdsOf(page, id);
  retitle(layer, `Federalist 10 (fake: ${how})`);
  return { id, layer };
}

test("the usage limit: what happened, when it resets, and Try again, which works once the limit has lifted", async ({ page, request }) => {
  const { id, layer } = await layerToFail(page, request, "usage limit");
  await page.goto(`/p/${id}/l/${layer}`);
  const alert = page.getByRole("alert").filter({ hasText: "usage limit" });
  await expect(alert).toContainText(/Your Claude plan's usage limit has been reached\. It resets at .+\. Wait for it to reset, then try again\./);
  await expect(page.getByText("Writing this layer")).toHaveCount(0); // stopped waiting: no progress left on screen
  retitle(layer, "Federalist 10");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alert").filter({ hasText: "usage limit" })).toHaveCount(0);
});

test("an AI error says so plainly, in the error colour, with Try again", async ({ page, request }) => {
  const { id, layer } = await layerToFail(page, request, "error");
  await page.goto(`/p/${id}/l/${layer}`);
  const alert = page.getByRole("alert").filter({ hasText: "Claude stopped with an error" });
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  // coral/brick is only for errors: the message uses it
  const colour = await alert.locator(".m-progress-error").evaluate((el) => getComputedStyle(el).color);
  expect(colour).toBe("rgb(165, 49, 42)");
});

test("before its first words the steps show in plain words; when nothing new comes for its quiet limit it stops and says so", async ({ page, request }) => {
  const { id, layer } = await layerToFail(page, request, "hang");
  await page.goto(`/p/${id}/l/${layer}`);
  const status = page.getByRole("status").filter({ hasText: "Writing this layer" });
  await expect(status).toBeVisible();
  await expect(status.getByRole("listitem").filter({ hasText: "Choosing the passages from your files" })).toContainText("Done");
  await expect(status.getByRole("listitem").filter({ hasText: "Writing the explanation" })).toContainText("Working");
  await expect(status.getByRole("listitem").filter({ hasText: "Checking every citation" })).toContainText("Waiting");
  await expect(status).toContainText(/\d+ s so far\./);
  const alert = page.getByRole("alert").filter({ hasText: "stopped waiting" });
  await expect(alert).toContainText(/Nothing new came from Claude for \d+ seconds, so Margin stopped waiting\. Try again; anything already finished is kept\./, { timeout: 60_000 });
  await expect(alert).toContainText("Already finished and kept: the passages chosen from your files.");
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(status).toHaveCount(0);
});
