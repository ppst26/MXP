import { useMemo, useState } from "react";
import { MERCHANTS } from "../mock/seed";
import { merchById } from "../mock/query";
import { useAccessMock } from "../state/use-access-mock";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type Props = {
  merchantId: string;
  onChange: (merchantId: string) => void;
  label?: string;
};

export function MerchantPicker({ merchantId, onChange, label = "ร้าน · เลือกโหนด = ทั้งสาย" }: Props) {
  const { merchantName } = useAccessMock();
  const [open, setOpen] = useState(false);
  const selected = merchById(merchantId);
  const text = selected
    ? selected.role === "RESELLER"
      ? `${selected.name} (ทั้งสาย)`
      : `${merchantName(selected.id)} · ${selected.code}`
    : "ทุกร้าน";
  const resellers = useMemo(() => MERCHANTS.filter((m) => m.role === "RESELLER"), []);

  return (
    <div className="flex flex-col gap-2">
      <Label className="type-label">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-[220px] justify-between gap-2">
            <span className="truncate">{text}</span>
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
                  data-checked={!merchantId}
                  onSelect={() => {
                    onChange("");
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
                      data-checked={merchantId === r.id}
                      onSelect={() => {
                        onChange(r.id);
                        setOpen(false);
                      }}
                    >
                      {r.name} (ทั้งสาย) · {r.code}
                    </CommandItem>
                    {kids.map((k) => (
                      <CommandItem
                        key={k.id}
                        value={`${merchantName(k.id)} ${k.name} ${k.code} ${r.name}`}
                        data-checked={merchantId === k.id}
                        onSelect={() => {
                          onChange(k.id);
                          setOpen(false);
                        }}
                      >
                        {merchantName(k.id)} · {k.code}
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
  );
}
