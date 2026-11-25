import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**", // test and profiling servers build here (MARGIN_DIST_DIR)
    "out/**",
    "build/**",
    "next-env.d.ts",
    // not source: local data and its backups (git-ignored)
    ".data/**",
    ".data-*/**",
    ".mac-app/**", // the Mac app's release snapshots (scripts/mac)
  ]),
]);

export default eslintConfig;
