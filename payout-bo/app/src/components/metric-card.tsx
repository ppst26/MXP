import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
