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

const state = {
  printers: seed.printers ?? [],
  templates: [...(seed.templates ?? [])],
  jobs: [...(seed.jobs ?? [])],
  settings: { ...(seed.settings ?? {}) },
  autostart: seed.autostart ?? false,
  registryUrl: seed.registryUrl ?? "http://127.0.0.1:8787",
  handle: seed.registryStatus?.handle ?? null,
  online: seed.registryStatus?.online ?? true,
  community: (seed.community ?? []).map((r) => ({ ...r })),
  publications: (seed.publications ?? []).map((p) => ({ ...p })),
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
    case "registry_url":
      return state.registryUrl;
    case "registry_login":
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
