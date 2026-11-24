/**
 * The sidebar's navigation: one item per top-level view. The
 * contextual views (print, edit) keep their parent's item active.
 */
import { Library, Settings, type LucideIcon } from "lucide-react";

export type NavKey = "templates" | "settings";

export interface NavItem {
  key: NavKey;
  icon: LucideIcon;
  /** The i18n key of the item's label. */
  labelKey: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "templates", icon: Library, labelKey: "nav.templates" },
  { key: "settings", icon: Settings, labelKey: "nav.settings" },
];
