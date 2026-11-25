import { expect, test } from "@playwright/test";
import { longReading } from "../fixtures/long-reading";
import { dbAll } from "./helpers";

// "12 of 18 layers ready" on the course page. The browser tests run with background writing off (playwright.config.ts), so the count only
// moves when a layer is opened; the queue itself is tested in tests/unit/background.test.ts. Made-up text, fake engine.

test("the course page says how many layers are ready, in normal mode and lock in", async ({ page, request }) => {
  const post = async (url: string, init?: Parameters<typeof request.post>[1]) => {
    const r = await request.post(url, init);
    if (!r.ok()) throw new Error(`${url}: ${r.status()} ${await r.text()}`);
    return r;
  };
  const { id } = (await (await post("/api/projects", { data: { name: "Ready count", courseCode: "BG101" } })).json()) as { id: string };
  for (const w of [1, 2])
    await post(`/api/projects/${id}/files`, { multipart: { file: { name: `Reading ${w}.txt`, mimeType: "text/plain", buffer: Buffer.from(longReading({ words: 3_000, seed: w })) }, relPath: `Week ${w}/Reading ${w}.txt` } });
  await post(`/api/projects/${id}/analyze`);
  await post(`/api/projects/${id}/finish`);
  await post(`/api/projects/${id}/structure/propose`);
  await post(`/api/projects/${id}/structure/approve`, { data: {} });
  const layers = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and l.proposed = 0 order by p.position, l.position", id);
  const total = layers.length;

  await page.goto(`/p/${id}`);
  // the brain hasn't read anything yet (background work is off in the browser tests): both lines show
  await expect(page.locator(".ov-bar-ready")).toContainText(`Margin has read 0 of 2 weeks · 0 of ${total} layers ready`, { useInnerText: true });
  const status = (await (await request.get(`/api/projects/${id}/writing`)).json()) as { ready: number; total: number; pausedUntil: string | null };
  expect(status).toMatchObject({ ready: 0, total, pausedUntil: null, brain: { weeksRead: 0, weeksTotal: 2, building: true } });

  // opening a layer writes it; the count follows
  await page.goto(`/p/${id}/l/${layers[0].id}`);
  await expect(page.getByRole("tab", { name: "Source" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => ((await (await request.get(`/api/projects/${id}/writing`)).json()) as { ready: number }).ready, { timeout: 20_000 }).toBe(1);
  await page.goto(`/p/${id}`);
  await expect(page.locator(".ov-bar-ready")).toContainText(`1 of ${total} layers ready`);

  await page.evaluate(() => localStorage.setItem("margin:mode", "lock-in"));
  await page.reload();
  await expect(page.locator(".ov-bar-ready").filter({ visible: true })).toContainText(`1 of ${total} layers ready`);
  await page.evaluate(() => localStorage.setItem("margin:mode", "normal"));
  // leave the home page as the other specs expect it
  expect((await request.delete(`/api/projects/${id}`)).ok()).toBe(true);
});
