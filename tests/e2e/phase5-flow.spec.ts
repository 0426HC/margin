import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { writeUps } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

async function openDemo(page: Page) {
  await page.goto("/");
  await page.waitForTimeout(1500);
  const offer = page.getByRole("button", { name: "Open the demo course" });
  if (await offer.count()) await offer.click();
  else await page.getByRole("button", { name: /The Federalist Papers/ }).first().click();
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 15_000 });
  return page.url().match(/\/p\/([^/]+)$/)![1];
}

/** The whole Phase 5 study loop on the demo course with the fake engine, from reading to Note to Self and Let's talk!. */
test("full flow on the demo: read, check a citation, write back and send it, I don't get it, synthesis, Note to Self, Let's talk!", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await openDemo(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The Federalist Papers");

  // 1. open the first layer and read Explained (already written: no waiting)
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  const nav = page.getByRole("navigation", { name: "Layers" });
  const layerLinks = nav.getByRole("link").filter({ hasNotText: /synthesis/ });
  const firstLayer = page.url();

  // 2. check a citation against the original: the slide-over shows the page verbatim with the passage marked
  await page.locator(".m-cite").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("mark").first()).toBeVisible();
  await expect(sheet.getByText(/^(Page|Slide) \d+/)).toBeVisible();
  await page.keyboard.press("Escape");

  // 3. write it back: fixes, cleaned-up version, so what; then send the revision
  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  const box = pane.getByRole("textbox", { name: "Write this layer in your own words" });
  await box.fill("First rough draft of the idea.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(pane.getByText("Not yet")).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByRole("heading", { name: "Fixes" })).toBeVisible();
  await expect(pane.getByRole("heading", { name: "Your version, cleaned up" })).toBeVisible();
  await expect(pane.getByRole("heading", { name: "So what" })).toBeVisible();
  await box.fill("Revised version of the idea, step by step.");
  await pane.getByRole("button", { name: "Submit" }).click();
  const asks = pane.getByRole("region", { name: "Send to Note to Self?" });
  await expect(asks).toHaveCount(2, { timeout: 15_000 });
  await asks.last().getByRole("button", { name: "Yes, my own writing" }).click();
  await expect(asks.last().getByText("In Note to Self: my own writing.")).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Week 1 · .*\d+\/\d+$/ })).toContainText(/^Week 1 · .*1\/\d+$/); // progress: 1/N saved
  await expect(layerLinks.first().getByRole("img", { name: "Saved", exact: true })).toBeVisible();

  // 4. another layer: "I don't get it" typed as a message gets a simpler explanation and changes nothing; then send the refined version
  // a layer of week 2 (its group opens with a click; the week being read starts open)
  await nav.getByRole("button", { name: /^Week 2 · / }).click();
  const second = nav.locator('#week-2 a[href*="/l/"]').first();
  await second.click();
  await expect(page).not.toHaveURL(firstLayer);
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  const pane2 = page.getByRole("complementary", { name: "Write this layer back" });
  const box2 = pane2.getByRole("textbox", { name: "Write this layer in your own words" });
  await box2.fill("I don't get it");
  await pane2.getByRole("button", { name: "Submit" }).click();
  await expect(pane2.getByText("Explained again, more simply")).toBeVisible({ timeout: 15_000 });
  await expect(pane2.getByText("Not saved")).toBeVisible();
  await box2.fill("My second layer, written once and good enough.");
  await pane2.getByRole("button", { name: "Submit" }).click();
  await pane2.getByRole("button", { name: "Yes, refined version" }).click({ timeout: 15_000 });
  await expect(pane2.getByText("In Note to Self: refined version.")).toBeVisible();
  await expect(nav.locator('#week-2 a[href*="/l/"]').first().getByRole("img", { name: "Saved", exact: true })).toBeVisible();

  // 5. the week 1 synthesis (optional): written and sent
  await nav.getByRole("button", { name: /^Week 1 · / }).click(); // on a week 2 layer, week 1's group starts folded
  await nav.getByRole("link", { name: /^Week synthesis for week 1/ }).click();
  await page.waitForURL(/\/week\/1\/synthesis$/);
  const synth = page.getByRole("complementary", { name: "Write the synthesis" });
  await synth.getByRole("textbox", { name: "Tie this week together in your own words" }).fill("Week one in one piece: the case for one government.");
  await synth.getByRole("button", { name: "Submit" }).click();
  await expect(synth.getByText("Not yet")).toBeVisible({ timeout: 15_000 });
  await synth.getByRole("button", { name: "Yes, my own writing" }).click({ timeout: 15_000 });
  await expect(synth.getByText("In Note to Self: my own writing.")).toBeVisible();

  // 6. Note to Self: both layers and the synthesis, labelled, and none of the drafts or chat
  await page.goto(`/p/${id}/notes`);
  await expect.poll(() => writeUps(page)).toEqual([
    expect.objectContaining({ value: "Revised version of the idea, step by step.", label: expect.stringContaining("my own writing") }),
    // course order: week 1's layer, week 1's synthesis, then the week 2 layer
    expect.objectContaining({ value: expect.stringMatching(/Week one in one piece/), label: expect.stringContaining("synthesis") }),
    expect.objectContaining({ value: expect.stringMatching(/My second layer, written once and good enough\./), label: expect.stringContaining("refined version") }),
  ]);
  await expect(page.getByText("First rough draft of the idea.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^(Fixes|Your version, cleaned up)$/ })).toHaveCount(0); // no review feedback either

  // 7. Let's talk!: ask about a layer from anywhere; the answer cites a real file and the citation opens it
  await page.goto(firstLayer);
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 10_000 });
  const partB = await page.getByRole("navigation", { name: "Layers" }).getByRole("link").filter({ hasNotText: /synthesis/ }).last().innerText();
  await page.getByRole("tab", { name: "Let’s talk!" }).click();
  const talk = page.getByRole("complementary", { name: "Let's talk!" });
  await talk.getByRole("textbox", { name: "Ask your professor" }).fill(`Explain ${partB.replace(/^\S*\s*/, "")}`);
  await talk.getByRole("button", { name: "Ask" }).click();
  const cite = talk.locator(".m-cite-inline").first();
  await expect(cite).toBeVisible({ timeout: 15_000 });
  const file = (await cite.innerText()).replace(/^\[|, p\. \d+\]$/g, "");
  await cite.click();
  await expect(page.getByRole("dialog").getByRole("heading", { level: 2 })).toHaveText(file);
  await expect(page.getByRole("dialog").locator("mark").first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5-flow-talk-citation-1440.png") });
  expect(errors).toEqual([]);
});
