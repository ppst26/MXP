import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { CircleHelp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function MetricLabel({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <span className="type-label inline-flex items-center gap-1.5 leading-snug">
      {icon ? <span className="shrink-0 text-foreground/55 [&>svg]:size-3.5">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}

export function Zone({
  title,
  extra,
  toolbar,
  children,
  plain,
  className,
  titleClassName,
}: {
  title: string;
  extra?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  plain?: boolean;
  className?: string;
  titleClassName?: string;
}) {
  const heading = (
    <>
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <h2 className={cn(titleClassName ?? "type-section", "text-foreground")}>{title}</h2>
        {extra}
      </div>
      {toolbar}
    </>
  );
  if (plain) {
    return (
      <section className={cn("flex flex-col gap-3", className)}>
        {heading}
        <div className="flex flex-col gap-3">{children}</div>
      </section>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 border-b">
        {heading}
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
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
  onClick?: () => void;
  tone?: "warn" | "alert" | "quiet";
  icon?: ReactNode;
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
        <CardDescription className="leading-snug">
          <MetricLabel icon={icon} label={label} />
        </CardDescription>
        <p className={cn("type-kpi", tone === "quiet" && "text-muted-foreground")}>{value}</p>
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

export function SummaryMetricGrid({ children, cols }: { children: ReactNode; cols?: 4 | 5 | 6 | 7 }) {
  const layout = cols ? "grid" : "wrap";
  return (
    <SummaryMetricLayoutContext.Provider value={layout}>
      <div
        className={cn(
          "gap-2",
          cols === 7 && "grid grid-cols-7",
          cols === 6 && "grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
          cols === 5 && "grid grid-cols-5",
          cols === 4 && "grid grid-cols-2 sm:grid-cols-4",
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
  valueClassName,
  onClick,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  footer?: ReactNode;
  tooltip?: ReactNode;
  accent?: boolean;
  className?: string;
  valueClassName?: string;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  const layout = useContext(SummaryMetricLayoutContext);

  return (
    <Card
      size="sm"
      role={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "relative py-0",
        layout === "grid" ? "min-w-0" : "min-w-[128px] flex-1 basis-[calc(50%-0.25rem)] sm:min-w-[140px] sm:basis-[calc(33.333%-0.34rem)] lg:basis-[calc(16.666%-0.42rem)]",
        accent && "ring-primary/40",
        onClick && "cursor-pointer transition-colors hover:bg-muted/20",
        className,
      )}
    >
      {tooltip ? <KpiTooltip content={tooltip} /> : null}
      <CardContent className={cn("py-3", tooltip && "pr-7")}>
        <MetricLabel icon={icon} label={label} />
        <p className={cn("type-kpi mt-1", valueClassName)}>{value}</p>
        {hint ? <p className="type-label mt-1 leading-snug">{hint}</p> : null}
        {footer ? <div className="type-label mt-1 leading-snug">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
