import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { makeProject, writeUps } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

async function ready(page: Page) {
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}
async function openFirstLayer(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await ready(page);
}

test("write a layer back: fixes, cleaned-up version and so what, then choose what goes to Note to Self", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);
  await openFirstLayer(page, id);

  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  const box = pane.getByRole("textbox", { name: "Write this layer in your own words" });
  await expect(pane.getByText("Not saved")).toBeVisible();
  await expect(pane.getByRole("button", { name: "Submit" })).toBeDisabled();
  await expect(pane.getByRole("button", { name: "Good enough" })).toHaveCount(0); // the good-enough loop is gone

  await box.fill("The layer opens with the first idea and builds on it.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(pane.getByText("Not yet")).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByRole("heading", { name: "Fixes" })).toBeVisible();
  await expect(pane.getByRole("heading", { name: "Your version, cleaned up" })).toBeVisible();
  await expect(pane.getByRole("heading", { name: "So what" })).toBeVisible();
  // the question sits inside the same reply, with three answers
  const ask = pane.getByRole("region", { name: "Send to Note to Self?" });
  await expect(ask.getByRole("button", { name: "Yes, my own writing" })).toBeVisible();
  await expect(ask.getByRole("button", { name: "Yes, refined version" })).toBeVisible();
  await expect(ask.getByRole("button", { name: "No" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "v2-writeback-review-1440.png") });
  // a review alone saves nothing
  await expect(page.getByRole("navigation", { name: "Layers" }).getByRole("img", { name: "Saved", exact: true })).toHaveCount(0);

  // a second try, sent as the student's own writing
  await expect(box).toHaveValue(/builds on it/);
  await box.fill("The layer opens with the first idea and builds on it, step by step.");
  await pane.getByRole("button", { name: "Submit" }).click();
  const asks = pane.getByRole("region", { name: "Send to Note to Self?" });
  await expect(asks).toHaveCount(2, { timeout: 15_000 });
  await asks.last().getByRole("button", { name: "Yes, my own writing" }).click();
  await expect(asks.last().getByText("In Note to Self: my own writing.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Layers" }).getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "v2-writeback-saved-1440.png") });

  // the history, and the answer, survive a reload
  await page.reload();
  await ready(page);
  await expect(pane.getByText("In Note to Self: my own writing.").first()).toBeVisible();

  // Note to Self has the sent text and not the first draft
  await page.goto(`/p/${id}/notes`);
  await expect.poll(async () => (await writeUps(page)).filter((w) => /step by step/.test(w.value)).length).toBe(1);
  await expect.poll(async () => (await writeUps(page)).filter((w) => /builds on it\.$/.test(w.value)).length).toBe(0);
  await expect(page.getByText("Name the term")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a newer answer replaces the saved version, 'refined' is labelled, 'No' keeps what was saved", async ({ page }) => {
  const id = await makeProject(page);
  await openFirstLayer(page, id);
  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  const box = pane.getByRole("textbox", { name: "Write this layer in your own words" });
  const asks = pane.getByRole("region", { name: "Send to Note to Self?" });

  await box.fill("My first honest try at the layer.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(asks).toHaveCount(1, { timeout: 15_000 });
  await asks.first().getByRole("button", { name: "Yes, my own writing" }).click();
  await expect(asks.first().getByText("In Note to Self: my own writing.")).toBeVisible();

  await box.fill("My second try, better.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(asks).toHaveCount(2, { timeout: 15_000 });
  await asks.last().getByRole("button", { name: "Yes, refined version" }).click();
  await expect(asks.last().getByText("In Note to Self: refined version.")).toBeVisible();
  await expect(asks.first().getByText("Replaced by a newer version in Note to Self.")).toBeVisible();

  await box.fill("A third try I do not want to keep.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(asks).toHaveCount(3, { timeout: 15_000 });
  await asks.last().getByRole("button", { name: "No" }).click();
  await expect(asks.last().getByText("Not sent to Note to Self.")).toBeVisible();
  await expect(asks.nth(1).getByText("In Note to Self: refined version.")).toBeVisible(); // still there

  await page.goto(`/p/${id}/notes`);
  const ups = async () => await writeUps(page);
  await expect.poll(async () => (await ups()).filter((w) => /My second try, better\./.test(w.value)).length).toBe(1);
  await expect.poll(async () => (await ups()).filter((w) => /My first honest try|third try/.test(w.value)).length).toBe(0);
  expect((await ups()).find((w) => /My second try, better\./.test(w.value))!.label).toContain("refined version");
});

test("I don't get it streams a simpler explanation and changes nothing; typing 'good enough' is just a write-back", async ({ page }) => {
  const id = await makeProject(page);
  await openFirstLayer(page, id);
  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  const box = pane.getByRole("textbox", { name: "Write this layer in your own words" });

  await pane.getByRole("button", { name: "I don’t get it" }).click();
  await expect(pane.getByText("Explained again, more simply")).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByText("This is a canned reply.")).toBeVisible();
  await expect(pane.getByText("Not saved")).toBeVisible();

  await box.fill("good enough");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(pane.getByRole("region", { name: "Send to Note to Self?" })).toHaveCount(1, { timeout: 15_000 }); // reviewed like any other text
  await expect(pane.getByText("Saved to Note to Self as Good enough.")).toHaveCount(0);
});
