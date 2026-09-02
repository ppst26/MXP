import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FocusRow({
  title,
  sub,
  count,
  tone = "default",
  icon,
  onClick,
  className,
}: {
  title: string;
  sub: string;
  count: ReactNode;
  tone?: "default" | "warn" | "alert" | "quiet";
  icon: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "surface-nested grid h-full min-h-0 w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-sm border border-foreground/10 p-4 text-left transition-colors hover:bg-foreground/3",
        onClick && "cursor-pointer",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-md bg-muted text-foreground/90",
          tone === "warn" && "bg-warning/10 text-warning",
          tone === "alert" && "bg-destructive/10 text-destructive",
          tone === "quiet" && "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-xs text-foreground/90", tone === "quiet" && "text-muted-foreground")}>{title}</span>
        <span className="type-label block truncate">{sub}</span>
      </span>
      <span className={cn("text-sm font-semibold tabular-nums tracking-tight", tone === "quiet" && "text-muted-foreground")}>{count}</span>
    </button>
  );
}
