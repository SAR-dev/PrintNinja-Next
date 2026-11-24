// Screenshot script: it runs the UI in plain Chromium (no Tauri, no
// Rust) on top of a fake bridge (`e2e/support/fakeAgent/index.ts`) and
// captures every view, per platform (desktop and Android), language
// (en, ja) and theme (dark, light). The output lands in
// `screenshots/<platform>/<lang>-<theme>/<view>.png`, one
// contact-sheet `index.html` per platform.
//
// Usage:
//   pnpm shots                          # everything, 4 workers
//   pnpm shots --platforms windows      # desktop only
//   pnpm shots --views list,print       # a few views
//   pnpm shots --chromium /path/chrome  # a custom Chromium/Chrome
//
// The app must not be running on port 1420: the script starts the
// Vite dev server itself and kills it when done. The first run needs
// Playwright's Chromium: `pnpm exec playwright install chromium`.

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 1420;
const URL = `http://localhost:${PORT}/`;

// ---------------------------------------------------------------- args

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function list(name, fallback) {
  return (flag(name, fallback) ?? "").split(",").filter(Boolean);
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const platforms = list("platforms", "windows,android").filter((p) =>
  ["windows", "android"].includes(p),
);
const langs = list("langs", "en,ja").filter((l) => ["en", "ja"].includes(l));
const themes = list("themes", "dark,light").filter((t) =>
  ["dark", "light"].includes(t),
);
const jobsN = Number(flag("jobs", "4")) || 4;
const outDir = flag("out", join(root, "screenshots"));
const chromiumPath = flag("chromium", null);
const wantIndex = !hasFlag("no-index");

const VIEWS = [
  "list",
  "jobs",
  "printers",
  "community",
  "saved",
  "print",
  "print-preview",
  "print-done",
  "edit",
  "document-edit",
  "settings",
  "new-template",
  "publish-dialog",
  "template-menu",
  "account-menu",
  "signin-dialog",
];
const views = list("views", VIEWS.join(",")).filter((v) =>
  VIEWS.includes(v),
);
if (views.length === 0) {
  console.error("no valid --views given; valid: " + VIEWS.join(", "));
  process.exit(1);
}

// The UI strings the navigation clicks on, per language.
const L = {
  en: {
    print: "Print",
    edit: "Edit",
    more: "More actions",
    duplicate: "Duplicate",
    publish: "Publish",
    newTemplate: "New template",
    settings: "Settings",
    accountMenu: "Account menu",
    sync: "Sync",
    signIn: "Sign in",
    signOut: "Sign out",
    jobs: "Jobs",
    recentTitle: "Recent jobs",
    tabCommunity: "Community",
    tabSaved: "Saved",
    tabPrinters: "Printers",
    savedPrinters: "Saved printers",
    preview: "Preview",
    confirmed: "Confirmed",
    editorTitle: "Edit template",
    documentTitle: "Edit document",
  },
  ja: {
    print: "印刷",
    edit: "編集",
    more: "その他の操作",
    duplicate: "複製",
    publish: "公開",
    newTemplate: "新しいテンプレート",
    settings: "設定",
    accountMenu: "アカウントメニュー",
    sync: "同期",
    signIn: "サインイン",
    signOut: "サインアウト",
    jobs: "ジョブ",
    recentTitle: "最近のジョブ",
    tabCommunity: "コミュニティ",
    tabSaved: "保存済み",
    tabPrinters: "プリンター",
    savedPrinters: "保存済みプリンター",
    preview: "プレビュー",
    confirmed: "確認済み",
    editorTitle: "テンプレートを編集",
    documentTitle: "ドキュメントを編集",
  },
};

// ---------------------------------------------------------------- seed

// The state the fake bridge starts from: the app as a working shop
// left it — two printers the user has, the two shipped templates plus
// one saved on top, two recent jobs (one that only partly landed), a
// signed-in handle, community rows and one publication. Keep it
// ASCII: the seed travels as base64 + atob.
function makeSeed(theme) {
  const now = Date.now();
  const labelTemplate = {
    format: "scene",
    media: { kind: "label", width_mm: 40, height_mm: 50 },
    fields: [{ name: "name" }],
    elements: [
      {
        type: "text",
        at: { x_mm: 2, y_mm: 2 },
        size: { w_mm: 36, h_mm: 4 },
        content: "{{name}}",
        style: { size_mm: 3 },
      },
      {
        type: "line",
        at: { x_mm: 2, y_mm: 7 },
        length_mm: 36,
        thickness_mm: 0.2,
      },
      {
        type: "barcode",
        at: { x_mm: 3, y_mm: 11 },
        size: { w_mm: 34, h_mm: 13 },
        kind: "code128",
        value: "{{name}}",
      },
      {
        type: "qr",
        at: { x_mm: 12, y_mm: 28 },
        h_mm: 16,
        value: "{{name}}",
      },
    ],
  };
  const invoiceTemplate = {
    format: "scene",
    media: { kind: "label", width_mm: 62, height_mm: 29 },
    fields: [{ name: "invoice" }, { name: "customer" }],
    elements: [
      {
        type: "text",
        at: { x_mm: 3, y_mm: 3 },
        size: { w_mm: 56, h_mm: 6 },
        content: "{{invoice}}",
        style: { size_mm: 4, bold: true },
      },
      {
        type: "text",
        at: { x_mm: 3, y_mm: 10 },
        size: { w_mm: 56, h_mm: 5 },
        content: "{{customer}}",
        style: { size_mm: 3 },
      },
    ],
  };
  const a4Template = {
    format: "html",
    media: { kind: "page", width_mm: 210, height_mm: 297 },
    elements: [],
    html: `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 20mm; color: #1a1a1a; }
  h1 { font-size: 22pt; margin-bottom: 4mm; }
  p { font-size: 11pt; line-height: 1.6; }
</style>
</head>
<body>
  <h1>Note for {{to}}</h1>
  <p>This page was printed by PrintNinja.</p>
</body>
</html>`,
  };
  return {
    printers: [
      {
        model: "ZT411",
        aliases: ["ZTC ZT411"],
        language: "zpl",
        media: ["label", "continuous"],
        dpi: 203,
        head_width_dots: 800,
        can_confirm: true,
        delivery: { chunk_bytes: 4096, pause_ms: 10, close_delay_ms: 500 },
      },
      {
        model: "TM-T88VII",
        aliases: [],
        language: "escpos",
        media: ["label", "continuous", "page"],
        dpi: 180,
        head_width_dots: 720,
        can_confirm: false,
        delivery: { chunk_bytes: 2048, pause_ms: 20, close_delay_ms: 300 },
      },
      {
        model: "Office Laser",
        aliases: [],
        language: "pdf",
        media: ["page"],
        dpi: null,
        head_width_dots: null,
        can_confirm: true,
        delivery: { chunk_bytes: 65536, pause_ms: 0, close_delay_ms: 0 },
      },
    ],
    // Overrides the shipped "parts-label" starter (mergeTemplates
    // keys by id) and adds one user template.
    templates: [
      {
        id: "parts-label",
        name: "Parts label",
        description: "A 40 x 50 mm label with the part name and a rule.",
        track: "scene",
        template: JSON.stringify(labelTemplate),
        sample: '[{"name":"BOLT M8"},{"name":"NUT M8"}]',
      },
      {
        id: "invoice-label",
        name: "Invoice label",
        description: "A 62 x 29 mm shipping label: invoice and customer.",
        track: "scene",
        template: JSON.stringify(invoiceTemplate),
        sample: '[{"invoice":"INV-1042","customer":"Rafi MD"},{"invoice":"INV-1043","customer":"Sara Lee"}]',
      },
    ],
    jobs: [
      {
        id: "job-b2m",
        templateName: "Parts label",
        template: JSON.stringify(labelTemplate),
        track: "scene",
        profile: "ZT411",
        data: '[{"name":"BOLT M8"},{"name":"NUT M8"}]',
        copies: 2,
        transport: JSON.stringify({
          kind: "tcp",
          host: "192.168.1.40",
          port: 9100,
        }),
        result: JSON.stringify({ result: "confirmed", counts: null, reason: null }),
        at: now - 2 * 3600e3,
      },
      {
        id: "job-a1n",
        templateName: "A4 note",
        template: JSON.stringify(a4Template),
        track: "document",
        profile: "Office Laser",
        data: '[{"to":"Rafi"},{"to":"Sara"}]',
        copies: 5,
        transport: JSON.stringify({ kind: "spooler", name: "Office Laser" }),
        result: JSON.stringify({
          result: "partially_printed",
          counts: [3, 5],
          reason: null,
        }),
        at: now - 26 * 3600e3,
      },
    ],
    settings: { theme },
    autostart: true,
    registryUrl: "http://127.0.0.1:8787",
    registryStatus: { handle: "ninja", online: true, pending: 0 },
    community: [
      {
        owner: "ninja",
        slug: "parts-label",
        name: "Parts label",
        readme: "The label the shop prints parts with.",
        track: "scene",
        template: JSON.stringify(labelTemplate),
        sample: '[{"name":"BOLT M8"}]',
        changedAt: Math.floor(now / 1000) - 86400,
        saved: false,
      },
      {
        owner: "sam",
        slug: "a4-note",
        name: "A4 note",
        readme: "A note on A4, one record per page.",
        track: "document",
        template: JSON.stringify(a4Template),
        sample: '[{"to":"Sara"}]',
        changedAt: Math.floor(now / 1000) - 43200,
        saved: true,
      },
    ],
    // Published under the user template, so the first card (the
    // starter) still offers its Publish button for the dialog shot.
    publications: [
      {
        id: "pub-invoice-label",
        localTemplateId: "invoice-label",
        owner: "ninja",
        slug: "invoice-label",
        name: "Invoice label",
        readme: "A shipping label with the invoice and the customer.",
        lastTemplate: JSON.stringify(invoiceTemplate),
        lastSample: '[{"invoice":"INV-1042","customer":"Rafi MD"}]',
        publishedAt: now - 3 * 86400e3,
      },
    ],
  };
}

// ------------------------------------------------------------ platforms

const PLATFORMS = {
  windows: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  android: {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  },
};

// ------------------------------------------------------------ navigate

// The app has no URL routing: every view is reached by clicking.
// `card.first()` is the first template card (the parts label); the
// "A4 note" card is found by its heading.
async function navigate(page, view, l) {
  const card = page.locator('[data-slot="card"]');
  switch (view) {
    case "list":
      break;
    case "jobs":
      // The sidebar button carries a job count after its name.
      await page.getByRole("button", { name: l.jobs }).click();
      await page
        .getByRole("heading", { name: l.recentTitle, level: 1 })
        .waitFor();
      break;
    case "printers":
      await page
        .getByRole("button", { name: l.tabPrinters, exact: true })
        .click();
      await page
        .getByRole("heading", { name: l.savedPrinters, level: 2 })
        .waitFor();
      break;
    case "community":
      // The sidebar button carries the saved-template count after its name.
      await page.getByRole("button", { name: l.tabCommunity }).click();
      await page
        .getByRole("heading", { name: l.tabCommunity, level: 1 })
        .waitFor();
      break;
    case "saved":
      await page.getByRole("button", { name: l.tabCommunity }).click();
      await page
        .getByRole("heading", { name: l.tabCommunity, level: 1 })
        .waitFor();
      await page
        .getByRole("button", { name: l.tabSaved, exact: true })
        .click();
      await page.getByRole("heading", { name: l.tabSaved, level: 2 }).waitFor();
      break;
    case "print":
    case "print-preview":
    case "print-done":
      await card
        .first()
        .getByRole("button", { name: l.print, exact: true })
        .click();
      await page.getByRole("heading", { name: "Parts label" }).waitFor();
      if (view === "print-preview") {
        await page.getByRole("button", { name: l.preview, exact: true }).click();
        await page.getByText("raster", { exact: true }).waitFor();
      } else if (view === "print-done") {
        await page
          .getByRole("button", { name: l.print, exact: true })
          .click();
        await page.getByText(l.confirmed, { exact: true }).waitFor();
      }
      break;
    case "edit":
      await card
        .first()
        .getByRole("button", { name: l.edit, exact: true })
        .click();
      await page.getByRole("heading", { name: l.editorTitle, level: 1 }).waitFor();
      break;
    case "document-edit":
      // The card title's heading also carries the track badge, so the
      // name is "A4 note document" — match on the prefix.
      await card
        .filter({ has: page.getByRole("heading", { name: /^A4 note/ }) })
        .getByRole("button", { name: l.edit, exact: true })
        .click();
      await page
        .getByRole("heading", { name: l.documentTitle, level: 1 })
        .waitFor();
      break;
    case "settings":
      await page
        .getByRole("button", { name: l.settings, exact: true })
        .click();
      await page.getByRole("heading", { name: l.settings, level: 1 }).waitFor();
      break;
    case "new-template":
      await page.getByRole("button", { name: l.newTemplate }).click();
      await page.getByRole("dialog").waitFor();
      break;
    case "template-menu":
      await card.first().getByRole("button", { name: l.more, exact: true }).click();
      await page.getByRole("menuitem", { name: l.duplicate, exact: true }).waitFor();
      break;
    case "publish-dialog":
      // Publish moved into the card's overflow menu (D2/M2).
      await card.first().getByRole("button", { name: l.more, exact: true }).click();
      await page.getByRole("menuitem", { name: l.publish, exact: true }).click();
      await page.locator("#publish-slug").waitFor();
      break;
    case "account-menu":
      await page
        .getByRole("button", { name: l.accountMenu })
        .click();
      await page.getByRole("menuitem", { name: l.sync, exact: true }).waitFor();
      break;
    case "signin-dialog":
      // Sign in/out and Sync now live in the one account menu (M1).
      await page
        .getByRole("button", { name: l.accountMenu })
        .click();
      await page
        .getByRole("menuitem", { name: l.signOut, exact: true })
        .click();
      await page
        .getByRole("button", { name: l.accountMenu })
        .click();
      const signIn = page.getByRole("menuitem", {
        name: l.signIn,
        exact: true,
      });
      await signIn.waitFor();
      await signIn.click();
      await page.locator("#signin-handle").waitFor();
      break;
    default:
      throw new Error(`unknown view "${view}"`);
  }
}

// ---------------------------------------------------------------- settle

// Wait until the app has come to rest: the network is quiet and no
// loading skeleton (`.animate-pulse`) is on screen any more.
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const pulse = page.locator(".animate-pulse").first();
  if ((await pulse.count().catch(() => 0)) > 0) {
    await pulse.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

// Freeze every animation and transition, so a capture never lands on
// a mid-frame state.
async function freeze(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) a.pause();
    const style = document.createElement("style");
    style.textContent =
      "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }";
    document.head.appendChild(style);
  });
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------- vite

function startVite() {
  // Vite's own bin, through node: no pnpm wrapper, one process to kill.
  const viteBin = join(root, "app/ui/node_modules/vite/bin/vite.js");
  const child = spawn(
    process.execPath,
    [viteBin, "--port", String(PORT), "--strictPort"],
    { cwd: join(root, "app/ui"), stdio: ["ignore", "pipe", "pipe"] },
  );
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`vite did not come up on ${PORT} within 60s`)),
      60000,
    );
    const onData = (buf) => {
      const text = buf.toString();
      process.stdout.write(`  [vite] ${text.trimEnd()}\n`);
      if (/Local:|ready in/.test(text)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (buf) => process.stderr.write(buf));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== null) reject(new Error(`vite exited early (code ${code})`));
    });
  });
  return { child, ready };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
      stdio: "ignore",
    });
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

// ----------------------------------------------------------------- job

async function runJob(browser, job, fakeAgent) {
  const t0 = Date.now();
  const ctx = await browser.newContext({
    ...PLATFORMS[job.platform],
    locale: job.lang === "ja" ? "ja-JP" : "en-US",
  });
  // The app checks GitHub for updates; keep the run offline and fast.
  await ctx.route("**/api.github.com/**", (r) => r.abort());
  const seedB64 = Buffer.from(JSON.stringify(makeSeed(job.theme))).toString(
    "base64",
  );
  await ctx.addInitScript(
    ({ seed, lang }) => {
      localStorage.setItem("fake-agent:seed", seed);
      localStorage.setItem("printninja.language", lang);
    },
    { seed: seedB64, lang: job.lang },
  );
  await ctx.addInitScript(fakeAgent);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await settle(page);
    await navigate(page, job.view, L[job.lang]);
    await settle(page);
    await freeze(page);
    mkdirSync(dirname(job.path), { recursive: true });
    await page.screenshot({ path: job.path, fullPage: true });
  } finally {
    await ctx.close().catch(() => {});
  }
  return (Date.now() - t0) / 1000;
}

// ---------------------------------------------------------------- index

function writeIndex(platform, combos, views) {
  const cells = combos
    .map((c) =>
      views
        .map((v) => {
          const src = `${c}/${v}.png`;
          return `
        <figure>
          <a href="${src}"><img src="${src}" alt="${platform} ${c} ${v}" loading="lazy"></a>
          <figcaption>${c} / ${v}</figcaption>
        </figure>`;
        })
        .join(""),
    )
    .join("");
  writeFileSync(
    join(outDir, platform, "index.html"),
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PrintNinja — ${platform} screenshots</title>
<style>
  body { margin: 24px; font-family: "Segoe UI", system-ui, sans-serif; background: #111; color: #eee; }
  h1 { font-size: 20px; }
  figure { margin: 0 0 24px; break-inside: avoid; }
  figure img { width: 100%; border-radius: 8px; border: 1px solid #333; }
  figcaption { font-size: 12px; color: #999; margin-top: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
</style>
</head>
<body>
<h1>PrintNinja — ${platform}</h1>
<div class="grid">${cells}</div>
</body>
</html>
`,
  );
}

// ------------------------------------------------------------------ main

async function main() {
  const jobs = [];
  for (const platform of platforms) {
    for (const lang of langs) {
      for (const theme of themes) {
        for (const view of views) {
          jobs.push({
            platform,
            lang,
            theme,
            view,
            path: join(outDir, platform, `${lang}-${theme}`, `${view}.png`),
          });
        }
      }
    }
  }
  console.log(
    `${jobs.length} screenshot(s): ${[...new Set(jobs.map((j) => j.platform))].join(", ")} ` +
      `x ${langs.join(", ")} x ${themes.join(", ")} x ${views.length} view(s)`,
  );

  // Bundle the fake bridge to one self-contained script.
  const bundle = buildSync({
    entryPoints: [join(root, "e2e/support/fakeAgent/index.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const fakeAgent = bundle.outputFiles[0].text;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const vite = startVite();
  let browser = null;
  let failures = 0;
  try {
    await vite.ready;
    // Vite prints "ready in" a tick before it accepts connections; the
    // first workers would race it. Wait for a real answer.
    for (;;) {
      try {
        if ((await fetch(URL)).ok) break;
      } catch {
        /* not listening yet */
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    browser = await chromium.launch({
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    });

    const queue = [...jobs];
    const workers = Array.from(
      { length: Math.min(jobsN, queue.length) },
      async (n) => {
        for (;;) {
          const job = queue.shift();
          if (!job) return;
          const label = `[${jobs.length - queue.length}/${jobs.length}] ${job.platform} ${job.lang}-${job.theme} ${job.view}`;
          try {
            const secs = await runJob(browser, job, fakeAgent);
            console.log(`${label} ok (${secs.toFixed(1)}s)`);
          } catch (e) {
            failures++;
            console.error(`${label} FAILED: ${e.message.split("\n")[0]}`);
          }
        }
      },
    );
    await Promise.all(workers);

    if (wantIndex) {
      for (const platform of platforms) {
        const combos = langs.flatMap((lang) =>
          themes.map((theme) => `${lang}-${theme}`),
        );
        writeIndex(platform, combos, views);
        console.log(`index: ${join(outDir, platform, "index.html")}`);
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    killTree(vite.child);
  }

  console.log(
    failures
      ? `\n${failures} of ${jobs.length} failed.`
      : `\nAll ${jobs.length} screenshots in ${outDir}.`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
