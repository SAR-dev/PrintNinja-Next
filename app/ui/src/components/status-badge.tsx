/**
 * Status badges — the small tone-and-icon chips the old app used in
 * its top bar and lists. Two vocabularies: the app's named statuses
 * (online, offline, queued, …) and the pipeline's job results
 * (plan §5.7: confirmed, sent_unconfirmed, partially_printed,
 * failed, wrong_mode_suspected). Unknown values render as a bare
 * neutral chip, never a crash.
 */
import { useTranslation } from "react-i18next";
import { icons, type IconName } from "@/lib/icons";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-neutral",
};

interface StatusDef {
  tone: StatusTone;
  icon: IconName;
  label: string;
  spin?: boolean;
}

/** The app's named statuses: the registry's reach, a job's life,
 * a sync in flight, a template's publication. */
export const STATUS = {
  online: { tone: "success", icon: "online", label: "Online", spin: false },
  offline: { tone: "danger", icon: "offline", label: "Offline", spin: false },
  queued: { tone: "warning", icon: "queued", label: "Queued", spin: false },
  running: { tone: "info", icon: "running", label: "Printing", spin: true },
  cancelled: {
    tone: "neutral",
    icon: "cancelled",
    label: "Cancelled",
    spin: false,
  },
  syncing: { tone: "info", icon: "syncing", label: "Syncing", spin: true },
  published: {
    tone: "success",
    icon: "published",
    label: "Published",
    spin: false,
  },
} as const satisfies Record<string, StatusDef>;

export type StatusKey = keyof typeof STATUS;

export function isStatusKey(value: string): value is StatusKey {
  return Object.prototype.hasOwnProperty.call(STATUS, value);
}

/** The pipeline's job results (plan §5.7) with their tone and icon. */
export const RESULT = {
  confirmed: { tone: "success", icon: "confirmed" },
  sent_unconfirmed: { tone: "warning", icon: "sent_unconfirmed" },
  partially_printed: { tone: "warning", icon: "partially_printed" },
  failed: { tone: "danger", icon: "failed" },
  wrong_mode_suspected: { tone: "danger", icon: "wrong_mode_suspected" },
} as const satisfies Record<string, { tone: StatusTone; icon: IconName }>;

export type ResultKey = keyof typeof RESULT;

export function isResultKey(value: string): value is ResultKey {
  return Object.prototype.hasOwnProperty.call(RESULT, value);
}

interface BadgeBaseProps {
  /** Overrides the default word. */
  label?: string;
  /** Compact: the icon stands in for the word on small screens. */
  compact?: boolean;
  className?: string;
}

function BadgeBase({
  tone,
  icon: name,
  label,
  compact,
  spin,
  data,
  className,
}: BadgeBaseProps & {
  tone: StatusTone;
  icon: IconName;
  spin?: boolean;
  data: string;
}) {
  const Icon = icons[name];
  return (
    <span
      data-status={data}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-caption font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          spin && "motion-safe:animate-spin",
        )}
      />
      {compact ? <span className="hidden sm:inline">{label}</span> : label}
    </span>
  );
}

/** A badge for a named app status (online, offline, queued, …). */
export function StatusBadge({
  status,
  label,
  compact,
  className,
}: { status: StatusKey } & BadgeBaseProps) {
  const { t } = useTranslation();
  const def = STATUS[status];
  return (
    <BadgeBase
      tone={def.tone}
      icon={def.icon}
      spin={def.spin}
      data={status}
      label={label ?? t(`status.${status}`, { defaultValue: def.label })}
      compact={compact}
      className={className}
    />
  );
}

/** A badge for a job's result; an unknown value renders as a bare
 * neutral chip. */
export function JobResultBadge({
  result,
  label,
  compact,
  className,
}: { result: string } & BadgeBaseProps) {
  const { t } = useTranslation();
  if (isResultKey(result)) {
    const def = RESULT[result];
    return (
      <BadgeBase
        tone={def.tone}
        icon={def.icon}
        data={result}
        label={label ?? t(`result.${result}`)}
        compact={compact}
        className={className}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-sm bg-neutral-soft px-2 py-0.5 text-caption font-medium text-neutral",
        className,
      )}
    >
      {result}
    </span>
  );
}
