import type { ReactNode } from "react";
import { BATCH_STATUSES, batchLabel } from "../../lib/status";
import { useFilters } from "../../state/FilterProvider";
import type { DatePreset } from "../../lib/bangkok";
import { DateRangePicker } from "../../layout/DateRangePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PRESETS: [DatePreset, string][] = [
  ["today", "วันนี้"],
  ["yesterday", "เมื่อวาน"],
  ["d7", "7 วัน"],
  ["d14", "14 วัน"],
  ["d30", "ทั้งเดือน"],
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="type-label">{label}</Label>
      {children}
    </div>
  );
}

export function BatchFilterBar() {
  const { filters, setFilters, setPreset } = useFilters();

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <Field label="สถานะชุด">
          <Select
            value={filters.batchStatus || "all"}
            onValueChange={(v) => setFilters({ batchStatus: v === "all" ? "" : v })}
          >
            <SelectTrigger size="sm" className="w-[148px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">ทั้งหมด</SelectItem>
                {BATCH_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {batchLabel(s)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="id / เลขออเดอร์ / package">
          <Input
            className="h-8 w-[220px] sm:w-[260px]"
            value={filters.batchQ}
            placeholder="ค้นหา…"
            onChange={(e) => setFilters({ batchQ: e.target.value })}
          />
        </Field>
        <Field label="ค้างเกินเกณฑ์">
          <Select
            value={filters.batchStuck ? "1" : "all"}
            onValueChange={(v) => setFilters({ batchStuck: v === "1" })}
          >
            <SelectTrigger size="sm" className="w-[168px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">ทั้งหมด</SelectItem>
                <SelectItem value="1">เฉพาะค้าง / รอคนดู</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-end justify-end gap-2 sm:gap-3">
        <Field label="ช่วง">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={filters.preset}
            onValueChange={(v) => {
              if (v) setPreset(v as DatePreset);
            }}
          >
            {PRESETS.map(([id, t]) => (
              <ToggleGroupItem key={id} value={id}>
                {t}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label="จาก–ถึง">
          <DateRangePicker />
        </Field>
      </div>
    </div>
  );
}
