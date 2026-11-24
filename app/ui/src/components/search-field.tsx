/**
 * Q3 — a top-bar search field, not a command palette. Typing filters
 * the Templates destination; it never launches an action.
 */
import { icons } from "@/lib/icons";

export function SearchField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative hidden md:block">
      <icons.search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-control w-48 rounded-md border border-input bg-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring lg:w-64"
      />
    </div>
  );
}
