import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "@/lib/sort";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  sortKey: string;
  activeKey: string | null;
  direction: SortDir;
  onSort: (key: string) => void;
  className?: string;
};

export function SortableTh({ label, sortKey, activeKey, direction, onSort, className }: Props) {
  const active = activeKey === sortKey;
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 font-inherit hover:text-foreground"
      >
        <span>{label}</span>
        <Icon className={cn("size-3 shrink-0", active ? "text-foreground" : "text-muted-foreground/45")} />
      </button>
    </th>
  );
}
