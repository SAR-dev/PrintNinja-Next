/**
 * M1 — the top bar's one account control. The status dot, the handle,
 * Sync, Sign in/out and the update link live in one menu, instead of a
 * coloured chip plus three buttons plus a badge crowding the bar.
 * Colour is never the only status cue: the dot has a hidden word and
 * the menu label spells the connection out.
 */
import { Download, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RegistryStatus } from "@/api";
import { openExternalUrl, useUpdateCheck } from "@/lib/appUpdate";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AccountMenuProps {
  status: RegistryStatus;
  /** A sync is in flight: the item spins and cannot be pressed again. */
  busy?: boolean;
  onSync: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AccountMenu({
  status,
  busy = false,
  onSync,
  onSignIn,
  onSignOut,
}: AccountMenuProps) {
  const { t } = useTranslation();
  const update = useUpdateCheck();
  const signedIn = status.handle != null;
  const handle = status.handle ?? t("registry.not_signed_in");
  const state = t(status.online ? "registry.online" : "registry.offline");
  const pending =
    status.pending > 0
      ? ` · ${t("registry.waiting", { count: status.pending })}`
      : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t("registry.account_menu")} — ${state}`}
          className="flex h-control items-center gap-2 rounded-md px-1.5 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-accent-foreground">
            {signedIn ? (
              handle.slice(0, 1).toUpperCase()
            ) : (
              <UserRound aria-hidden="true" className="h-4 w-4" />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card",
                status.online ? "bg-success" : "bg-danger",
              )}
            />
          </span>
          <span className="hidden max-w-24 truncate text-caption text-muted-foreground sm:inline">
            {handle}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="min-w-0 font-normal">
          <span className="block truncate text-sm font-semibold">{handle}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                status.online ? "bg-success" : "bg-danger",
              )}
            />
            {state}
            {pending}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSync()} disabled={busy}>
          <RefreshCw
            aria-hidden="true"
            className={cn(busy && "motion-safe:animate-spin")}
          />
          {busy ? t("registry.syncing") : t("registry.sync")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => (signedIn ? onSignOut() : onSignIn())}
        >
          {signedIn ? (
            <LogOut aria-hidden="true" />
          ) : (
            <LogIn aria-hidden="true" />
          )}
          {signedIn ? t("registry.sign_out") : t("registry.sign_in")}
        </DropdownMenuItem>
        {update.available && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void openExternalUrl(update.url)}>
              <Download aria-hidden="true" />
              {t("update.available", { version: update.version })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
