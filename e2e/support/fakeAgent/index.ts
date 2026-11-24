/**
 * The fake Tauri bridge: it lets the UI run in plain Chromium (the
 * screenshot script, `scripts/screenshots.mjs`). It reads the app's
 * starting state from `localStorage["fake-agent:seed"]` (base64
 * JSON), answers every command in `app/ui/src/api.ts` from that state,
 * and records the calls on `window.__FAKE_AGENT_CALLS`.
 *
 * The state is live, the way the real store would be: sign-in and
 * sign-out flip the handle, saving a template or a job updates the
 * lists, the community mirror and the publications react to saves.
 */

interface Delivery {
  chunk_bytes: number;
  pause_ms: number;
  close_delay_ms: number;
}

interface Printer {
  model: string;
  aliases: string[];
  language: string;
  media: string[];
  dpi: number | null;
  head_width_dots: number | null;
  can_confirm: boolean;
  delivery: Delivery;
}

interface SavedPrinterRow {
  name: string;
  model: string;
  transport: string;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  track: string;
  template: string;
  sample: string;
}

interface JobRow {
  id: string;
  templateName: string;
  template: string;
  track: string;
  profile: string;
  data: string;
  copies: number;
  transport: string;
  result: string;
  at: number;
}

interface Status {
  handle: string | null;
  online: boolean;
  pending: number;
}

interface CommunityRow {
  owner: string;
  slug: string;
  name: string;
  readme: string;
  track: string;
  template: string;
  sample: string;
  changedAt: number;
  saved: boolean;
}

interface Publication {
  id: string;
  localTemplateId: string;
  owner: string;
  slug: string;
  name: string;
  readme: string;
  lastTemplate: string;
  lastSample: string;
  publishedAt: number;
}

/** The seed the screenshot script plants before the page loads. */
interface Seed {
  printers?: Printer[];
  savedPrinters?: SavedPrinterRow[];
  templates?: TemplateRow[];
  jobs?: JobRow[];
  settings?: Record<string, string>;
  autostart?: boolean;
  registryUrl?: string;
  registryStatus?: Status;
  community?: CommunityRow[];
  publications?: Publication[];
}

declare global {
  interface Window {
    __FAKE_AGENT_CALLS?: Array<[string, unknown]>;
  }
}

const SEED_KEY = "fake-agent:seed";

function readSeed(): Seed {
  try {
    const raw = localStorage.getItem(SEED_KEY);
    localStorage.removeItem(SEED_KEY);
    return raw ? (JSON.parse(atob(raw)) as Seed) : {};
  } catch {
    return {};
  }
}

const seed = readSeed();

const printers = seed.printers ?? [];
// One saved printer by default, so the print screen's picker and the
// settings' saved list have something to show without a seed.
const savedPrinters: SavedPrinterRow[] =
  seed.savedPrinters ??
  (printers.length > 0
    ? [
        {
          name: `${printers[0].model} (saved)`,
          model: printers[0].model,
          transport: JSON.stringify({
            kind: "tcp",
            host: "127.0.0.1",
            port: 9100,
          }),
        },
      ]
    : []);

const state = {
  printers,
  savedPrinters: [...savedPrinters],
  templates: [...(seed.templates ?? [])],
  jobs: [...(seed.jobs ?? [])],
  settings: { ...(seed.settings ?? {}) },
  autostart: seed.autostart ?? false,
  registryUrl: seed.registryUrl ?? "http://127.0.0.1:8787",
  handle: seed.registryStatus?.handle ?? null,
  online: seed.registryStatus?.online ?? true,
  community: (seed.community ?? []).map((r) => ({ ...r })),
  publications: (seed.publications ?? []).map((p) => ({ ...p })),
  browserMode: "system",
  browserPath: null as string | null,
  browserVersion: null as string | null,
  logs: [
    {
      at_ms: Date.UTC(2026, 10, 24, 12, 0, 0),
      level: "info",
      target: "pipeline",
      message: "prepared 2 record(s), 2 page(s) on the raster path",
    },
    {
      at_ms: Date.UTC(2026, 10, 24, 12, 1, 0),
      level: "info",
      target: "registry",
      message: "signed in as ninja",
    },
  ],
};

/** The records the data text holds: a JSON array, or one object. */
function recordCount(data: string): number {
  try {
    const rows = JSON.parse(data);
    return Array.isArray(rows) ? rows.length : 1;
  } catch {
    return 1;
  }
}

/** A 32-bit FNV-1a hash, to seed the deterministic symbol patterns. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The EAN/UPC check digit of the leading digits; `firstWeight` is
 * 1 for EAN-13 (12 leading) and 3 for UPC-A (11 leading). */
function checkDigit(d: string, firstWeight: 1 | 3): number {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    sum += (d.charCodeAt(i) - 48) * (i % 2 === 0 ? firstWeight : 4 - firstWeight);
  }
  return (10 - (sum % 10)) % 10;
}

/** A deterministic stand-in for the Rust core's `encode_symbol`:
 * the same shape and the same failure rules, but the module pattern
 * is a seeded PRNG, so the canvas always draws something plausible. */
function symbolEncoding(kind: string, value: string): unknown {
  const v = value.trim();
  if (v === "") return null;
  if (kind === "qr") return qrMatrixStub(v);
  switch (kind) {
    case "ean13":
      if (!/^\d{13}$/.test(v) || checkDigit(v.slice(0, 12), 1) !== +v[12]) {
        return null;
      }
      break;
    case "upca":
      if (!/^\d{12}$/.test(v) || checkDigit(v.slice(0, 11), 3) !== +v[11]) {
        return null;
      }
      break;
    case "itf":
      if (!/^\d+$/.test(v) || v.length % 2 !== 0) return null;
      break;
    case "code39":
      if (!/^[A-Z0-9 $%*+./:-]+$/.test(v)) return null;
      break;
    default:
      // code128, code93: printable ASCII
      if (!/^[ -~]+$/.test(v)) return null;
  }
  const n = 60 + (fnv(v) % 80);
  const rnd = mulberry32(fnv(`${kind}\u0000${v}`));
  const modules: number[] = [];
  while (modules.length < n) {
    for (let i = 0; i < 1 + Math.floor(rnd() * 4); i++) {
      if (modules.length < n) modules.push(1);
    }
    for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
      if (modules.length < n) modules.push(0);
    }
  }
  modules[n - 1] = 1;
  return { quiet: 10, modules };
}

/** A deterministic QR stand-in: a version-sized box, the three real
 * finder patterns, the timing tracks, and a PRNG fill for the rest. */
function qrMatrixStub(
  value: string,
): { quiet: number; modules: number[]; side: number } | null {
  if (value.length > 2953) return null;
  const side =
    value.length < 10 ? 21
    : value.length < 20 ? 25
    : value.length < 40 ? 29
    : value.length < 80 ? 33
    : 37;
  const m = new Array<number>(side * side).fill(0);
  const rnd = mulberry32(fnv(`qr\u0000${value}`));
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= side || cc >= side) continue;
        const border =
          r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        m[rr * side + cc] = border || core ? 1 : 0;
      }
    }
  };
  finder(0, 0);
  finder(0, side - 7);
  finder(side - 7, 0);
  for (let i = 8; i < side - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    m[6 * side + i] = bit;
    m[i * side + 6] = bit;
  }
  const reserved = (r: number, c: number) =>
    (r < 9 && c < 9) ||
    (r < 9 && c >= side - 8) ||
    (r >= side - 8 && c < 9) ||
    r === 6 ||
    c === 6;
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      if (!reserved(r, c)) m[r * side + c] = rnd() < 0.5 ? 1 : 0;
    }
  }
  return { quiet: 4, modules: m, side };
}

/** A plausible prepare report: the same shape `plan_job` returns,
 * the preview left null (the UI shows the numbers, not the pages). */
function plan(a: Record<string, unknown>): unknown {
  let isDocument = false;
  try {
    isDocument =
      (JSON.parse(String(a.template)) as { format?: string }).format ===
      "html";
  } catch {
    isDocument = false;
  }
  const records = recordCount(String(a.data ?? ""));
  return {
    path: isDocument ? "browser" : "raster",
    fallback: null,
    records,
    pages: records,
    units: records,
    bytes: records * (isDocument ? 18432 : 4096),
    preview: null,
  };
}

async function invoke(
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  window.__FAKE_AGENT_CALLS?.push([cmd, args]);
  const a = args ?? {};
  switch (cmd) {
    case "parse_deeplink":
      return { template: null, printer: null, copies: null };
    case "list_printers":
      return state.printers;
    case "scan_system_printers":
      return [];
    case "scan_network_printers":
      return [];
    case "list_saved_printers":
      return state.savedPrinters;
    case "save_printer": {
      const row = a.printer as SavedPrinterRow;
      const i = state.savedPrinters.findIndex((p) => p.name === row.name);
      if (i >= 0) state.savedPrinters[i] = row;
      else state.savedPrinters.push(row);
      return undefined;
    }
    case "remove_printer": {
      const name = String(a.name);
      const i = state.savedPrinters.findIndex((p) => p.name === name);
      if (i >= 0) state.savedPrinters.splice(i, 1);
      return i >= 0;
    }
    case "encode_symbol":
      return symbolEncoding(String(a.kind), String(a.value));
    case "load_templates":
      return state.templates;
    case "save_template": {
      const row = a.template as TemplateRow;
      const i = state.templates.findIndex((t) => t.id === row.id);
      if (i >= 0) state.templates[i] = row;
      else state.templates.push(row);
      return undefined;
    }
    case "load_recent_jobs":
      return state.jobs;
    case "remember_job": {
      const job = a.job as JobRow;
      const i = state.jobs.findIndex((j) => j.id === job.id);
      if (i >= 0) state.jobs[i] = job;
      else state.jobs.unshift(job);
      state.jobs.length = Math.min(state.jobs.length, 10);
      return undefined;
    }
    case "load_settings":
      return state.settings;
    case "save_setting":
      state.settings[String(a.key)] = String(a.value);
      return undefined;
    case "is_autostart":
      return state.autostart;
    case "set_autostart":
      state.autostart = Boolean(a.enabled);
      return undefined;
    case "begin_pairing":
      return "K7QX 4T2M";
    case "paired_devices":
      return [];
    case "revoke_device":
      return undefined;
    case "plan_job":
      return plan(a);
    case "print_job":
      return { result: "confirmed", counts: null, reason: null };
    case "local_api_status":
      return {
        running: true,
        address: "127.0.0.1:17717",
        error: null,
      };
    case "browser_info":
      return {
        mode: state.browserMode,
        managed_path: state.browserPath,
        version: state.browserVersion,
        system: ["/usr/bin/chromium"],
      };
    case "browser_select":
      state.browserMode = String(a.mode);
      return undefined;
    case "browser_download_cmd":
      state.browserPath = "/home/user/.local/share/PrintNinja/browser/chrome";
      state.browserVersion = "141.0.0.0";
      state.browserMode = "managed";
      return state.browserPath;
    case "app_logs":
      return state.logs;
    case "app_log_clear":
      state.logs = [];
      return undefined;
    case "registry_url":
      return state.registryUrl;
    case "registry_login":
      if (a.url) state.settings["registry.url"] = String(a.url);
      state.handle = String(a.handle);
      return state.handle;
    case "registry_logout":
      state.handle = null;
      return undefined;
    case "registry_status":
    case "registry_refresh":
      return { handle: state.handle, online: state.online, pending: 0 };
    case "publish_template": {
      const localTemplateId = String(a.localTemplateId);
      const pub: Publication = {
        id: `pub-${localTemplateId}`,
        localTemplateId,
        owner: state.handle ?? "",
        slug: String(a.slug),
        name: String(a.name),
        readme: String(a.readme),
        lastTemplate: "",
        lastSample: "",
        publishedAt: Date.now(),
      };
      state.publications = [
        pub,
        ...state.publications.filter((p) => p.localTemplateId !== localTemplateId),
      ];
      return undefined;
    }
    case "unpublish_template": {
      const localTemplateId = String(a.localTemplateId);
      state.publications = state.publications.filter(
        (p) => p.localTemplateId !== localTemplateId,
      );
      return undefined;
    }
    case "save_community_template":
    case "unsave_community_template": {
      const saved = cmd === "save_community_template";
      for (const row of state.community) {
        if (row.owner === String(a.owner) && row.slug === String(a.slug)) {
          row.saved = saved;
        }
      }
      return undefined;
    }
    case "community_templates":
      return state.community;
    case "publications":
      return state.publications;
    // The event bridge the deep-link listener leans on: the fake
    // never fires an event, so a standing listener id is enough.
    case "plugin:event|listen":
      return "listener-1";
    case "plugin:event|unlisten":
      return undefined;
    case "plugin:deep-link|get_current":
      return [];
    default:
      throw new Error(`fake agent: no answer for "${cmd}"`);
  }
}

/** The Tauri v2 webview bridge, just enough for the UI to run. */
const callbacks = new Map<number, (event: unknown) => void>();
let nextCallback = 1;

window.__TAURI_INTERNALS__ = {
  invoke,
  transformCallback(cb: (event: unknown) => void): number {
    const id = nextCallback++;
    callbacks.set(id, cb);
    return id;
  },
  destroyCallback(id: number) {
    callbacks.delete(id);
  },
};
