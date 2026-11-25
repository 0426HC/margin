import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Test and profiling servers build into their own folder, so they can run beside your own `npm run dev`.
  distDir: process.env.MARGIN_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  devIndicators: false,
  // "Weekly notes" became "Lecture notes": old links and bookmarks still land on the right page (and the right week).
  async redirects() {
    return [
      { source: "/p/:id/weeks", destination: "/p/:id/lecture-notes", permanent: true },
      { source: "/p/:id/weeks/:week", destination: "/p/:id/lecture-notes/:week", permanent: true },
    ];
  },
  // Your data (.data and its backups, which may hold local Python environments with symlinks) and the Mac app's release builds are runtime-only: never traced into a build.
  outputFileTracingExcludes: { "*": [".data/**", ".data-*/**", ".mac-app/**"] },
  // native or worker-based packages must load from node_modules, not be bundled
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "mammoth", "jszip"],
  // The project root is this folder, also when a release snapshot sits inside the main project (.mac-app/releases, see docs/mac-app.md).
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
