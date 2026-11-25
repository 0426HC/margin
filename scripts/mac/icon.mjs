// Draws Margin's Mac icon (a sheet of porcelain paper with the plum margin line and the wordmark's "M." on the midnight desk)
// and writes scripts/mac/Margin.icns. It renders in a running Margin server so the real Bricolage Grotesque font is used:
//   node scripts/mac/icon.mjs http://localhost:3000
// Needs Playwright's Chromium (already a dev dependency) and macOS's sips and iconutil.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const here = path.dirname(new URL(import.meta.url).pathname);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "margin-icon-"));

// Apple's icon grid: an 824px rounded square centred on a 1024px canvas, the rest transparent.
const markup = `
<div id="icon" style="width:1024px;height:1024px;position:relative;background:transparent">
  <div style="position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:185px;overflow:hidden;
    background:radial-gradient(120% 90% at 50% 0%, #1f2a48 0%, #161f37 45%, #0c1222 100%);
    box-shadow:inset 0 2px 0 rgba(255,255,255,.08)">
    <div style="position:absolute;right:-140px;bottom:-160px;width:520px;height:520px;border-radius:50%;
      background:radial-gradient(circle, rgba(211,138,224,.20), rgba(211,138,224,0) 70%)"></div>
    <div style="position:absolute;left:182px;top:150px;width:460px;height:560px;border-radius:22px;background:#edf0f6;
      box-shadow:inset 0 2px 0 rgba(255,255,255,.9), 0 2px 4px rgba(4,8,20,.35), 0 24px 60px rgba(4,8,20,.55)">
      <div style="position:absolute;left:92px;top:0;bottom:0;width:7px;background:#7d2c92;opacity:.9"></div>
      <div data-m style="position:absolute;left:124px;top:104px;font-family:'Bricolage Grotesque', sans-serif;
        font-weight:800;font-size:262px;line-height:1;letter-spacing:-10px;color:#131b2d">M.</div>
      <div style="position:absolute;left:132px;right:56px;top:440px;height:10px;border-radius:5px;background:#48536d;opacity:.28"></div>
      <div style="position:absolute;left:132px;right:120px;top:476px;height:10px;border-radius:5px;background:#48536d;opacity:.2"></div>
    </div>
  </div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.goto(base + "/");
await page.evaluate((html) => {
  document.body.innerHTML = html;
  document.body.style.cssText = "margin:0;background:transparent";
  document.documentElement.style.background = "transparent";
}, markup);
// web fonts load on first use, so ask for the exact face before the screenshot
const family = await page.evaluate(async () => {
  const el = document.querySelector("#icon [data-m]");
  const f = getComputedStyle(el).fontFamily;
  await document.fonts.load(`800 260px ${f}`);
  await document.fonts.ready;
  return f;
});
console.log("font:", family);
const png = path.join(work, "icon-1024.png");
await page.locator("#icon").screenshot({ path: png, omitBackground: true });
await browser.close();

// The sizes macOS asks for, then one .icns.
const set = path.join(work, "Margin.iconset");
fs.mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  execFileSync("sips", ["-z", String(s), String(s), png, "--out", path.join(set, `icon_${s}x${s}.png`)], { stdio: "ignore" });
  execFileSync("sips", ["-z", String(s * 2), String(s * 2), png, "--out", path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: "ignore" });
}
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(here, "Margin.icns")]);
fs.copyFileSync(png, path.join(here, "icon-1024.png"));
console.log(`Wrote ${path.join(here, "Margin.icns")} and icon-1024.png`);
