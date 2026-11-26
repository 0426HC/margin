// Encodes the frames saved by the last video test of tests/e2e/readme-tour.spec.ts into readme-videos/layers-scroll.mp4
// (H.264, 1920 wide, 30 fps, under 9 MB). Needs an ffmpeg binary: on the PATH, or FFMPEG=/path/to/ffmpeg (for example the one from a
// temporary `npm i ffmpeg-static` in a scratch folder, never added to the app). The folder readme-videos/ is never committed.
//   node scripts/readme-video.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const frames = path.join(os.tmpdir(), "margin-readme-frames");
const outDir = "readme-videos";
const out = path.join(outDir, "layers-scroll.mp4");
const LIMIT = 9 * 1024 * 1024;
fs.mkdirSync(outDir, { recursive: true });

// Highest quality first; a heavier compression only if the file is over the limit.
for (const crf of [14, 17, 20, 23, 26]) {
  execFileSync(
    ffmpeg,
    ["-y", "-framerate", "30", "-i", path.join(frames, "f%04d.jpg"), "-vf", "scale=1920:-2:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    { stdio: "ignore" },
  );
  const size = fs.statSync(out).size;
  console.log(`crf ${crf}: ${(size / 1024 / 1024).toFixed(2)} MB`);
  if (size < LIMIT) process.exit(0);
}
console.error("Could not get the video under 9 MB.");
process.exit(1);
