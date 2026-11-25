/**
 * The phone's bottom tab bar (plan P3): the five destinations, an
 * icon above a short label, the active one filled. It is off on
 * contextual screens (their parent's destination stays highlighted)
 * and while a text field has focus — the keyboard owns the bottom of
 * the screen then.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NAV_ITEMS, navIcon, type NavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

function isField(e: Event): boolean {
  return (
    e.target instanceof HTMLElement &&
    e.target.closest("input, textarea, select") !== null
  );
}

export function BottomNav({
  active,
  onNavigate,
  hidden = false,
}: {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  /** True on contextual screens, where the bar is off. */
  hidden?: boolean;
}) {
  const { t } = useTranslation();
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const onIn = (e: Event) => {
      if (isField(e)) setTyping(true);
    };
    const onOut = (e: FocusEvent) => {
      if (!isField(e)) return;
      const next = e.relatedTarget;
      if (
        !(next instanceof HTMLElement) ||
        next.closest("input, textarea, select") === null
      ) {
        setTyping(false);
      }
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  if (hidden || typing) return null;

  return (
    <nav
      aria-label={t("nav.aria")}
      className="flex shrink-0 border-t border-border/70 bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-10px_hsl(var(--foreground)/0.18)] md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = navIcon(item);
        const isActive = active === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onNavigate(item.key)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-14 flex-1 flex-col items-center justify-center gap-0.5",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span
              className={cn("rounded-lg px-3 py-0.5", isActive && "bg-accent")}
            >
              <Icon aria-hidden="true" className="size-6" />
            </span>
            <span className="text-caption">{t(item.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
