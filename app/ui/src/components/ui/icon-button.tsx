/**
 * An icon-only action: a fixed h-control/w-control hit area, an
 * aria-label for assistive tech, and a tooltip for everyone else. Use
 * this instead of a bare `<Button size="icon">` so an icon can never
 * ship without a name.
 */
import * as React from "react";
import { icons, type IconName } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

export interface IconButtonProps
  extends Omit<ButtonProps, "children" | "size"> {
  /** The semantic icon name from the registry. */
  icon: IconName;
  /** Accessible name and tooltip text — always required. */
  label: string;
  side?: "top" | "right" | "bottom" | "left";
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, side = "top", className, ...props }, ref) => {
    const Icon = icons[icon];
    return (
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={ref}
              type="button"
              size="icon"
              aria-label={label}
              className={cn("h-control w-control", className)}
              {...props}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side}>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);
IconButton.displayName = "IconButton";

export { IconButton };
