/**
 * The Jobs destination (plan P3): the recent prints, newest first.
 * What used to sit under the template list as a footnote; a reprint
 * re-sends the job's frozen template, data and transport.
 */
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { JobResultBadge } from "@/components/status-badge";
import i18n from "@/lib/i18n";
import type { RecentJob } from "@/templates";

function jobTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? i18n.t("recent.today", { time: hm })
    : i18n.t("recent.day", { date: d.toLocaleDateString(), time: hm });
}

export function JobsScreen({
  recent,
  reprintingId,
  onReprint,
  onOpenTemplate,
}: {
  recent: RecentJob[];
  /** The job whose reprint is running, if any. */
  reprintingId: string | null;
  onReprint: (job: RecentJob) => void;
  onOpenTemplate: (job: RecentJob) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("recent.title")} description={t("recent.note")} />

      {recent.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-body text-muted-foreground">
          {t("recent.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((j) => {
            const busy = reprintingId === j.id;
            const failed =
              j.result.result === "failed" ||
              j.result.result === "wrong_mode_suspected";
            const actions: ActionItem[] = [
              {
                label: busy ? t("recent.printing") : t("recent.reprint"),
                icon: "print",
                disabled: busy,
                onSelect: () => onReprint(j),
              },
              {
                label: t("recent.retry"),
                icon: "sync",
                disabled: !failed,
                onSelect: () => onReprint(j),
              },
              {
                label: t("recent.open_template"),
                icon: "edit",
                onSelect: () => onOpenTemplate(j),
              },
              {
                label: t("recent.copy_reason"),
                icon: "add",
                disabled: !j.result.reason,
                separator: true,
                onSelect: () => {
                  void navigator.clipboard
                    .writeText(j.result.reason ?? t("recent.no_reason"))
                    .then(() => toast.success(t("recent.reason_copied")));
                },
              },
            ];
            return (
              <div
                key={j.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body font-medium">
                    {j.templateName}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {jobTime(j.at)} · {t("recent.copies", { count: j.copies })}{" "}
                    · {j.profile}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <JobResultBadge result={j.result.result} />
                  {j.result.result === "partially_printed" &&
                    j.result.counts && (
                      <span className="text-caption text-muted-foreground">
                        {t("recent.partial", {
                          printed: j.result.counts[0],
                          total: j.result.counts[1],
                        })}
                      </span>
                    )}
                  <ActionMenu items={actions} label={t("common.more")} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
