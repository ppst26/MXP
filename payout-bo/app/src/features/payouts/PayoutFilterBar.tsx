import type { ReactNode } from "react";
import { useFilters } from "../../state/FilterProvider";
import { PAYOUT_STATUSES, payoutLabel } from "../../lib/status";
import type { PayoutStatus } from "../../mock/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ?? "flex flex-col gap-1"}>
      <Label className="type-label">{label}</Label>
      {children}
    </div>
  );
}

export function PayoutFilterBar() {
  const { filters, setFilters } = useFilters();
  const toggle = (s: PayoutStatus) => {
    const has = filters.statuses.includes(s);
    setFilters({
      statuses: has ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s],
      listPage: 1,
    });
  };

  return (
    <Card size="sm" className="py-0">
      <CardContent className="flex flex-col gap-3 py-3">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          {filters.batchId ? (
            <Field label="ชุด">
              <Button type="button" variant="outline" size="sm" onClick={() => setFilters({ batchId: "", listPage: 1 })}>
                {filters.batchId} · ล้าง
              </Button>
            </Field>
          ) : null}
          {filters.recipientBankCode ? (
            <Field label="ธนาคารผู้รับ">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFilters({ recipientBankCode: "", listPage: 1 })}
              >
                {filters.recipientBankCode} · ล้าง
              </Button>
            </Field>
          ) : null}
          <Field label="อ้างอิง / ออเดอร์ร้าน" className="flex min-w-[200px] flex-1 flex-col gap-1 sm:max-w-xs">
            <Input
              className="h-8"
              value={filters.q}
              placeholder="referenceId หรือ transactionId"
              onChange={(e) => setFilters({ q: e.target.value, listPage: 1 })}
            />
          </Field>
          <Field label="เลขบัญชีผู้รับ" className="flex w-full flex-col gap-1 sm:w-40">
            <Input
              className="h-8"
              value={filters.recipientAccount}
              onChange={(e) => setFilters({ recipientAccount: e.target.value, listPage: 1 })}
            />
          </Field>
          <Field label="ชื่อไม่ตรง" className="flex flex-col gap-1">
            <Select
              value={filters.nameMismatch ? "1" : "all"}
              onValueChange={(v) => setFilters({ nameMismatch: v === "1", listPage: 1 })}
            >
              <SelectTrigger size="sm" className="w-[128px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  <SelectItem value="1">เฉพาะที่ไม่ตรง</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="border-t border-border/80 pt-3">
          <p className="type-label mb-2">สถานะใบ · เลือกได้หลายค่า</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {PAYOUT_STATUSES.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 text-xs text-foreground/90">
                <Checkbox className="radio" checked={filters.statuses.includes(s)} onCheckedChange={() => toggle(s)} />
                {payoutLabel(s)}
              </label>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
