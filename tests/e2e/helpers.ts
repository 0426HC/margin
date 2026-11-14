import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SAMPLE = path.join("demo", "sample-course", "POL101 Federalist Seminar");

export function courseFolder() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-e2e-")), "POL101 Federalist Seminar");
  fs.cpSync(SAMPLE, root, { recursive: true });
  return root;
}

/** Import the sample course, propose the layers with the fake engine, approve both Parts. Returns the project id. */
export async function makeProject(page: Page, { approve = true } = {}) {
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("folder-input").setInputFiles(courseFolder());
  await expect(page.getByRole("status")).toContainText("read", { timeout: 30_000 });
  await page.getByRole("button", { name: "Review units" }).click();
  await page.waitForURL(/\/p\/[^/]+\/import$/);
  const projectId = page.url().match(/\/p\/([^/]+)\//)![1];
  await page.getByRole("button", { name: "Plan the layers" }).first().click();
  await page.waitForURL(/\/setup$/);
  await page.getByRole("button", { name: "Suggest the layers" }).click();
  await expect(page.locator(".m-paper").getByRole("region", { name: "Part A" })).toBeVisible({ timeout: 30_000 });
  if (approve) {
    await page.getByRole("button", { name: "Approve the layers of Part A" }).click();
    await expect(page.locator(".m-paper").getByRole("region", { name: "Part A" }).getByText("Approved")).toBeVisible();
    await page.getByRole("button", { name: "Approve the layers of Part B" }).click();
    await expect(page.locator(".m-paper").getByRole("region", { name: "Part B" }).getByText("Approved")).toBeVisible();
  }
  return projectId;
}

/** A ready project made through the API with the fake engine: upload the sample course, check units, propose and approve both Parts. */
export async function seedProject(request: import("@playwright/test").APIRequestContext, name: string) {
  const post = async (url: string, init?: Parameters<typeof request.post>[1]) => {
    const r = await request.post(url, init);
    if (!r.ok()) throw new Error(`${url}: ${r.status()} ${await r.text()}`);
    return r;
  };
  const { id } = (await (await post("/api/projects", { data: { name } })).json()) as { id: string };
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(SAMPLE)) {
    await post(`/api/projects/${id}/files`, {
      multipart: { file: { name: path.basename(file), mimeType: "application/octet-stream", buffer: fs.readFileSync(file) }, relPath: path.relative(SAMPLE, file) },
    });
  }
  await post(`/api/projects/${id}/analyze`);
  await post(`/api/projects/${id}/finish`);
  await post(`/api/projects/${id}/structure/propose`);
  await post(`/api/projects/${id}/structure/approve`, { data: { part: "A" } });
  await post(`/api/projects/${id}/structure/approve`, { data: { part: "B" } });
  return id;
}

/** The project's layer ids in course order, read from the layer list on the Let's talk! screen. */
export async function layerIdsOf(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}/talk`);
  await page.locator('a[href*="/l/"]').first().waitFor();
  const ids = await page.locator('a[href*="/l/"]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href.split("/l/")[1]).filter(Boolean));
  return [...new Set(ids)];
}

/** Every saved write-up on the Note to Self book: the text in its box and the name it is announced with (which layer, which version). */
export const writeUps = (page: Page) =>
  page.locator(".nb-r .nb-text").evaluateAll((els) => els.map((e) => ({ label: e.getAttribute("aria-label") ?? "", value: (e as HTMLTextAreaElement).value })));
