import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { makeProject } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

async function openFirstLayer(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("Let's talk!: ask about the files, get a cited answer, open the citation, history survives a reload and another layer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);
  await openFirstLayer(page, id);

  // the left footer opens it in the right pane; the layer's write-back is kept
  await page.getByRole("navigation", { name: "Layers" }).locator("..").getByRole("button", { name: "Let’s talk!" }).click();
  const talk = page.getByRole("complementary", { name: "Let's talk!" });
  await expect(talk).toBeVisible();
  await expect(talk.getByText(/Ask a question about any reading/)).toBeVisible();
  await expect(talk.getByRole("button", { name: "Ask" })).toBeDisabled();

  await talk.getByRole("textbox", { name: "Ask your professor" }).fill("What do the readings say about faction?");
  await talk.getByRole("button", { name: "Ask" }).click();
  await expect(talk.getByText("Here is what your files say")).toBeVisible({ timeout: 15_000 });
  await expect(talk.getByText("Your professor", { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5-talk-1440.png") });

  // a citation opens the original, with the cited passage marked
  await talk.locator(".m-cite-inline").first().click();
  await expect(page.getByRole("dialog").locator("mark").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // the conversation is saved for the project: it is still there after a reload and on another layer, and the layer chat is untouched
  await page.reload();
  await page.getByRole("tab", { name: "Let’s talk!" }).click();
  await expect(talk.getByText("What do the readings say about faction?")).toBeVisible();
  await page.getByRole("tab", { name: "Write it back" }).click();
  await expect(page.getByRole("complementary", { name: "Write this layer back" }).getByText("What do the readings say about faction?")).toHaveCount(0);
  await page.getByRole("tab", { name: "Let’s talk!" }).click();
  const here = page.url();
  await page.getByRole("navigation", { name: "Layers" }).getByRole("link").nth(1).click();
  await expect(page).not.toHaveURL(here);
  // the tab stays on Let's talk! while you move between layers
  await expect(page.getByRole("tab", { name: "Let’s talk!", selected: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Let's talk!" }).getByText("What do the readings say about faction?")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Let's talk! is also in a week synthesis", async ({ page }) => {
  const id = await makeProject(page);
  await page.goto(`/p/${id}/week/1/synthesis`);
  await page.getByRole("tab", { name: "Let’s talk!" }).click();
  const talk = page.getByRole("complementary", { name: "Let's talk!" });
  await talk.getByRole("textbox", { name: "Ask your professor" }).fill("faction");
  await talk.getByRole("textbox", { name: "Ask your professor" }).press("Enter");
  await expect(talk.getByText(/Here is what your files say|Your files don't cover that/)).toBeVisible({ timeout: 15_000 });
});
