import { Badge } from "@/components/ui/badge";
import { statusLabel, statusPillClass } from "./status";

const pillToVariant = {
  ok: "success",
  warn: "warning",
  alert: "destructive",
  info: "outline",
  review: "review",
  muted: "secondary",
  orange: "warning",
} as const;

export function StatusPill({ status }: { status: string }) {
  const pill = statusPillClass(status) as keyof typeof pillToVariant;
  return <Badge variant={pillToVariant[pill] ?? "secondary"}>{statusLabel(status)}</Badge>;
}
