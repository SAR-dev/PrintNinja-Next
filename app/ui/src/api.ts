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

export const listPrinters = () => invoke<ProfileInfo[]>("list_printers");

/** The saved templates, or none on first run. */
export const loadTemplates = () => invoke<StoredTemplate[]>("load_templates");

/** Save or replace one template. */
export const saveTemplate = (template: StoredTemplate) =>
  invoke<void>("save_template", { template });

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
