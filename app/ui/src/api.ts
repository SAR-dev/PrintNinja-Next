/**
 * The typed bridge to the Rust core. One file, three commands
 * (plan phase 7): list the printers, prepare a job, print a job.
 * The shapes mirror `app/src/pipeline.rs` field for field — when the
 * Rust side changes, this file must change with it.
 */
import { invoke } from "@tauri-apps/api/core";

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
}

/** The preview the prepared job carries (plan §3.4). */
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
  preview: Preview | null;
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

export const listPrinters = () => invoke<ProfileInfo[]>("list_printers");

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
