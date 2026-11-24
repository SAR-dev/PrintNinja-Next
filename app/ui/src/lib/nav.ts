/**
 * The top-level destinations, one item each. The contextual views
 * (print, edit) keep their parent's item active.
 */
import {
  Globe,
  History,
  Library,
  Printer,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "templates"
  | "jobs"
  | "printers"
  | "community"
  | "settings";

export interface NavItem {
  key: NavKey;
  icon: LucideIcon;
  /** The i18n key of the item's label. */
  labelKey: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "templates", icon: Library, labelKey: "nav.templates" },
  { key: "jobs", icon: History, labelKey: "nav.jobs" },
  { key: "printers", icon: Printer, labelKey: "nav.printers" },
  { key: "community", icon: Globe, labelKey: "nav.community" },
  { key: "settings", icon: Settings, labelKey: "nav.settings" },
];
