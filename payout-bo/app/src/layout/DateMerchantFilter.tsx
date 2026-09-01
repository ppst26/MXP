import { useMemo, useState, type ReactNode } from "react";
import { MERCHANTS } from "../mock/seed";
import { merchById, MOCK_DIRECT_USER } from "../mock/query";
import { useFilters } from "../state/FilterProvider";
import { useViewer } from "../state/use-viewer";
import type { DatePreset } from "../lib/bangkok";
import type { Route } from "../mock/types";
import { DateRangePicker } from "./DateRangePicker";
import { Button } from "@/components/ui/button";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const PRESETS: [DatePreset, string][] = [
  ["today", "วันนี้"],
  ["yesterday", "เมื่อวาน"],
  ["d7", "7 วัน"],
  ["d14", "14 วัน"],
  ["d30", "ทั้งเดือน"],
];

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="type-label">{label}</Label>
      {children}
    </div>
  );
}

export function DateMerchantFilter({ extra }: { extra?: ReactNode }) {
  const { isAdmin } = useViewer();
  const { filters, setFilters, setPreset } = useFilters();
  const [open, setOpen] = useState(false);
  const locked = merchById(MOCK_DIRECT_USER);
  const selected = merchById(filters.merchantId);
  const label = selected
    ? selected.role === "RESELLER"
      ? `${selected.name} (ทั้งสาย)`
      : `${selected.name} · ${selected.code}`
    : "ทุกร้าน";
  const resellers = useMemo(() => MERCHANTS.filter((m) => m.role === "RESELLER"), []);

  const merchant = isAdmin ? (
    <FilterField label="ร้าน · เลือกโหนด = ทั้งสาย">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-[220px] justify-between gap-2">
            <span className="truncate">{label}</span>
            <span className="shrink-0 text-muted-foreground">▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="ค้นหาชื่อหรือรหัส" />
            <CommandList>
              <CommandEmpty>ไม่พบร้าน</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="ทุกร้าน"
                  data-checked={!filters.merchantId}
                  onSelect={() => {
                    setFilters({ merchantId: "", listPage: 1 });
                    setOpen(false);
                  }}
                >
                  ทุกร้าน
                </CommandItem>
              </CommandGroup>
              {resellers.map((r) => {
                const kids = MERCHANTS.filter((m) => m.parentId === r.id);
                return (
                  <CommandGroup key={r.id} heading={r.name}>
                    <CommandItem
                      value={`${r.name} ${r.code} ทั้งสาย`}
                      data-checked={filters.merchantId === r.id}
                      onSelect={() => {
                        setFilters({ merchantId: r.id, listPage: 1 });
                        setOpen(false);
                      }}
                    >
                      {r.name} (ทั้งสาย) · {r.code}
                    </CommandItem>
                    {kids.map((k) => (
                      <CommandItem
                        key={k.id}
                        value={`${k.name} ${k.code} ${r.name}`}
                        data-checked={filters.merchantId === k.id}
                        onSelect={() => {
                          setFilters({ merchantId: k.id, listPage: 1 });
                          setOpen(false);
                        }}
                      >
                        {k.name} · {k.code}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FilterField>
  ) : (
    <FilterField label="ร้าน">
      <Input disabled className="w-[220px]" value={`${locked?.name ?? "Acme"} · ${locked?.code ?? "ACME"}`} />
    </FilterField>
  );

  const period = (
    <>
      <FilterField label="ช่วง">
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
      </FilterField>
      <FilterField label="เส้นทาง">
        <Select
          value={filters.route || "all"}
          onValueChange={(v) => setFilters({ route: (v === "all" ? "" : v) as "" | Route, listPage: 1 })}
        >
          <SelectTrigger size="sm" className="w-[112px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">ทั้งหมด</SelectItem>
              <SelectItem value="SAME_BANK">ในธนาคาร</SelectItem>
              <SelectItem value="INTERBANK">ข้ามธนาคาร</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </FilterField>
      <FilterField label="จาก–ถึง">
        <DateRangePicker />
      </FilterField>
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="shrink-0">{merchant}</div>
        <div className="flex flex-wrap items-end justify-end gap-2 sm:gap-3">{period}</div>
      </div>
      {extra}
    </div>
  );
}
