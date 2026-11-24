/**
 * The app's overflow menu (plan §3.5): a labelled icon trigger and a
 * list of named actions. Components pass semantic items; a `danger`
 * item is tinted as destructive, and callers can control `open` to
 * open the same menu from a right-click on PC.
 */
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { icons, type IconName } from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { IconButton } from "./icon-button";

export interface ActionItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** A destructive action — tinted red in the menu. */
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item. */
  separator?: boolean;
}

export interface ActionMenuProps {
  items: ActionItem[];
  /** Accessible name of the default ⋯ trigger. */
  label?: string;
  /** Replace the default ⋯ trigger (e.g. a split button's chevron). */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
}

export function ActionMenu({
  items,
  label,
  trigger,
  open,
  onOpenChange,
  align = "end",
}: ActionMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <IconButton
            icon="more"
            label={label ?? t("common.more")}
            variant="ghost"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map((item) => {
          const Icon = item.icon ? icons[item.icon] : null;
          return (
            <Fragment key={item.label}>
              {item.separator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => item.onSelect()}
                disabled={item.disabled}
                className={cn(
                  item.danger &&
                    "text-danger focus:bg-danger-soft focus:text-danger",
                )}
              >
                {Icon && <Icon aria-hidden="true" />}
                {item.label}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
