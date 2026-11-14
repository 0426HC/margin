import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { layerIdsOf, seedProject } from "./helpers";

// Screenshots of every screen the study-loop v2 changed, at 1440 and 1024. Only runs with SHOTS=1 (npm run shots).
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;
test.skip(!SHOTS, "screenshots only");
test.describe.configure({ mode: "serial" });

const SIZES = [
  { w: 1440, h: 900 },
  { w: 1024, h: 768 },
] as const;

let id = "";
let layerIds: string[] = [];
test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Study Loop Course");
  const post = (url: string, data: unknown) => request.post(url, { data });
  const page = await browser.newPage();
  layerIds = await layerIdsOf(page, id);
  await page.close();
  const send = async (layer: string, text: string, choice: "own" | "refined" | "no") => {
    const r = await post(`/api/layers/${layer}/submit`, { text });
    const { thread } = (await r.json()) as { thread: { latestWritebackId: string } };
    await post(`/api/layers/${layer}/save`, { writebackId: thread.latestWritebackId, choice });
  };
  await send(layerIds[0], "The layer opens with the first idea and builds on it, step by step.", "own");
  await send(layerIds[1], "A second layer, in my own words, about how the idea develops.", "refined");
  await post(`/api/projects/${id}/talk`, { question: "What do the readings say about faction?" });
});

const shot = async (page: Page, name: string, size: { w: number; h: number }) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS!, `v2-${name}-${size.w}.png`) });
};

for (const size of SIZES) {
  test(`screens at ${size.w}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.w, height: size.h });

    // layer: a review with the save question, unanswered and answered
    await page.goto(`/p/${id}/l/${layerIds[size.w === 1440 ? 2 : 3]}`); // a fresh layer for each size
    await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    const pane = page.getByRole("complementary", { name: "Write this layer back" });
    await pane.getByRole("textbox", { name: "Write this layer in your own words" }).fill("The layer opens with the first idea and builds on it.");
    await pane.getByRole("button", { name: "Submit" }).click();
    await expect(pane.getByRole("region", { name: "Send to Note to Self?" })).toBeVisible({ timeout: 15_000 });
    await shot(page, "layer-review-save-question", size);
    await pane.getByRole("button", { name: "Yes, refined version" }).click();
    await expect(pane.getByText("In Note to Self: refined version.")).toBeVisible();
    await shot(page, "layer-review-saved", size);

    // the layer's Let's talk! tab, with the layer subtitle on a message
    await page.getByRole("tab", { name: "Let’s talk!" }).click();
    const side = page.getByRole("complementary", { name: "Let's talk!" });
    await side.getByRole("textbox", { name: "Ask your professor" }).fill("How does this layer connect to the one before?");
    await side.getByRole("button", { name: "Ask" }).click();
    await expect(side.locator(".m-msg-context").last()).toBeVisible({ timeout: 15_000 });
    await shot(page, "layer-talk-tab", size);

    // synthesis
    await page.goto(`/p/${id}/part/A/synthesis`);
    await page.waitForLoadState("networkidle");
    const synth = page.getByRole("complementary", { name: "Write the synthesis" });
    await synth.getByRole("textbox", { name: "Write the synthesis in your own words" }).fill("Part A builds one argument, layer by layer.");
    await synth.getByRole("button", { name: "Submit" }).click();
    await expect(synth.getByRole("region", { name: "Send to Note to Self?" }).last()).toBeVisible({ timeout: 15_000 });
    await shot(page, "synthesis-review-save-question", size);

    // the Let's talk! section: three tabs
    for (const tab of ["chat", "sources", "notepad"]) {
      await page.goto(`/p/${id}/talk?tab=${tab}`);
      await page.waitForLoadState("networkidle");
      if (tab === "sources") {
        await page.getByRole("button", { name: "Find sources now" }).click();
        await expect(page.locator(".m-tt-topic").first()).toBeVisible({ timeout: 20_000 });
      }
      if (tab === "notepad") {
        const pad = page.getByRole("textbox", { name: "Notepad" });
        if (!(await pad.innerText()).trim()) {
          await pad.click();
          await page.getByRole("button", { name: "Heading" }).click();
          await page.keyboard.type("Madison on faction");
          await page.keyboard.press("Enter");
          await page.getByRole("button", { name: "Bullets" }).click();
          await page.keyboard.type("a large republic dilutes faction");
          await page.keyboard.press("Enter");
          await page.keyboard.type("representatives refine opinion");
          await page.waitForTimeout(1200);
        }
      }
      await shot(page, `talk-${tab}`, size);
    }

    // the project overview: the Let's talk! scene, then Note to Self; the rail names all four
    await page.goto(`/p/${id}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1800);
    const scene = page.getByRole("region", { name: "Let’s talk!" });
    await scene.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1800);
    await shot(page, "overview-talk-scene", size);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1800);
    await shot(page, "overview-end", size);

    // Note to Self, and the home tile
    await page.goto(`/p/${id}/notes`);
    await page.waitForTimeout(3200);
    await shot(page, "notes", size);
    await page.goto("/");
    await page.waitForTimeout(2600);
    await shot(page, "home", size);
  });
}
