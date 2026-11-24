/**
 * The sticky page header: the page's title, its description, and its
 * actions in one row. It sticks to the top of the content scroller
 * ([data-slot="app-main"]) and, once the page has scrolled, it shrinks
 * and lets the description go — the old app's page header, ported.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** The page's action controls; the primary action goes last. */
  children?: ReactNode;
  className?: string;
  /** Renders an icon-only back button before the title. */
  back?: { onClick: () => void; label: string };
}

export function PageHeader({
  title,
  description,
  children,
  className,
  back,
}: PageHeaderProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>(
      "[data-slot='app-main']",
    );
    if (!scroller) return;
    const onScroll = () => setScrolled(scroller.scrollTop > 8);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      ref={rootRef}
      className={cn(
        "sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-4 transition-[padding] duration-150 max-md:gap-y-3.5 max-md:border-b-0 max-md:pb-0 md:-mx-6 md:flex-row md:flex-nowrap md:items-end md:justify-between md:gap-3 md:px-6",
        scrolled ? "py-2" : "pb-3 pt-0 md:pb-4",
        className,
      )}
    >
      {back && (
        <Button
          variant="ghost"
          size="icon"
          onClick={back.onClick}
          aria-label={back.label}
          className="-ml-2 shrink-0"
        >
          <ArrowLeft className="size-5" />
        </Button>
      )}
      <h1 className="min-w-0 truncate text-xl font-semibold leading-tight tracking-tight max-md:text-2xl max-md:font-bold max-md:leading-[1.1] max-md:tracking-[-0.03em]">
        {title}
      </h1>
      {description !== undefined && !scrolled && (
        <p className="hidden max-w-prose text-sm text-muted-foreground md:block">
          {description}
        </p>
      )}
      {children !== undefined && children !== null && (
        <div
          data-slot="page-actions"
          className="flex flex-wrap items-center gap-2"
        >
          {children}
        </div>
      )}
    </header>
  );
}
