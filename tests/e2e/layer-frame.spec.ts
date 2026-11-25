import { expect, test } from "@playwright/test";

/**
 * Opening a layer never shows a blank screen: the workspace's frame (panes, title, big question, tabs, write-back pane) shows the moment
 * it is opened and the layer fills it when it arrives. The layer's own answer from the server is held back here, so the frame can be seen.
 */
for (const mode of ["normal", "lock-in"] as const) {
  test(`opening a layer shows its frame at once and fills it in, ${mode}`, async ({ page, request }) => {
    const { id } = (await (await request.post("/api/demo")).json()) as { id: string };
    await page.addInitScript((m) => localStorage.setItem("margin:mode", m), mode);
    await page.goto(`/p/${id}/talk`); // a tab with the layer list's links one step away
    await page.goto(`/p/${id}`);
    await page.waitForLoadState("networkidle");
    // open the first layer and wait for it, so the next layer is opened from inside the workspace
    if (mode === "normal") {
      await page.evaluate(() => {
        const s = document.querySelector<HTMLElement>(".ov-scene")!;
        window.scrollTo(0, s.offsetTop + s.offsetHeight - innerHeight);
      });
      await page.waitForTimeout(600);
      await page.locator(".ov-label").first().click();
    } else await page.locator(".lk-ov a[href*='/l/']").first().click();
    await expect(page.locator(".m-reading-pane:not([aria-busy]) .m-body:visible")).toBeVisible({ timeout: 15_000 });

    const next = page.locator(".m-left a[href*='/l/']").nth(1);
    const title = (await next.locator(".m-sec-title").textContent())?.trim() ?? "";
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(/\/p\/[^/]+\/l\/[^/?]+/, async (route) => {
      if (route.request().headers()["rsc"]) await held;
      await route.continue();
    });
    await next.click();
    // the frame: seen at once; the layer's own panes are a picture only (inert), with one status line for screen readers
    const frame = page.locator(".m-frame-in");
    await expect(frame.locator(".m-reading-pane[inert]")).toBeVisible();
    await expect(frame.locator(".m-reading-pane[aria-busy='true'] h1")).toHaveText(title);
    await expect(frame.locator(".m-bar .m-seg, .m-bar [role='tablist']").first()).toBeVisible();
    await expect(frame.locator(".m-left a[href*='/l/']").first()).toBeVisible();
    await expect(frame.locator(".m-rtab").first()).toHaveText("Write it back");
    await expect(page.getByRole("status").filter({ hasText: `Opening ${title}` })).toBeAttached();
    await expect(page.getByRole("tab", { name: "Explained" })).toHaveCount(0); // nothing in the waiting panes can be used
    release();
    await expect(page.locator(".m-reading-pane:not([aria-busy]) h1:visible")).toHaveText(title, { timeout: 15_000 });
    await expect(page.locator(".m-reading-pane:not([aria-busy]) .m-body:visible")).toBeVisible();
  });
}
