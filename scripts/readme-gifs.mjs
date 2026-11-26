// Turns the raw clips recorded by tests/e2e/readme-media.spec.ts into the README's GIFs (docs/readme/*.gif).
// Needs an ffmpeg binary: on the PATH, or FFMPEG=/path/to/ffmpeg (for example the one from a temporary `npm i ffmpeg-static`, never added to the app).
//   node scripts/readme-gifs.mjs [width]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const width = Number(process.argv[2] ?? 1200);
const clips = path.join(os.tmpdir(), "margin-readme-media", "clips");
const out = path.join("docs", "readme");

// Dark gradients are the expensive part of a GIF, so each clip walks down a ladder of frame rates and palettes until it is under the limit.
const LADDER = [[12, 96], [12, 64], [12, 48], [10, 64], [10, 48], [10, 32], [8, 48]];
const LIMIT = 4.0e6;
const MAX_SECONDS = { hero: 5.5, default: 7 }; // the hero scrolls whole screens, which is the costliest motion to store

for (const file of fs.readdirSync(clips).filter((f) => f.endsWith(".webm"))) {
  const name = file.replace(/\.webm$/, "");
  const { start, duration } = JSON.parse(fs.readFileSync(path.join(clips, `${name}.json`), "utf8"));
  const seconds = Math.min(duration, MAX_SECONDS[name] ?? MAX_SECONDS.default);
  const target = path.join(out, `${name}.gif`);
  for (const [rate, colours] of LADDER) {
    execFileSync(ffmpeg, ["-y", "-v", "error", "-ss", start.toFixed(2), "-t", seconds.toFixed(2), "-i", path.join(clips, file),
      "-vf", `fps=${rate},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colours}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, "-loop", "0", target]);
    const size = fs.statSync(target).size;
    if (size <= LIMIT) break;
  }
  console.log(`${name}.gif  ${(fs.statSync(target).size / 1e6).toFixed(2)} MB  ${seconds.toFixed(1)} s`);
}
