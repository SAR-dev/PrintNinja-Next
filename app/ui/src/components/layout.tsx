/**
 * The app shell: a top bar with the brand and the account's
 * indicators, a collapsible sidebar on the left on the PC, a bottom
 * tab bar on the phone (plan P3 — the old strip under the top bar is
 * gone), and the content scroller the page headers stick to. The view
 * state machine stays in App; the shell only knows which nav item is
 * active and whether the view is contextual.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getAppVersion } from "@/lib/appUpdate";
import { icons } from "@/lib/icons";
import { NAV_ITEMS, navIcon, type NavItem, type NavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { BottomNav } from "./bottom-nav";

const SIDEBAR_KEY = "printninja-sidebar-collapsed";

/** PC sidebar groups. Settings is not a group: it is pinned below them. */
const SIDEBAR_GROUPS: { labelKey: string; keys: NavKey[] }[] = [
  { labelKey: "nav.group_workspace", keys: ["templates", "jobs"] },
  { labelKey: "nav.group_resources", keys: ["printers", "community"] },
];

/** One sidebar row: icon, label and an optional count (jobs, saved). */
function SidebarButton({
  item,
  active,
  collapsed,
  count,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  count?: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon = navIcon(item);
  const label = t(item.labelKey);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex h-control w-full items-center gap-3 rounded-lg px-2.5 text-sm transition-colors",
        collapsed && "justify-center px-0",
        active
          ? // The open sheet: white paper on the desk, with a brand tick.
            "bg-card font-medium text-foreground shadow-card before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
          : "text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("h-4 w-4 shrink-0", active && "text-primary")}
      />
      {!collapsed && <span className="truncate">{label}</span>}
      {count != null && count > 0 && (
        <span
          className={cn(
            "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/[0.07] px-1.5 text-caption tabular-nums text-muted-foreground",
            collapsed && "absolute top-0 right-0 h-4 min-w-4 px-0.5",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface LayoutProps {
  /** The nav key of the current view (contextual views keep their
   * parent's key). */
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  /** The top bar's right side (the account menu). */
  topbar?: ReactNode;
  /** Small counts on the PC sidebar rows (jobs, saved community). */
  counts?: Partial<Record<NavKey, number>>;
  /** True on contextual screens (print, edit): the phone's bottom
   * tab bar is off, the parent's destination stays highlighted. */
  contextual?: boolean;
  children: ReactNode;
}

export function Layout({
  active,
  onNavigate,
  topbar,
  counts,
  contextual = false,
  children,
}: LayoutProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [version, setVersion] = useState("");
  const settings = NAV_ITEMS.find((item) => item.key === "settings")!;

  useEffect(() => {
    let alive = true;
    void getAppVersion().then((v) => {
      if (alive && v && v !== "0.0.0") setVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    } catch {
      // Remembering failed; the sidebar still works this session.
    }
  }, [collapsed]);

  return (
    <div className="flex h-dvh-safe flex-col overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t("nav.skip")}
      </a>

      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-chrome px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-control">
            <icons.brand aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="truncate text-base font-semibold tracking-[-0.02em]">
            {t("app.title")}
          </span>
          {version !== "" && (
            <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
              v{version}
            </span>
          )}
        </div>
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 md:gap-2">
          {topbar}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r border-border/70 bg-chrome transition-[width] duration-150 md:flex",
            collapsed ? "w-14" : "w-56",
          )}
        >
          <nav
            aria-label={t("nav.aria")}
            className="flex-1 space-y-1 overflow-y-auto p-2"
          >
            {SIDEBAR_GROUPS.map((group, i) => (
              <div key={group.labelKey} className="space-y-1">
                {collapsed ? (
                  i > 0 && <div className="mx-1 border-t" />
                ) : (
                  <p className="px-2.5 pb-0.5 pt-3 text-caption font-semibold text-muted-foreground">
                    {t(group.labelKey)}
                  </p>
                )}
                {group.keys.map((key) => {
                  const item = NAV_ITEMS.find((n) => n.key === key)!;
                  return (
                    <SidebarButton
                      key={key}
                      item={item}
                      active={active === key}
                      collapsed={collapsed}
                      count={counts?.[key]}
                      onClick={() => onNavigate(key)}
                    />
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="space-y-1 border-t border-border/70 p-2">
            <SidebarButton
              item={settings}
              active={active === "settings"}
              collapsed={collapsed}
              onClick={() => onNavigate("settings")}
            />
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
              className={cn(
                "flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-sm text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              <icons.collapse
                aria-hidden="true"
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform duration-150",
                  !collapsed && "rotate-180",
                )}
              />
              {!collapsed && (
                <span className="truncate">{t("nav.collapse")}</span>
              )}
            </button>
          </div>
        </aside>

        <main
          id="main"
          data-slot="app-main"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto focus:outline-none"
        >
          <div
            data-slot="app-content"
            className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 md:px-6 md:py-5"
          >
            {children}
          </div>
        </main>
      </div>

      <BottomNav active={active} onNavigate={onNavigate} hidden={contextual} />
    </div>
  );
}
