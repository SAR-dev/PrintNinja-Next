/**
 * Q3 — a top-bar search field, not a command palette. Typing filters
 * the Templates destination; it never launches an action. Ctrl/Cmd+K
 * focuses it; Escape clears it.
 */
import { useEffect, useRef } from "react";
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (
        e.key === "Escape" &&
        document.activeElement === inputRef.current
      ) {
        onChange("");
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onChange]);
  return (
    <div className="relative hidden md:block">
      <icons.search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-control w-48 rounded-lg border border-input bg-card pr-2 pl-8 text-sm shadow-field outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring lg:w-64"
      />
    </div>
  );
}
