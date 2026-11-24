// Refresh the curated README images under `assets/` from the latest
// `pnpm shots` run. The README shows English shots only (the full
// matrix, in both languages and themes, stays in `screenshots/`).
//
// Usage:
//   pnpm shots          # first — the full matrix
//   pnpm shots:assets   # copy the curated set into assets/

import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = join(root, "screenshots");

/** The curated set: assets/<file> ← screenshots/<source>. */
const CURATED = [
  { file: "list.png", source: "windows/en-dark/list.png" },
  { file: "print.png", source: "windows/en-dark/print.png" },
  { file: "edit.png", source: "windows/en-dark/edit.png" },
  { file: "android.png", source: "android/en-dark/list.png" },
];

const assetsDir = join(root, "assets");
let missing = 0;
for (const { file, source } of CURATED) {
  const from = join(shotsDir, source);
  if (!existsSync(from)) {
    console.error(`missing screenshots/${source} — run "pnpm shots" first`);
    missing++;
    continue;
  }
  copyFileSync(from, join(assetsDir, file));
  console.log(`assets/${file} ← screenshots/${source}`);
}

// Drop any png the curated set no longer uses (for example a
// Japanese shot the README stopped showing).
for (const f of readdirSync(assetsDir)) {
  if (f.endsWith(".png") && !CURATED.some((c) => c.file === f)) {
    rmSync(join(assetsDir, f));
    console.log(`removed assets/${f}`);
  }
}

process.exit(missing ? 1 : 0);
