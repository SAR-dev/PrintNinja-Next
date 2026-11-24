// The Tauri template pins `compileSdk`/`targetSdk` to 37, but the
// stable Android SDK repository does not carry `platforms;android-37`
// yet — CI would fail on the missing platform. Pin the generated
// project to the newest stable platform, the one CI installs.
// Run after `tauri android init`:
//   node scripts/patch-android-sdk.mjs [path/to/android]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = 36;

/** Pure and idempotent: pins compileSdk/targetSdk to PLATFORM. */
export function patchSdkVersions(src) {
  return src.replace(
    /(^|\n)(\s*)(compileSdk|targetSdk) = \d+/g,
    (_all, lead, indent, name) => `${lead}${indent}${name} = ${PLATFORM}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const androidDir = process.argv[2] ?? "app/gen/android";
  const file = join(androidDir, "app", "build.gradle.kts");
  if (!existsSync(file)) {
    console.error(
      `No app/build.gradle.kts under ${androidDir}. Run \`pnpm exec tauri android init\` first.`,
    );
    process.exit(1);
  }
  const before = readFileSync(file, "utf8");
  const after = patchSdkVersions(before);
  if (after !== before) writeFileSync(file, after);
  console.log(`${file}: ${after !== before ? "patched" : "already up to date"}`);
}
