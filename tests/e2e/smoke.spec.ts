import { expect, test } from "@playwright/test";

const pages = ["/style-guide"];

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
  // The margin: a citation in the gutter says which page it would open
  const margin = page.locator("#margin");
  await margin.getByRole("button", { name: /p\. 39/ }).first().click();
  await expect(margin.getByText("Would open p. 39 of the original.")).toBeVisible();
  // The desk can be swapped for the mist one
  await page.getByRole("button", { name: "Midnight desk" }).click();
  await expect(page.getByRole("button", { name: "Mist desk" })).toHaveAttribute("aria-pressed", "true");
});
