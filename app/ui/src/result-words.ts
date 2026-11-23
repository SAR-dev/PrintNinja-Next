/**
 * The job result vocabulary (plan §5.7) in the words and tones the UI
 * shows — one map, shared by the print screen's result card and the
 * recent-jobs list.
 */
export const RESULT_WORDS: Record<
  string,
  { word: string; tone: "success" | "warning" | "danger" }
> = {
  confirmed: { word: "Confirmed", tone: "success" },
  sent_unconfirmed: { word: "Sent, not confirmed", tone: "warning" },
  partially_printed: { word: "Partially printed", tone: "warning" },
  failed: { word: "Failed", tone: "danger" },
  wrong_mode_suspected: { word: "Wrong mode suspected", tone: "danger" },
};

/** The tone's soft-background classes, for a result chip. */
export function toneClass(tone: "success" | "warning" | "danger"): string {
  return tone === "success"
    ? "bg-success-soft text-success"
    : tone === "warning"
      ? "bg-warning-soft text-warning"
      : "bg-danger-soft text-danger";
}
