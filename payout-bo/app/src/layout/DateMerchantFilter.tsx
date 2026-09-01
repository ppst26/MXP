import { useMemo, useState, type ReactNode } from "react";
import { MERCHANTS } from "../mock/seed";
import { merchById, MOCK_DIRECT_USER } from "../mock/query";
import { useFilters } from "../state/FilterProvider";
import { useViewer } from "../state/ViewerProvider";
import type { DatePreset } from "../lib/bangkok";
import type { Route } from "../mock/types";
import { DateRangePicker } from "./DateRangePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label>ช่วง</Label>
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
            </div>
            {isAdmin ? (
              <div className="flex min-w-56 flex-1 flex-col gap-1">
                <Label>ร้าน (เลือกโหนด = ทั้งสาย)</Label>
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-between">
                      <span className="truncate">{label}</span>
                      <span>▾</span>
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
              </div>
            ) : (
              <div className="flex min-w-48 flex-col gap-1">
                <Label>ร้าน</Label>
                <Input disabled value={`${locked?.name ?? "Acme"} · ${locked?.code ?? "ACME"}`} />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label>เส้นทาง</Label>
              <Select
                value={filters.route || "all"}
                onValueChange={(v) => setFilters({ route: (v === "all" ? "" : v) as "" | Route, listPage: 1 })}
              >
                <SelectTrigger size="sm">
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
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>จาก–ถึง</Label>
            <DateRangePicker />
          </div>
        </div>
        {extra}
      </CardContent>
    </Card>
  );
}
