/**
 * The top-level destinations, one item each. The contextual views
 * (print, edit) keep their parent's item active. Icons are names from
 * the registry, so the shell and bottom bar resolve the same glyph.
 */
import { icons, type IconName } from "@/lib/icons";

export type NavKey =
  | "templates"
  | "jobs"
  | "printers"
  | "community"
  | "settings";

export interface NavItem {
  key: NavKey;
  icon: IconName;
  /** The i18n key of the item's label. */
  labelKey: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "templates", icon: "templates", labelKey: "nav.templates" },
  { key: "jobs", icon: "jobs", labelKey: "nav.jobs" },
  { key: "printers", icon: "printers", labelKey: "nav.printers" },
  { key: "community", icon: "community", labelKey: "nav.community" },
  { key: "settings", icon: "settings", labelKey: "nav.settings" },
];

/** The lucide component for a nav item's registry name. */
export function navIcon(item: NavItem) {
  return icons[item.icon];
}
