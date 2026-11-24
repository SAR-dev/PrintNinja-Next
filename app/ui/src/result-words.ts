/**
 * The tone half of the job result vocabulary (plan §5.7) — one map,
 * shared by the print screen's result card and the recent-jobs list.
 * The words live in the i18n catalog (`result.*`); the display word
 * comes from `t("result." + result)` at the call site.
 */
const RESULT_TONES: Record<string, "success" | "warning" | "danger"> = {
  confirmed: "success",
  sent_unconfirmed: "warning",
  partially_printed: "warning",
  failed: "danger",
  wrong_mode_suspected: "danger",
};

/** The tone of a result word; an unknown result gets the danger tone. */
export function resultTone(result: string): "success" | "warning" | "danger" {
  return RESULT_TONES[result] ?? "danger";
}

/** The tone's soft-background classes, for a result chip. */
export function toneClass(tone: "success" | "warning" | "danger"): string {
  return tone === "success"
    ? "bg-success-soft text-success"
    : tone === "warning"
      ? "bg-warning-soft text-warning"
      : "bg-danger-soft text-danger";
}
