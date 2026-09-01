import { cn } from "@/lib/utils";
import { STUCK_BATCH_LABEL } from "@/lib/copy";

export { STUCK_BATCH_LABEL };

export function StuckBatchHeading({
  count,
  onClick,
  className,
}: {
  count: number;
  onClick?: () => void;
  className?: string;
}) {
  if (count <= 0) return null;

  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2",
        onClick && "cursor-pointer text-left transition-opacity hover:opacity-90",
        className,
      )}
    >
      <span className="inline-flex size-1.5 shrink-0 rounded-full bg-destructive shadow-[0_0_0_3px_rgba(251,113,133,0.12)]" />
      <span className="type-section">
        {STUCK_BATCH_LABEL}
        <span className="font-normal text-muted-foreground"> · {count} ชุด</span>
      </span>
    </Tag>
  );
}
