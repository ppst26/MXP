  import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { CircleHelp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Zone({
  title,
  extra,
  children,
  plain,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  plain?: boolean;
}) {
  if (plain) {
    return (
      <section className="flex flex-col gap-3">
        <div className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardDescription>{title}</CardDescription>
          {extra}
        </div>
        <div className="flex flex-col gap-3">{children}</div>
      </section>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b">
        <CardDescription>{title}</CardDescription>
        {extra}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-4">{children}</CardContent>
    </Card>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  accent,
  onClick,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
  onClick?: () => void;
  tone?: "warn" | "alert" | "quiet";
}) {
  return (
    <Card
      size="sm"
      role={onClick ? "button" : undefined}
      onClick={onClick}
      data-tone={tone}
      className={cn(
        onClick && "cursor-pointer",
        accent && "ring-primary/40",
        tone === "warn" && "ring-warning/40",
        tone === "alert" && "ring-destructive/40",
      )}
    >
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("text-xl tracking-tight", tone === "quiet" && "text-muted-foreground")}>{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
}

export function KpiTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="absolute right-2 top-2.5 rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="รายละเอียด"
        >
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-[260px] flex-col items-start gap-1 py-2 text-left leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

const SummaryMetricLayoutContext = createContext<"wrap" | "grid">("wrap");

export function SummaryMetricGrid({ children, cols }: { children: ReactNode; cols?: 5 | 6 | 7 }) {
  const layout = cols ? "grid" : "wrap";
  return (
    <SummaryMetricLayoutContext.Provider value={layout}>
      <div
        className={cn(
          "gap-2",
          cols === 7 && "grid grid-cols-7",
          cols === 6 && "grid grid-cols-6",
          cols === 5 && "grid grid-cols-5",
          !cols && "flex flex-wrap",
        )}
      >
        {children}
      </div>
    </SummaryMetricLayoutContext.Provider>
  );
}

export function SummaryMetricCard({
  label,
  value,
  hint,
  footer,
  tooltip,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  footer?: ReactNode;
  tooltip?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  const layout = useContext(SummaryMetricLayoutContext);

  return (
    <Card
      size="sm"
      className={cn(
        "relative py-0",
        layout === "grid" ? "min-w-0" : "min-w-[128px] flex-1 basis-[calc(50%-0.25rem)] sm:min-w-[140px] sm:basis-[calc(33.333%-0.34rem)] lg:basis-[calc(16.666%-0.42rem)]",
        accent && "bg-primary/5 ring-primary/40",
        className,
      )}
    >
      {tooltip ? <KpiTooltip content={tooltip} /> : null}
      <CardContent className={cn("py-3", tooltip && "pr-7")}>
        <p className="text-[11px] leading-snug text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{value}</p>
        {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
        {footer ? <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
