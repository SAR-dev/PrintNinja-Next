/**
 * The typed bridge to the Rust core. One file, three commands
 * (plan phase 7): list the printers, prepare a job, print a job.
 * The shapes mirror `app/src/pipeline.rs` field for field — when the
 * Rust side changes, this file must change with it.
 */
import { invoke } from "@tauri-apps/api/core";

/** A profile's shipped pacing and close delay — the starting point
 * the settings screen's per-printer overrides sit on top of. */
export interface DeliveryInfo {
  chunk_bytes: number;
  pause_ms: number;
  close_delay_ms: number;
}

/** A printer, as the profile set describes it. */
export interface ProfileInfo {
  model: string;
  aliases: string[];
  /** The profile's language, in words: "zpl", "escpos", "pdf", … */
  language: string;
  /** The media kinds the printer takes: "label", "continuous", "page". */
  media: string[];
  dpi: number | null;
  head_width_dots: number | null;
  /** Whether this printer can confirm a job with its own reply. */
  can_confirm: boolean;
  /** The profile's own pacing and close delay, before any override. */
  delivery: DeliveryInfo;
}

/** One page of the prepared job, the way the job prints it (§3.4). */
export type Preview =
  | {
      kind: "bitmap";
      width: number;
      height: number;
      /** 1 bit per dot, 8 dots per byte, MSB first. */
      packed: number[];
      width_mm: number;
      height_mm: number;
    }
  | { kind: "pdf"; pdf: number[] };

/** What preparing a job found, before anything touched the wire. */
export interface PrepareReport {
  /** "native", "raster", "pdf" or "browser". */
  path: string;
  /** Why the track's preferred path was refused, if it was. */
  fallback: string | null;
  records: number;
  pages: number;
  units: number;
  bytes: number;
  /** The job's pages in order — one copy's worth. Scene jobs: every
   * page as its 1-bit dots; document jobs: the PDF(s) the printer
   * receives (one per record on the browser path). */
  preview: Preview[] | null;
}

/** What actually happened to a printed job (plan §5.7). */
export interface JobReport {
  /** "confirmed", "sent_unconfirmed", "partially_printed", "failed"
   * or "wrong_mode_suspected". */
  result: string;
  /** The "N of M" counts, for partial jobs. */
  counts: [number, number] | null;
  reason: string | null;
}

/** Where the bytes go. */
export type Transport =
  | { kind: "tcp"; host: string; port: number }
  | { kind: "ipp"; address: string; user?: string | null }
  | { kind: "spooler"; name: string }
  | { kind: "bluetooth"; address: string };

/**
 * A saved template row (the persistence increment). The template and
 * the sample travel as JSON text — the Rust store keeps them as text
 * columns.
 */
export interface StoredTemplate {
  id: string;
  name: string;
  description: string;
  track: string;
  template: string;
  sample: string;
}

/**
 * A device paired to the local print API over the LAN (plan phase 8,
 * LAN increment). The token itself is not in this shape — the PC keeps
 * only its hash.
 */
export interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  /** When it paired, as `Date.now()` milliseconds. */
  pairedAt: number;
}

/** A saved recent job: the job frozen at print time, its last result. */
export interface StoredJob {
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

/**
 * What a `printninja://print` link carries (plan phase 8, deep link):
 * the template by name, a printer by profile name, a copy count, and a
 * data URL. `null` is "the link did not say" — the screen keeps its
 * default.
 */
export interface DeepLinkPrint {
  template: string | null;
  printer: string | null;
  copies: number | null;
  dataUrl: string | null;
}

/** Turn a delivered deep link into the values it carries. */
export const parseDeeplink = (url: string) =>
  invoke<DeepLinkPrint>("parse_deeplink", { url });

export const listPrinters = () => invoke<ProfileInfo[]>("list_printers");

/**
 * The module pattern of a barcode or QR value: `1` dark, `0` light,
 * plus the quiet zone in modules (10 for 1-D, 4 for QR; `side` for a
 * QR). The shapes mirror `app/src/lib.rs` field for field.
 */
export interface SymbolEncoding {
  quiet: number;
  modules: number[];
  side?: number;
}

const symbolCache = new Map<string, SymbolEncoding | null>();

/** The cached pattern for a value, or undefined when never asked. */
export function symbolCacheGet(
  kind: string,
  value: string,
): SymbolEncoding | null | undefined {
  return symbolCache.get(`${kind}\u0000${value}`);
}

/**
 * The module pattern of a value, from the Rust core — the same
 * encoders the print path uses, so the canvas and the preview cannot
 * disagree (REFACTORING decision #13). `null` when the value is
 * empty or the symbology cannot carry it. Cached per (kind, value).
 */
export function encodeSymbol(kind: string, value: string) {
  const key = `${kind}\u0000${value}`;
  const hit = symbolCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return invoke<SymbolEncoding | null>("encode_symbol", { kind, value }).then(
    (r) => {
      symbolCache.set(key, r);
      return r;
    },
  );
}

/**
 * Printer discovery (the previous app's "scan & add"). The shapes
 * mirror `app/src/discovery.rs` field for field.
 */

/** A queue the OS's spooler already knows, from the system scan. */
export interface SystemPrinter {
  name: string;
  /** The port or backend the queue sends to (`USB001`, …). */
  port: string;
  /** The queue's fault, in the spooler's own words; absent when ready. */
  status?: string;
}

/** A printer the LAN announced over mDNS, from the network scan. */
export interface DiscoveredPrinter {
  name: string;
  /** A private IP when the advertisement carried one, else the hostname. */
  host: string;
  port: number;
  /** The transport the found service is: "ipp" or "raw_tcp". */
  kind: string;
  /** The service is the TLS variant (_ipps._tcp): the address is https://. */
  secure?: boolean;
  /** An IPP resource path, when the advertisement carried one. */
  resourcePath?: string;
}

/**
 * A printer the user saved: a name they chose, the profile it speaks,
 * and the transport that reaches it. The profile stays the shipped
 * set — the row only says which profile, and how, to use.
 */
export interface SavedPrinter {
  name: string;
  /** The profile's model. */
  model: string;
  /** The transport, as JSON text. */
  transport: string;
}

/** The queues this machine's spooler already knows. */
export const scanSystemPrinters = () =>
  invoke<SystemPrinter[]>("scan_system_printers");

/** The printers the LAN announced, waiting `timeoutSecs` (2–30). */
export const scanNetworkPrinters = (timeoutSecs?: number) =>
  invoke<DiscoveredPrinter[]>("scan_network_printers", { timeoutSecs });

/** The printers the user has saved, by name. */
export const listSavedPrinters = () =>
  invoke<SavedPrinter[]>("list_saved_printers");

/** Save or replace a saved printer; its profile must exist. */
export const savePrinter = (printer: SavedPrinter) =>
  invoke<void>("save_printer", { printer });

/** Remove a saved printer. Resolves to whether it was there. */
export const removePrinter = (name: string) =>
  invoke<boolean>("remove_printer", { name });

/** The saved templates, or none on first run. */
export const loadTemplates = () => invoke<StoredTemplate[]>("load_templates");

/** Save or replace one template. */
export const saveTemplate = (template: StoredTemplate) =>
  invoke<void>("save_template", { template });

/**
 * Delete one template by id — the local row; a published template's
 * registry copy is unpublish's business.
 */
export const deleteTemplate = (id: string) =>
  invoke<boolean>("delete_template", { id });

/** The recent jobs, newest first. */
export const loadRecentJobs = () => invoke<StoredJob[]>("load_recent_jobs");

/** Remember a job, or refresh its result when it ran again. */
export const rememberJob = (job: StoredJob) =>
  invoke<void>("remember_job", { job });

/** The saved settings, key to value. */
export const loadSettings = () =>
  invoke<Record<string, string>>("load_settings");

/** Save or replace one setting. */
export const saveSetting = (key: string, value: string) =>
  invoke<void>("save_setting", { key, value });

/** Whether the app starts with the computer. */
export const isAutostart = () => invoke<boolean>("is_autostart");

/** Turn start-with-computer on or off. */
export const setAutostart = (enabled: boolean) =>
  invoke<void>("set_autostart", { enabled });

/**
 * Open the pairing window and return the one-time code to show on the
 * screen (plan phase 8, LAN). The code is read off the screen by the
 * person pairing the device.
 */
export const beginPairing = () => invoke<string>("begin_pairing");

/** The paired devices, the order they paired in. */
export const pairedDevices = () => invoke<PairedDevice[]>("paired_devices");

/** Revoke a paired device: its token stops working at once. */
export const revokeDevice = (id: string) =>
  invoke<void>("revoke_device", { id });

/**
 * Fetch a job's data from a URL (the old app's Data URL) and hand back
 * the body text — JSON or CSV, the pipeline's call. Guarded: only
 * http/https, and no loopback, link-local or private address unless
 * the setting `data.block_private_ips` allows it.
 */
export const fetchData = (url: string, method: string) =>
  invoke<string>("fetch_data", { url, method });

/** Prepare: pick the output path, encode, render the preview. */
export const planJob = (
  template: string,
  profile: string,
  data: string,
  copies: number,
) => invoke<PrepareReport>("plan_job", { template, profile, data, copies });

/** Prepare and print, over the given transport. */
export const printJob = (
  template: string,
  profile: string,
  data: string,
  copies: number,
  transport: Transport,
) =>
  invoke<JobReport>("print_job", {
    template,
    profile,
    data,
    copies,
    transport,
  });

/**
 * The community registry (plan phase 9): accounts, the change feed's
 * local mirror, and this device's publications. The shapes mirror
 * `app/src/registry.rs` and `app/src/store.rs` field for field.
 */

/** What a status probe of the registry adds up to. */
export interface RegistryStatus {
  /** The signed-in handle, or null when signed out. */
  handle: string | null;
  /** Whether the registry answered its last probe. */
  online: boolean;
  /** Operations queued while offline. */
  pending: number;
}

/** A row of the community mirror: one published template. */
export interface CommunityTemplate {
  owner: string;
  slug: string;
  name: string;
  /** The registry's readme, as the tab shows it. */
  readme: string;
  /** "scene" or "document". */
  track: string;
  /** The template document, as JSON text. */
  template: string;
  /** The data field's starting records, as JSON text. */
  sample: string;
  /** When the registry last changed it (Unix seconds). */
  changedAt: number;
  /** Whether the signed-in account has saved it. */
  saved: boolean;
}

/** A local template's publication on the registry. */
export interface Publication {
  id: string;
  localTemplateId: string;
  owner: string;
  slug: string;
  name: string;
  readme: string;
  lastTemplate: string;
  lastSample: string;
  /** When it last went up, as Date.now() milliseconds. */
  publishedAt: number;
}

/** The browser choice shown in the Diagnostics tab. */
export interface BrowserInfo {
  mode: "system" | "managed";
  managed_path: string | null;
  version: string | null;
  system: string[];
}

/** Which browser the document track uses. */
export const browserInfo = () => invoke<BrowserInfo>("browser_info");

/** Choose the PC's browser or the downloaded Chromium. */
export const browserSelect = (mode: BrowserInfo["mode"]) =>
  invoke<void>("browser_select", { mode });

/** Download Chromium for the document track. */
export const browserDownload = () => invoke<string>("browser_download_cmd");

/** One event from the app's own log (Diagnostics tab). */
export interface AppLogEntry {
  at_ms: number;
  level: string;
  target: string;
  message: string;
}

/** The app's recent events, newest first. */
export const appLogs = () => invoke<AppLogEntry[]>("app_logs");

/** Forget the recorded events. */
export const appLogClear = () => invoke<void>("app_log_clear");

/** The registry server the app talks to, as the app resolves it. */
export const registryUrl = () => invoke<string>("registry_url");

/** Sign in on the registry — or create the account, when `create`. */
export const registryLogin = (
  handle: string,
  password: string,
  create: boolean,
) => invoke<string>("registry_login", { handle, password, create });

/** Sign out of the registry; the local queue keeps waiting. */
export const registryLogout = () => invoke<void>("registry_logout");

/** A status probe, without syncing. */
export const registryStatus = () => invoke<RegistryStatus>("registry_status");

/** The whole sync: replay the queue, push local edits, pull the feed. */
export const registryRefresh = () => invoke<RegistryStatus>("registry_refresh");

/** Queue a local template for publishing (the sync pushes it). */
export const publishTemplate = (
  localTemplateId: string,
  name: string,
  slug: string,
  readme: string,
) =>
  invoke<void>("publish_template", {
    localTemplateId,
    name,
    slug,
    readme,
  });

/** Queue a publication for removal (the sync pushes the tombstone). */
export const unpublishTemplate = (localTemplateId: string) =>
  invoke<void>("unpublish_template", { localTemplateId });

/** Save a community template to the account. */
export const saveCommunityTemplate = (owner: string, slug: string) =>
  invoke<void>("save_community_template", { owner, slug });

/** Take a community template off the account's saved list. */
export const unsaveCommunityTemplate = (owner: string, slug: string) =>
  invoke<void>("unsave_community_template", { owner, slug });

/** The community mirror, as the last sync applied it. */
export const communityTemplates = () =>
  invoke<CommunityTemplate[]>("community_templates");

/** This device's publications, the order they went up. */
export const publications = () => invoke<Publication[]>("publications");
